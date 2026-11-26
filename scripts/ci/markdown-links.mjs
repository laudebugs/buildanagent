// Fails when a relative link, a reference-style link definition, or a `#anchor` in a tracked Markdown file leads
// nowhere (AGENTS.md step 5: "confirm that every relative link and anchor resolves"). `apps/docs`
// (starlight-links-validator) and `apps/manual` (check:book, the build test) already check the links inside their
// own pages, which are site routes such as `/concepts/approvals/`, not repo-relative paths, so this check leaves
// their page sources alone.
//
//   node scripts/ci/markdown-links.mjs [file...]    files default to every tracked, unskipped *.md file
//
// A file named explicitly is always scanned, a skipped one included; that's the one way to check a single vendored
// mirror or template by hand.
//
// A target is resolved against the tracked file list `git ls-files` gives, never the filesystem: a path under
// `docs/reference/claude-agent-sdk/source/` exists on disk once `pnpm run fetch-docs` has run, but CI's checkout
// never has it, so treating "exists on disk" as resolved would pass locally and fail in CI. A link into a path
// nobody tracks is reported exactly like a link into a path that merely doesn't exist.
//
// External links (a URL scheme, or `//`) and absolute site routes (a leading `/`) are not our concern here; the
// Out of scope section of docs/todos/done/X5-repository-link-check.md covers both. Two link shapes are read:
// - an inline link, `[text](target)`, optionally with a `<target>` or a quoted title;
// - a reference-style link's own definition, ` [id]: target` (up to 3 leading spaces, an optional `<…>` or a title
//   after it). The definition's target is checked exactly as an inline link's would be; a `[text][id]` or `[id][]`
//   usage elsewhere in the document is not checked on its own, since a correct definition makes every usage of it
//   correct, and a usage with no definition at all is a different, much rarer bug this check doesn't catch.
//
// Known gaps, none seen in this repository's tracked Markdown as of November 2026, so none is worth the added
// parsing risk for now:
// - nested brackets inside link text (`[see [1]](x.md)`);
// - an unescaped `)` inside a link's own target or title;
// - an indented (inside a list item) or `~~~` fenced block (`prose()`, shared with scripts/package-docs.mjs, blanks
//   only a `` ` `` fence that starts at column 0);
// - a heading written with setext underlines (`===`/`---`) or indented 1-3 spaces (only `#`-style, unindented
//   headings are read).
//
// GitHub's anchors use `slugify` from `../markdown-text.mjs`, the same rule scripts/package-docs.mjs's own
// `headingAnchors` uses for a README's level-2 and level-3 headings. This check reads a document's headings at
// every level, so it counts its own repeats rather than reusing that function, which stays `#{2,3}`-only for the
// packages that already depend on its exact output in their generated `llms.txt`. `markdown-text.mjs` carries no
// dependency of its own, unlike `package-docs.mjs`, which resolves the `typescript` package at import time; this
// check needs none of that just to strip a fence or slug a heading.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prose, slugify } from "../markdown-text.mjs";

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
    reason:
      "a template copied into a generated page elsewhere; its relative links are written for that " +
      "destination, not for this file's own folder (e.g. scripts/comparison/feature-table.src.md, copied into " +
      "docs/comparison/feature-table.md)",
  },
];

/** Why `file` is not read as a link source, or `undefined` if it is. */
export function skipReason(file) {
  return SKIP_RULES.find((rule) => rule.test(file))?.reason;
}

// A `[text](target)` link, not escaped (`\[`). A code span's content is blanked before this runs (CODE_SPAN below),
// so this doesn't need to avoid matching inside one itself.
const LINK = /(\\?)\[([^\]]*)\]\(([^)]*)\)/g;
// A reference-style link's own definition: up to 3 leading spaces, `[id]:`, then an angle-bracket or bare target.
// A title after it, same line or not, is not read; the target alone decides whether this passes.
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/;
// A code span, one or two backticks: `` `code` `` or ``` ``code`` ```, whichever a line actually uses. A fenced
// block is handled separately, by `prose()`, which blanks whole lines; this handles a span inside a line it keeps.
const CODE_SPAN = /``(?:[^`]|`(?!`))*?``|`[^`\n]*`/g;

const HTML_ANCHOR = /<a\s[^>]*\b(?:id|name)="([^"]+)"/g;

/** A heading's text as GitHub renders it before slugging: a link keeps only its label, a trailing `#…` run drops. */
function headingText(raw) {
  return raw.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+#+\s*$/, "");
}

/**
 * Every heading in `markdown`, at any level, with GitHub's anchor. A repeat's `-1`, `-2` … skips any anchor already
 * assigned, so a literal heading "Foo-1" and a second "Foo" don't collide on the same id (github-slugger's own
 * behaviour: the second "Foo" becomes "foo-2", not "foo-1", when "foo-1" is already taken).
 */
export function headingAnchorsAtEveryLevel(markdown) {
  const assigned = new Set();
  const anchorFor = (base) => {
    if (!assigned.has(base)) return base;
    let n = 1;
    while (assigned.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  };
  return prose(markdown).flatMap((line) => {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!match) return [];
    const anchor = anchorFor(slugify(headingText(match[2])));
    assigned.add(anchor);
    return [{ depth: match[1].length, title: match[2], anchor }];
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

/** Every directory a tracked path's chain of parents passes through, the repository root (`.`) included. */
function directoriesOf(paths) {
  const dirs = new Set(["."]);
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
export function checkLinks(
  files,
  scan = [...files.keys()].filter((file) => file.endsWith(".md") && !skipReason(file)),
) {
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
  /** Resolves one target string, found at `file:line`, and records a problem if it doesn't. */
  const checkTarget = (file, line, raw) => {
    const target = targetOf(raw);
    if (target === "" || isExternal(target) || target.startsWith("/")) return;

    const hash = target.indexOf("#");
    const rawPath = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? undefined : target.slice(hash + 1);
    const resolved = rawPath === "" ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), rawPath));

    const isFile = files.has(resolved);
    const isDir = dirs.has(resolved.replace(/\/$/, ""));
    if (!isFile && !isDir) {
      problems.push({ file, line, message: `${target}: no tracked file or directory at ${resolved}` });
      return;
    }
    if (anchor !== undefined && isFile && resolved.endsWith(".md") && !anchorsIn(resolved).has(anchor)) {
      problems.push({ file, line, message: `${target}: no heading in ${resolved} is "#${anchor}"` });
    }
  };

  for (const file of scan) {
    const text = files.get(file);
    if (text === undefined) {
      problems.push({ file, line: 1, message: "is in scan but not in files" });
      continue;
    }
    prose(text).forEach((line, index) => {
      const reference = REFERENCE_DEFINITION.exec(line);
      if (reference) {
        checkTarget(file, index + 1, reference[1] ?? reference[2] ?? "");
        return;
      }
      const stripped = line.replace(CODE_SPAN, (span) => " ".repeat(span.length));
      for (const match of stripped.matchAll(LINK)) {
        if (match[1] === "\\") continue; // `\[text](target)`: an escaped bracket, not a link.
        checkTarget(file, index + 1, match[3]);
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

/** The repository root that holds `cwd`, from git itself, so a non-root working directory still resolves paths. */
function repoRoot(cwd) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${cwd} is not inside a git repository`);
  return result.stdout.trim();
}

function main(argv) {
  const root = repoRoot(process.cwd());
  const files = new Map();
  for (const file of trackedFiles(root)) {
    files.set(file, file.endsWith(".md") ? readFileSync(path.join(root, file), "utf8") : null);
  }
  // A path given on the command line is read relative to where it was typed, then normalized to the repo-relative
  // form `files` uses, with no further filtering: it names exactly the file to check, skipped or not.
  const scan = argv.length > 0 ? argv.map((arg) => path.relative(root, path.resolve(process.cwd(), arg))) : undefined;
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
