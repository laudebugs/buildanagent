// CI's changeset gate. It fails a pull request that changes a package's shipped files without a changeset, except
// when the change is a version bump that `pnpm changeset version` made, as in every "Version packages" pull request.
//
//   node scripts/ci/changeset-gate.mjs [base]    base defaults to origin/main
//
// `pnpm changeset status --since=<base>` alone fails a version bump, because the bump edits each package.json and
// deletes the changesets it consumed, so the gate first asks whether the change is only a bump:
// - among the files `changedFilePatterns` in .changeset/config.json counts as shipped, only package.json files changed;
// - each changed package.json differs from the base in its `version` field and nowhere else;
// - each bumped package's CHANGELOG.md has a `## <new version>` section, which `changeset version` writes.
// A bump passes without a changeset. Anything else, a bump that also touches src/ included, goes to
// `pnpm changeset status`, which fails it unless a changeset was added.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changelogSection } from "./release-plan.mjs";

/** Turns a Changesets file pattern (`src/**`, `package.json`) into a regular expression over a package's paths. */
export function patternToRegExp(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      source += ".*";
      i++;
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Lists the shipped files a change touched: each path in `changed` (repo-relative, `/`-separated) that lies in one of
 * `packageDirs` and matches one of `patterns` relative to that folder.
 */
export function shippedChanges(changed, packageDirs, patterns) {
  const regexps = patterns.map(patternToRegExp);
  return changed.filter((file) =>
    packageDirs.some((dir) => file.startsWith(`${dir}/`) && regexps.some((re) => re.test(file.slice(dir.length + 1)))),
  );
}

/** True when two package.json objects differ only in `version`, and the versions differ. */
export function isVersionOnlyChange(before, after) {
  if (before === undefined || before.version === after.version) return false;
  const { version: _a, ...restBefore } = before;
  const { version: _b, ...restAfter } = after;
  return JSON.stringify(sortKeys(restBefore)) === JSON.stringify(sortKeys(restAfter));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/**
 * Decides whether a change is a version bump that needs no changeset. `shipped` lists the shipped files it touched,
 * and `read(file, side)` returns a file's text on the "base" or "head" side, or undefined where it doesn't exist.
 * Returns `{ bump: true, reason }` or `{ bump: false, reason }`.
 */
export function classifyChange(shipped, read) {
  if (shipped.length === 0) return { bump: false, reason: "no shipped file changed" };
  const others = shipped.filter((file) => path.posix.basename(file) !== "package.json");
  if (others.length > 0) return { bump: false, reason: `shipped files other than package.json changed: ${others}` };
  for (const file of shipped) {
    const before = read(file, "base");
    const after = read(file, "head");
    if (after === undefined) return { bump: false, reason: `${file} was deleted` };
    const head = JSON.parse(after);
    if (!isVersionOnlyChange(before === undefined ? undefined : JSON.parse(before), head)) {
      return { bump: false, reason: `${file} changed in more than its version` };
    }
    const changelog = read(path.posix.join(path.posix.dirname(file), "CHANGELOG.md"), "head");
    if (changelog === undefined || changelogSection(changelog, head.version) === undefined) {
      return { bump: false, reason: `${file} moved to ${head.version}, but its CHANGELOG.md has no section for it` };
    }
  }
  return { bump: true, reason: `only versions changed: ${shipped}` };
}

/** The repo-relative folders of the packages Changesets versions: each public `packages/*` package. */
export function versionedPackageDirs(root) {
  const dir = path.join(root, "packages");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "package.json")))
    .filter((entry) => JSON.parse(readFileSync(path.join(dir, entry.name, "package.json"), "utf8")).private !== true)
    .map((entry) => `packages/${entry.name}`);
}

/**
 * Runs the gate on the git checkout at `root` against `base`. `runStatus(base)` runs `pnpm changeset status` and
 * returns its exit code; it is called only when the change isn't a version bump. Returns the gate's exit code.
 */
export function runGate({ root, base = "origin/main", runStatus = defaultRunStatus(root), log = console.log }) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const mergeBase = git("merge-base", base, "HEAD").trim();
  const changed = git("diff", "--name-only", "--no-renames", mergeBase, "HEAD").split("\n").filter(Boolean);
  const { changedFilePatterns } = JSON.parse(readFileSync(path.join(root, ".changeset", "config.json"), "utf8"));
  const shipped = shippedChanges(changed, versionedPackageDirs(root), changedFilePatterns);
  // Both sides come from git, so an uncommitted edit in the working tree can't change the verdict.
  const read = (file, side) => {
    const result = spawnSync("git", ["show", `${side === "head" ? "HEAD" : mergeBase}:${file}`], {
      cwd: root,
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout : undefined;
  };
  const verdict = classifyChange(shipped, read);
  if (verdict.bump) {
    log(`changeset-gate: a version bump needs no changeset (${verdict.reason}).`);
    return 0;
  }
  log(`changeset-gate: not a version bump (${verdict.reason}); running changeset status.`);
  return runStatus(base);
}

function defaultRunStatus(root) {
  return (base) =>
    spawnSync("pnpm", ["changeset", "status", `--since=${base}`], { cwd: root, stdio: "inherit" }).status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runGate({ root: process.cwd(), base: process.argv[2] }));
}
