// CI's changeset gate. It fails a pull request that changes a package's shipped files without a changeset, except
// when the change is a version bump of the kind `pnpm changeset version` makes.
//
//   node scripts/ci/changeset-gate.mjs [base]    base defaults to origin/main
//
// No pull request carries such a bump today: release.yml's version job is switched off, and the follow-up in
// docs/plans/ci.md §3f turns it back on to open an auto-merged "Version packages" pull request, which this exception
// lets through. The exception also covers a hand-made bump. `pnpm changeset status --since=<base>` alone fails such a bump, because the bump edits each
// package.json and consumes the changesets, so the gate first asks whether the change is only a bump:
// - among the files `changedFilePatterns` in .changeset/config.json counts as shipped, only package.json files changed;
// - every versioned package's package.json changed, because the fixed group moves them together, and each differs
//   from the base in its `version` field and nowhere else;
// - they all move to one new version, later than each base version, so a bump can't split the group or move a
//   dist-tag back to an older version;
// - the new version fits .changeset/pre.json's pre mode, as release-plan.mjs requires before it publishes;
// - each bumped package's CHANGELOG.md has a `## <new version>` section, which `changeset version` writes.
// A bump passes without a changeset. Any other change to shipped files, a bump that also touches src/ included, must
// add or edit a top-level `.changeset/*.md` that `changeset version` would consume. `pnpm changeset status` alone
// isn't enough: it also counts an edit to an already consumed changeset in `.changeset/pre/`, which would let the
// change merge and never publish. The change then goes to `pnpm changeset status`, which checks the rest.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  changelogSection,
  compareVersions,
  isPendingChangeset,
  parsePreState,
  preModeMismatch,
} from "./release-plan.mjs";

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
 * `read(file, side)` returns a file's text on the "base" or "head" side, or undefined where it doesn't exist, and
 * `packageDirs` lists the versioned packages, which must all move together. Returns `{ bump: true, reason }` or
 * `{ bump: false, reason }`.
 */
export function classifyChange(shipped, read, packageDirs) {
  if (shipped.length === 0) return { bump: false, reason: "no shipped file changed" };
  const others = shipped.filter((file) => path.posix.basename(file) !== "package.json");
  if (others.length > 0) return { bump: false, reason: `shipped files other than package.json changed: ${others}` };
  const unbumped = packageDirs.filter((dir) => !shipped.includes(`${dir}/package.json`));
  if (unbumped.length > 0) return { bump: false, reason: `the bump leaves out ${unbumped}` };
  const versions = new Set();
  for (const file of shipped) {
    const before = read(file, "base");
    const after = read(file, "head");
    if (after === undefined) return { bump: false, reason: `${file} was deleted` };
    const head = JSON.parse(after);
    const base = before === undefined ? undefined : JSON.parse(before);
    if (!isVersionOnlyChange(base, head)) {
      return { bump: false, reason: `${file} changed in more than its version` };
    }
    if (compareVersions(head.version, base.version) <= 0) {
      return { bump: false, reason: `${file} moved back from ${base.version} to ${head.version}` };
    }
    const preText = read(".changeset/pre.json", "head");
    const mismatch = preModeMismatch(head.version, preText === undefined ? undefined : parsePreState(preText));
    if (mismatch) return { bump: false, reason: mismatch };
    versions.add(head.version);
    const changelog = read(path.posix.join(path.posix.dirname(file), "CHANGELOG.md"), "head");
    if (changelog === undefined || changelogSection(changelog, head.version) === undefined) {
      return { bump: false, reason: `${file} moved to ${head.version}, but its CHANGELOG.md has no section for it` };
    }
  }
  if (versions.size > 1) return { bump: false, reason: `the packages moved to different versions: ${[...versions]}` };
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
  const packageDirs = versionedPackageDirs(root);
  const shipped = shippedChanges(changed, packageDirs, changedFilePatterns);
  // Both sides come from git, so an uncommitted edit in the working tree can't change the verdict.
  const read = (file, side) => {
    const result = spawnSync("git", ["show", `${side === "head" ? "HEAD" : mergeBase}:${file}`], {
      cwd: root,
      encoding: "utf8",
    });
    return result.status === 0 ? result.stdout : undefined;
  };
  const verdict = classifyChange(shipped, read, packageDirs);
  if (verdict.bump) {
    log(`changeset-gate: a version bump needs no changeset (${verdict.reason}).`);
    return 0;
  }
  if (shipped.length > 0) {
    const touched = git("diff", "--name-only", "--no-renames", "--diff-filter=d", mergeBase, "HEAD")
      .split("\n")
      .filter(Boolean);
    const versioned = packageDirs.map(
      (dir) => JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")).name,
    );
    const added = newChangesets(touched, read, versioned);
    if (added.length === 0) {
      log(
        "changeset-gate: shipped files changed, but no top-level .changeset/*.md that releases them was added or " +
          `edited (${shipped}). Run \`pnpm changeset\`, or \`pnpm changeset --empty\` when users get nothing new.`,
      );
      return 1;
    }
  }
  log(`changeset-gate: not a version bump (${verdict.reason}); running changeset status.`);
  return runStatus(base);
}

/**
 * Lists the changesets a change adds or edits that `changeset version` would consume: each path in `touched` that is a
 * top-level `.changeset/*.md` file and that isPendingChangeset accepts. `read(file, "head")` returns its text, and
 * `versioned` lists the package names Changesets versions. Files in `.changeset/pre/` were consumed already.
 */
export function newChangesets(touched, read, versioned) {
  return touched.filter((file) => {
    const match = /^\.changeset\/([^/]+)$/.exec(file);
    return match !== null && isPendingChangeset(match[1], read(file, "head") ?? "", versioned);
  });
}

/**
 * The environment `pnpm changeset status` runs with: an allowlist, never the whole of `parent`, because it runs
 * third-party code (AGENTS.md, "Running third-party code"). `home` is a fresh temp folder.
 */
export function statusEnv(parent, home) {
  const env = { HOME: home, TMPDIR: tmpdir(), LANG: parent.LANG ?? "C.UTF-8" };
  // PATH finds node, pnpm and git; PNPM_HOME is where pnpm/action-setup installed pnpm.
  for (const key of ["PATH", "PNPM_HOME"]) if (parent[key] !== undefined) env[key] = parent[key];
  return env;
}

function defaultRunStatus(root) {
  return (base) => {
    const home = mkdtempSync(path.join(tmpdir(), "changeset-gate-home-"));
    try {
      const args = ["changeset", "status", `--since=${base}`];
      return spawnSync("pnpm", args, { cwd: root, stdio: "inherit", env: statusEnv(process.env, home) }).status ?? 1;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runGate({ root: process.cwd(), base: process.argv[2] }));
}
