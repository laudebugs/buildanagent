// Checks and describes the commit of the "Version packages" pull request, which release.yml builds and the
// auto-merge guard checks again. It imports only node: modules and the two scripts beside it, which import only node:
// modules, because release.yml runs it in the job that holds the token able to push the pull request's branch, where
// no third-party code may run.
//
//   node scripts/ci/version-pr.mjs prepare <base> <head> <dir>  checks the change, then writes <dir>/title and
//                                                              <dir>/body.md for the pull request
//   node scripts/ci/version-pr.mjs check <base> <head>          checks the change and prints what is wrong
//   node scripts/ci/version-pr.mjs guard <base> <head>          the auto-merge guard: prints action=keep or
//                                                              action=disable, and explains itself in the job summary
//
// The change runs from the merge base of <base> and <head> to <head>. A version commit, as `pnpm changeset version`
// writes it, may change only these files:
// - each versioned package's package.json, in its `version` alone, all moving to one later version that fits the pre
//   mode (the changeset gate's version-bump rule, classifyChange);
// - each versioned package's CHANGELOG.md, and only alongside such a bump;
// - pending top-level changesets, which it deletes, or in pre mode moves unchanged into .changeset/pre/;
// - on leaving pre mode, .changeset/pre.json and the changesets in .changeset/pre/, which it deletes.
// Every file it adds or edits must be a regular, non-executable file.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyChange } from "./changeset-gate.mjs";
import { changesetPackages, isPendingChangeset, parsePreState } from "./release-plan.mjs";

/** The branch release.yml pushes the version commit to, and the only head branch the guard lets auto-merge. */
export const RELEASE_BRANCH = "changeset-release/main";
/** The branch the Version packages pull request merges into. */
export const BASE_BRANCH = "main";

const REGULAR_FILE = "100644";

/**
 * Parses the output of `git diff --raw -z --no-renames --no-abbrev` into `{ status, srcMode, dstMode, srcBlob,
 * dstBlob, path }` entries. With --no-renames, a moved file shows as a deletion and an addition.
 */
export function parseRawDiff(text) {
  const fields = text.split("\0");
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const meta = fields[i].trim();
    if (meta === "") break;
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(meta);
    if (!match) throw new Error(`can't read the git diff line ${JSON.stringify(meta)}`);
    const [, srcMode, dstMode, srcBlob, dstBlob, status] = match;
    entries.push({ status, srcMode, dstMode, srcBlob, dstBlob, path: fields[i + 1] });
  }
  return entries;
}

/**
 * Checks that a change is one a version commit may make. `entries` comes from parseRawDiff, `read(file, side)` returns
 * a file's text on the "base" or "head" side, or undefined where it doesn't exist, and `packages` lists the versioned
 * packages as `{ dir, name }`. Returns `{ ok, problems, version, bumped, consumed }`: `version` is the head version,
 * `bumped` says whether the packages moved, and `consumed` lists the changesets the change consumed.
 */
export function checkVersionChange(entries, read, packages) {
  const problems = [];
  const dirs = packages.map((pkg) => pkg.dir);
  const names = packages.map((pkg) => pkg.name);
  const preText = read(".changeset/pre.json", "base");
  let pre;
  try {
    pre = preText === undefined ? undefined : parsePreState(preText);
  } catch (error) {
    problems.push(`the base's .changeset/pre.json is invalid: ${error.message}`);
  }
  const exiting = pre?.mode === "exit";
  const deleted = new Map(entries.filter((e) => e.status === "D").map((e) => [e.path, e]));
  const manifests = [];
  const changelogs = [];
  const consumed = [];
  if (entries.length === 0) problems.push("the change is empty");

  for (const entry of entries) {
    const { status, path: file } = entry;
    const where = `${status} ${file}`;
    if (!["A", "M", "D"].includes(status)) {
      problems.push(`${where}: only additions, edits and deletions are allowed`);
      continue;
    }
    if (status !== "D" && entry.dstMode !== REGULAR_FILE) {
      problems.push(`${where}: must be a regular, non-executable file (mode ${entry.dstMode})`);
      continue;
    }
    const pkgDir = dirs.find((dir) => file === `${dir}/package.json` || file === `${dir}/CHANGELOG.md`);
    const top = /^\.changeset\/([^/]+\.md)$/.exec(file);
    const inPre = /^\.changeset\/pre\/([^/]+\.md)$/.exec(file);
    if (pkgDir && file.endsWith("/package.json") && status === "M") {
      manifests.push(file);
    } else if (pkgDir && file.endsWith("/CHANGELOG.md") && status !== "D") {
      changelogs.push(file);
    } else if (top && status === "D") {
      if (isPendingChangeset(top[1], read(file, "base") ?? "", names)) consumed.push(top[1]);
      else problems.push(`${where}: not a changeset that \`changeset version\` consumes`);
    } else if (inPre && status === "A") {
      const source = deleted.get(`.changeset/${inPre[1]}`);
      if (pre?.mode !== "pre") problems.push(`${where}: changesets move into .changeset/pre/ only in pre mode`);
      else if (!source || source.srcBlob !== entry.dstBlob) {
        problems.push(`${where}: must be .changeset/${inPre[1]}, moved without a change`);
      }
    } else if ((inPre || file === ".changeset/pre.json") && status === "D" && exiting) {
      // Leaving pre mode deletes pre.json and the changesets the prereleases consumed.
    } else {
      problems.push(`${where}: a version commit doesn't change this file`);
    }
  }

  let bumped = false;
  if (manifests.length > 0) {
    const verdict = classifyChange(manifests, read, dirs);
    if (verdict.bump) bumped = true;
    else problems.push(`not a version bump: ${verdict.reason}`);
  } else if (changelogs.length > 0) {
    problems.push(`changelogs changed without a version bump: ${changelogs}`);
  }
  if (consumed.length === 0 && !exiting && entries.length > 0) {
    problems.push("the change consumes no changeset");
  }
  const headManifest = read(`${dirs[0]}/package.json`, "head");
  const version = headManifest === undefined ? undefined : JSON.parse(headManifest).version;
  return { ok: problems.length === 0, problems, version, bumped, consumed: consumed.sort() };
}

/** The pull request's title, which is also the version commit's message and, after the squash, main's commit. */
export function prTitle({ version, bumped }) {
  return bumped
    ? `chore(release): version packages to ${version}`
    : "chore(release): consume changesets that bump no package";
}

/**
 * The pull request's body: what merging it does, and each consumed changeset with the packages and bumps it names.
 * `changesets` lists `{ name, text }`.
 */
export function prBody({ version, bumped, distTag, changesets }) {
  const lines = [
    bumped
      ? `Merging this pull request publishes \`@buildanagent/gateway\` and \`@buildanagent/sdk\` ${version} to npm under the \`${distTag}\` dist-tag.`
      : "Merging this pull request consumes changesets that bump no package, so it publishes nothing.",
    "",
    `release.yml keeps this pull request up to date: every changeset merged to \`${BASE_BRANCH}\` before it merges joins this release. Auto-merge is on, so GitHub squash-merges it once the required checks pass.`,
    "",
    "## Changesets",
    "",
  ];
  for (const { name, text } of changesets) {
    const frontmatter = /^\s*---\r?\n([\s\S]*?)^---\s*$/m.exec(text);
    const bumps = frontmatter ? frontmatter[1].trim().split(/\r?\n/).filter(Boolean) : [];
    const summary = frontmatter ? text.slice(frontmatter.index + frontmatter[0].length).trim() : text.trim();
    const firstLine = summary.split(/\r?\n/)[0] || "(no summary)";
    const named = changesetPackages(text)?.length ? bumps.map((line) => line.trim()).join(", ") : "no package";
    lines.push(`- \`${name}\` (${named}): ${firstLine}`);
  }
  lines.push("", "The changelog entries are in each package's `CHANGELOG.md` in this pull request.");
  return `${lines.join("\n")}\n`;
}

/**
 * Decides whether a pull request may keep auto-merge on: only one whose head is RELEASE_BRANCH in this repository and
 * whose base is BASE_BRANCH. Returns `{ release, reason }`; a release pull request still needs checkVersionChange.
 */
export function guardDecision({ headRef, headRepo, repo, baseRef }) {
  if (headRepo !== repo) return { release: false, reason: `its head is in ${headRepo || "another repository"}` };
  if (headRef !== RELEASE_BRANCH) return { release: false, reason: `its head branch is ${headRef}` };
  if (baseRef !== BASE_BRANCH) return { release: false, reason: `it merges into ${baseRef}, not ${BASE_BRANCH}` };
  return { release: true, reason: `its head is ${RELEASE_BRANCH} in ${repo}` };
}

/** Reads the change from `base`'s merge base with `head` to `head` in the git checkout at `root`. */
export function gitChange(root, base, head) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const mergeBase = git("merge-base", base, head).trim();
  const entries = parseRawDiff(git("diff", "--raw", "-z", "--no-renames", "--no-abbrev", mergeBase, head));
  const read = (file, side) => {
    const result = spawnSync("git", ["show", `${side === "head" ? head : mergeBase}:${file}`], {
      cwd: root,
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout : undefined;
  };
  // The versioned packages are the base's public packages/*, so the change can't add or unhide one.
  const packages = git("ls-tree", "--name-only", `${mergeBase}:packages`)
    .split("\n")
    .filter(Boolean)
    .map((dir) => ({ dir: `packages/${dir}`, text: read(`packages/${dir}/package.json`, "base") }))
    .filter(({ text }) => text !== undefined && JSON.parse(text).private !== true)
    .map(({ dir, text }) => ({ dir, name: JSON.parse(text).name }));
  return { entries, read, packages };
}

function checkGit(root, base, head) {
  const { entries, read, packages } = gitChange(root, base, head);
  return { ...checkVersionChange(entries, read, packages), read };
}

function main([command, base, head, dir]) {
  const root = process.cwd();
  if (command === "check" && base && head) {
    const result = checkGit(root, base, head);
    for (const problem of result.problems) console.error(`version-pr: ${problem}`);
    if (result.ok) console.log(`version-pr: the change is a version commit for ${result.version}.`);
    return result.ok ? 0 : 1;
  }
  if (command === "prepare" && base && head && dir) {
    const result = checkGit(root, base, head);
    if (!result.ok) {
      for (const problem of result.problems) console.error(`version-pr: ${problem}`);
      console.error("version-pr: refusing to push a commit that changes more than a version commit may.");
      return 1;
    }
    const preText = result.read(".changeset/pre.json", "head");
    const pre = preText === undefined ? undefined : parsePreState(preText);
    const distTag = pre?.mode === "pre" ? pre.tag : "latest";
    const changesets = result.consumed.map((name) => ({ name, text: result.read(`.changeset/${name}`, "base") }));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "title"), prTitle(result));
    writeFileSync(path.join(dir, "body.md"), prBody({ ...result, distTag, changesets }));
    console.log(`version-pr: ${prTitle(result)}`);
    return 0;
  }
  if (command === "guard" && base && head) {
    const env = process.env;
    const decision = guardDecision({
      headRef: env.HEAD_REF,
      headRepo: env.HEAD_REPO,
      repo: env.REPO,
      baseRef: env.BASE_REF,
    });
    let action = "disable";
    let reason = `only a pull request from ${RELEASE_BRANCH} into ${BASE_BRANCH} may auto-merge, and ${decision.reason}`;
    let problems = [];
    if (decision.release) {
      const result = checkGit(root, base, head);
      problems = result.problems;
      action = result.ok ? "keep" : "disable";
      reason = result.ok
        ? `${decision.reason}, and it changes only what a version commit may`
        : `${decision.reason}, but it changes more than a version commit may`;
    }
    const summary = [
      `## Auto-merge guard: ${action === "keep" ? "auto-merge stays on" : "auto-merge turned off"}`,
      "",
      `Pull request #${env.NUMBER}: ${reason}.`,
      ...(problems.length ? ["", ...problems.map((problem) => `- ${problem}`)] : []),
      "",
      `This repository auto-merges only the "Version packages" pull request that release.yml opens from \`${RELEASE_BRANCH}\` (docs/plans/ci.md §3f). Merge other pull requests by hand.`,
      "",
    ].join("\n");
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
    console.log(`action=${action}`);
    console.log(`reason=${reason.replace(/[\r\n]+/g, " ")}`);
    return 0;
  }
  console.error("usage: version-pr.mjs check <base> <head> | prepare <base> <head> <dir> | guard <base> <head>");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`version-pr: ${error.message}`);
    process.exit(1);
  }
}
