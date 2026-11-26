// Fails when a relative link or a `#anchor` in a tracked Markdown file leads nowhere (AGENTS.md step 5: "confirm
// that every relative link and anchor resolves"). `apps/docs` (starlight-links-validator) and `apps/manual`
// (check:book, the build test) already check the links inside their own pages, which are site routes such as
// `/concepts/approvals/`, not repo-relative paths, so this check leaves their page sources alone.
//
//   node scripts/ci/markdown-links.mjs [file...]    files default to every tracked, unskipped *.md file
//
// A target is resolved against the tracked file list `git ls-files` gives, never the filesystem: a path under
// `docs/reference/claude-agent-sdk/source/` exists on disk once `pnpm run fetch-docs` has run, but CI's checkout
// never has it, so treating "exists on disk" as resolved would pass locally and fail in CI. A link into a path
// nobody tracks is reported exactly like a link into a path that merely doesn't exist, which is why the first pass
// this todo asked for converted the handful of real links into that one mirror to code formatting rather than
// teaching the checker a second, harder-to-audit notion of "resolved, but only locally".
//
// External links (a URL scheme, or `//`) and absolute site routes (a leading `/`) are not our concern here; the
// Out of scope section of docs/todos/done/X5-repository-link-check.md covers both. Only inline links are read,
// `[text](target)`, optionally with a `<target>` or a quoted title; reference-style links (`[text][id]`) don't
// appear in this repo's tracked Markdown as of November 2026, so they're not supported.
//
// GitHub's anchors use `slugify` from `../package-docs.mjs`, the same rule that package's own `headingAnchors` uses
// for a README's level-2 and level-3 headings. This check reads a document's headings at every level, so it counts
// its own repeats rather than reusing that function, which stays `#{2,3}`-only for the packages that already depend
// on its exact output in their generated `llms.txt`.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prose, slugify } from "../package-docs.mjs";

/** Directories whose Markdown files this check does not read as link sources, each with why. */
const SKIP_RULES = [
  {
    test: (file) => /^docs\/reference\/[^/]+\/source\//.test(file),
    reason: "a vendored mirror of an SDK's own upstream docs, not ours to fix",
  },
  { test: (file) => file.startsWith(".agents/skills/anatomy/"), reason: "a vendored skill, not ours to fix" },
  {
    test: (file) => file.startsWith("apps/docs/src/content/"),
    reason: "site routes; starlight-links-validator already checks these pages",
  },
  {
    test: (file) => file.startsWith("apps/manual/src/content/"),
    reason: "site routes; check:book and the build test already check these pages",
  },
  {
    test: (file) => file.endsWith(".src.md"),
    reason: "a template copied into a generated page elsewhere; its relative links are written for that " +
      "destination, not for this file's own folder (e.g. scripts/comparison/feature-table.src.md, copied into " +
      "docs/comparison/feature-table.md)",
  },
];

/** Why `file` is not read as a link source, or `undefined` if it is. */
export function skipReason(file) {
  return SKIP_RULES.find((rule) => rule.test(file))?.reason;
}

const LINK = /\[([^\]]*)\]\(([^)]*)\)/g;
// A single-backtick code span, so example syntax in prose (`` `[a](b.md)` ``) isn't read as a link. A fenced block
// is handled separately, by `prose()`, which blanks whole lines; this handles a span inside a line `prose()` keeps.
const CODE_SPAN = /`[^`\n]*`/g;

const HTML_ANCHOR = /<a\s[^>]*\b(?:id|name)="([^"]+)"/g;

/** Every heading in `markdown`, at any level, with GitHub's anchor and `-1`, `-2` … for a repeat. */
export function headingAnchorsAtEveryLevel(markdown) {
  const counts = new Map();
  return prose(markdown).flatMap((line) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) return [];
    const slug = slugify(match[2]);
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return [{ depth: match[1].length, title: match[2], anchor: count === 0 ? slug : `${slug}-${count}` }];
  });
}

/**
 * Every id an `<a id="…">` or `<a name="…">` tag names, outside fenced code. A document can anchor a spot with one
 * of these where no heading fits, as `docs/research/redesign-vs-ai/redesign-vs-ai.md` does for its numbered tables;
 * a link to that id is as valid a same-page target as a link to a heading's own anchor.
 */
export function htmlAnchorIds(markdown) {
  return prose(markdown).flatMap((line) => [...line.matchAll(HTML_ANCHOR)].map((match) => match[1]));
}

/** `(path "a title")` or `(path 'a title')` keeps only `path`; `(<path with spaces>)` drops the angle brackets. */
function targetOf(raw) {
  let target = raw.trim();
  const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*')$/.exec(target);
  if (titled) target = titled[1];
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  return target;
}

function isExternal(target) {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");
}

/** Every directory a tracked path's chain of parents passes through, repo root excluded. */
function directoriesOf(paths) {
  const dirs = new Set();
  for (const file of paths) {
    let dir = path.posix.dirname(file);
    while (dir !== "." && !dirs.has(dir)) {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  return dirs;
}

/**
 * Checks every link `scan` names. `files` maps every tracked path this check may need as a target to its content, or
 * to `null` for a tracked path this check never reads as a document, such as an image. `scan` defaults to every
 * `.md` key `skipReason` passes.
 */
export function checkLinks(files, scan = [...files.keys()].filter((file) => file.endsWith(".md") && !skipReason(file))) {
  const dirs = directoriesOf(files.keys());
  const anchorsOf = new Map();
  const anchorsIn = (file) => {
    const cached = anchorsOf.get(file);
    if (cached) return cached;
    const text = files.get(file) ?? "";
    const anchors = new Set([...headingAnchorsAtEveryLevel(text).map((h) => h.anchor), ...htmlAnchorIds(text)]);
    anchorsOf.set(file, anchors);
    return anchors;
  };

  const problems = [];
  for (const file of scan) {
    const text = files.get(file);
    if (text === undefined) {
      problems.push({ file, line: 1, message: "is in scan but not in files" });
      continue;
    }
    const lines = prose(text);
    lines.forEach((line, index) => {
      const stripped = line.replace(CODE_SPAN, (span) => " ".repeat(span.length));
      for (const match of stripped.matchAll(LINK)) {
        const target = targetOf(match[2]);
        if (target === "" || isExternal(target) || target.startsWith("/")) continue;

        const hash = target.indexOf("#");
        const rawPath = hash === -1 ? target : target.slice(0, hash);
        const anchor = hash === -1 ? undefined : target.slice(hash + 1);
        const resolved = rawPath === "" ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), rawPath));

        const isFile = files.has(resolved);
        const isDir = dirs.has(resolved.replace(/\/$/, ""));
        if (!isFile && !isDir) {
          problems.push({ file, line: index + 1, message: `${target}: no tracked file or directory at ${resolved}` });
          continue;
        }
        if (anchor !== undefined && isFile && resolved.endsWith(".md") && !anchorsIn(resolved).has(anchor)) {
          problems.push({ file, line: index + 1, message: `${target}: no heading in ${resolved} is "#${anchor}"` });
        }
      }
    });
  }
  return problems;
}

/** Every path `git ls-files` tracks, repo-root-relative with `/` separators, from `root`. */
export function trackedFiles(root) {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "git ls-files failed");
  return result.stdout.split("\0").filter((line) => line !== "");
}

function main(argv) {
  // The repository root, not this script's own folder: pnpm always runs a root `package.json` script from the
  // repository root, and resolving root from the working directory, rather than from import.meta.url, is what lets
  // a test point this CLI at a small repository of its own in a temporary directory.
  const root = process.cwd();
  const files = new Map();
  for (const file of trackedFiles(root)) {
    files.set(file, file.endsWith(".md") ? readFileSync(path.join(root, file), "utf8") : null);
  }
  const given = argv.filter((arg) => !arg.startsWith("-"));
  const scan = given.length > 0 ? given : undefined;
  const problems = checkLinks(files, scan);
  for (const problem of problems) console.error(`${problem.file}:${problem.line}: ${problem.message}`);
  if (problems.length > 0) {
    console.error(`\nMarkdown links: fix the ${problems.length} problem(s) above, or add a reason to SKIP_RULES.`);
    process.exit(1);
  }
  const scanned = scan ?? [...files.keys()].filter((file) => file.endsWith(".md") && !skipReason(file));
  console.log(`Markdown links: ${scanned.length} files checked, no problems.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
