// Decides what release.yml does on a run, and writes the GitHub release notes. It reads only the checkout, the public
// npm registry and the repository's GitHub releases. It never runs package code, and the only token it reads is the
// run's read-only GITHUB_TOKEN, for the release check.
//
//   node scripts/ci/release-plan.mjs plan          prints key=value lines for $GITHUB_OUTPUT
//   node scripts/ci/release-plan.mjs needs-version prints true when `pnpm changeset version` has work to do
//   node scripts/ci/release-plan.mjs notes <file>  writes the changelog section of the current version to <file>
//
// The plan asks for a version when changesets are pending, or when .changeset/pre.json is in "exit" mode. Such a plan
// publishes nothing: release.yml's `version` and `version-pr` jobs turn the changesets into a "Version packages" pull
// request, and the release publishes once that pull request merges (docs/plans/ci.md §3f).
// The plan publishes only when every one of these holds, and says which one failed otherwise:
// - no package is `private` (a test in release.test.mjs fails if the field comes back on any of the six);
// - nothing needs versioning, because pending changesets must become a version first;
// - every package has the same version. The fixed group in .changeset/config.json keeps them equal, so a mismatch
//   with nothing left to version means someone edited a version by hand, and the plan throws. It checks this only
//   after the two skips above, because a package that has never been released sits at 0.0.0 beside the others'
//   prerelease until the version commit brings the fixed group to one version;
// - the version isn't 0.0.0, the workspace's never-released version, so dropping `private` alone publishes nothing;
// - the version matches the pre mode: while .changeset/pre.json says `"mode": "pre"`, only a prerelease whose
//   identifier is pre.json's `tag` (0.1.0-alpha.0 for `alpha`), published under that dist-tag; otherwise only a
//   plain x.y.z, published under `latest`. A mismatch throws, because publishing it would move the wrong dist-tag;
// - the GitHub release v<version> doesn't exist yet. The plan asks GitHub before npm, because the publish job creates
//   that release only after its last upload returns, while npm makes an accepted upload public 1 to 3 minutes later.
//   A run queued behind the one that released, as run 45067734004 was, would otherwise read npm's 404s as "not
//   published" and upload again into an E409. Without the release, the plan asks npm which packages it lacks; it
//   still publishes when npm holds all six, so a run that failed after the uploads can still tag the release.
// release.yml adds the last condition itself: only a push to main publishes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Publish order matters: each package comes after every workspace package it depends on, so npm never holds a
// release whose dependency is missing. The SDK and agent-safety depend on the gateway, the protocol on the gateway and
// the SDK, the harness on those three and agent-safety, and the CLI on the gateway, the SDK, the protocol and the
// harness.
export const RELEASE_ORDER = ["gateway", "sdk", "agent-safety", "protocol", "harness", "cli"];
const REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
const STABLE = /^\d+\.\d+\.\d+$/;
// A dist-tag npm accepts and that can't be read as a version or range; `latest` is for stable releases only.
const PRE_TAG = /^[a-z][a-z0-9-]*$/;

/** Joins names as a sentence reads them: "a", "a and b", "a, b and c". */
export function listNames(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function readManifest(root, dir) {
  return JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"));
}

// The Markdown files in .changeset/ that Changesets 3 never reads as changesets (@changesets/read's ignoredMdFiles).
const NOT_CHANGESETS = [/^README\.md$/i, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^GEMINI\.md$/];

/**
 * Lists the package names a changeset's frontmatter names, such as `"@buildanagent/gateway": patch`. An empty
 * changeset names none. Returns undefined when the text has no frontmatter to read.
 */
export function changesetPackages(text) {
  const match = /^\s*---\r?\n([\s\S]*?)^---\s*$/m.exec(text);
  if (!match) return undefined;
  const names = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const entry = /^\s*(["']?)([^"':]+)\1\s*:/.exec(line);
    if (!entry) return undefined;
    names.push(entry[2].trim());
  }
  return names;
}

/**
 * True when `changeset version` would consume the changeset file `name` with contents `text`. Changesets skips the
 * files in NOT_CHANGESETS and dotfiles, and it never consumes a changeset that names only packages it doesn't version,
 * such as a private app or an ignored harness; `versioned` lists the package names it does version. A changeset that
 * mixes both, or whose frontmatter this can't read, counts as pending, so the plan waits and `changeset version`
 * reports the error itself.
 */
export function isPendingChangeset(name, text, versioned) {
  if (!name.endsWith(".md") || name.startsWith(".") || NOT_CHANGESETS.some((re) => re.test(name))) return false;
  const names = changesetPackages(text);
  return names === undefined || names.length === 0 || names.some((pkg) => versioned.includes(pkg));
}

/** The names of the packages Changesets versions, in RELEASE_ORDER. */
export function versionedPackageNames(root) {
  return RELEASE_ORDER.map((dir) => readManifest(root, dir).name);
}

/**
 * Lists the pending changeset files, which Changesets keeps as `.changeset/*.md` beside its README, keeping only those
 * `changeset version` would consume (isPendingChangeset). In pre mode, `changeset version` moves the ones it consumed
 * into `.changeset/pre/`, so they no longer count.
 */
export function pendingChangesets(root) {
  const dir = path.join(root, ".changeset");
  if (!existsSync(dir)) return [];
  const candidates = readdirSync(dir).filter((name) => name.endsWith(".md"));
  if (candidates.length === 0) return [];
  const versioned = versionedPackageNames(root);
  return candidates.filter((name) => isPendingChangeset(name, readFileSync(path.join(dir, name), "utf8"), versioned));
}

/**
 * Reads `.changeset/pre.json`, which `pnpm changeset pre enter <tag>` writes: `{ mode, tag }`, with `mode` "pre"
 * while in pre mode and "exit" after `pnpm changeset pre exit`, until the next `pnpm changeset version` deletes it.
 * Returns undefined when the file doesn't exist.
 */
export function readPreState(root) {
  const file = path.join(root, ".changeset", "pre.json");
  return existsSync(file) ? parsePreState(readFileSync(file, "utf8")) : undefined;
}

/** Parses the text of `.changeset/pre.json` the way readPreState does, and throws on the same errors. */
export function parsePreState(text) {
  const state = JSON.parse(text);
  if (state.mode !== "pre" && state.mode !== "exit") throw new Error(`.changeset/pre.json has mode ${state.mode}`);
  if (typeof state.tag !== "string" || !PRE_TAG.test(state.tag) || state.tag === "latest") {
    throw new Error(`.changeset/pre.json's tag ${JSON.stringify(state.tag)} can't be an npm dist-tag for prereleases`);
  }
  return state;
}

/**
 * True when `pnpm changeset version` has work to do: a changeset is pending, or pre mode is exiting. It reads only the
 * checkout, so release.yml's version job can ask it again after fetching the newest main.
 */
export function needsVersion(root) {
  return pendingChangesets(root).length > 0 || readPreState(root)?.mode === "exit";
}

/**
 * Orders two semver versions by semver precedence: negative when `a` comes first, positive when `b` does, 0 when equal.
 * A prerelease comes before its plain version (0.1.0-alpha.9 < 0.1.0), and numeric identifiers compare as numbers
 * (alpha.10 > alpha.9). Build metadata isn't accepted, because our versions never carry it.
 */
export function compareVersions(a, b) {
  const parse = (version) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version);
    if (!match) throw new Error(`${JSON.stringify(version)} is not a semver version`);
    return { core: match.slice(1, 4).map(Number), pre: match[4]?.split(".") ?? [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    const [pNum, qNum] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pNum && qNum) return Number(p) - Number(q);
    if (pNum !== qNum) return pNum ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

/**
 * Says why `version` can't be released in the pre mode `pre` (readPreState's result), or returns undefined when it can.
 * While pre.json says `"mode": "pre"`, only a prerelease whose identifier is pre.json's tag fits, such as 0.1.0-alpha.0
 * for `alpha`; otherwise only a plain x.y.z does.
 */
export function preModeMismatch(version, pre) {
  if (pre?.mode === "pre") {
    const prerelease = new RegExp(`^\\d+\\.\\d+\\.\\d+-${pre.tag}\\.\\d+$`);
    if (!prerelease.test(version)) {
      return `.changeset/pre.json is in pre mode with tag ${pre.tag}, but ${version} isn't a ${pre.tag} prerelease`;
    }
  } else if (!STABLE.test(version)) {
    return `${version} is not a plain x.y.z version, and .changeset/pre.json isn't in pre mode`;
  }
  return undefined;
}

/** Asks the registry whether `name@version` exists: true on 200, false on 404, and an error on anything else. */
export async function isPublished(name, version, fetchImpl = fetch) {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}/${version}`;
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  // Anything else, such as a 5xx or a rate limit, must stop the run rather than read as "not published".
  throw new Error(`${url} answered ${response.status}; can't tell whether ${name}@${version} is published`);
}

/** Asks GitHub whether `repo` has a release for `tag`: true on 200, false on 404, and an error on anything else. */
export async function hasGitHubRelease(repo, tag, { token, fetchImpl = fetch } = {}) {
  const url = `${GITHUB_API}/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const headers = { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const response = await fetchImpl(url, { headers });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new Error(`${url} answered ${response.status}; can't tell whether the release ${tag} exists`);
}

/**
 * Works out the release plan for the checkout at `root`. `repo` is the `owner/name` whose GitHub releases it checks,
 * and `token` authenticates that request.
 */
export async function planRelease({ root, repo, token, fetchImpl = fetch }) {
  const packages = RELEASE_ORDER.map((dir) => {
    const manifest = readManifest(root, dir);
    return { dir, name: manifest.name, version: manifest.version, private: manifest.private === true };
  });
  // The skips below report the first package's version, the gateway's, as `notes` reads it; the same-version check
  // after them makes it every package's version before anything publishes.
  const { version } = packages[0];
  const pending = pendingChangesets(root);
  const pre = readPreState(root);
  const inPre = pre?.mode === "pre";
  const base = {
    version,
    tag: `v${version}`,
    pending: pending.length > 0,
    needsVersion: needsVersion(root),
    distTag: inPre ? pre.tag : "latest",
    prerelease: inPre,
    docsDeploy: existsSync(path.join(root, ".github", "workflows", "docs-deploy.yml")),
    node: readFileSync(path.join(root, ".nvmrc"), "utf8").trim(),
  };
  const skip = (reason) => ({ ...base, publish: false, reason, toPublish: [] });

  const privateOnes = packages.filter((pkg) => pkg.private).map((pkg) => pkg.name);
  if (privateOnes.length > 0) return skip(`${listNames(privateOnes)} still set "private": true`);
  // Before the version checks: until `changeset version` runs, the version may not match the pre mode yet, as after
  // `pnpm changeset pre exit`, which leaves the prerelease version in place.
  if (pending.length > 0)
    return skip(`${pending.length} changeset(s) are pending; they publish once a version commit versions them`);
  if (base.needsVersion) return skip("pre mode is exiting; a version commit must version the packages first");
  if (packages.some((pkg) => pkg.version !== version)) {
    // The fixed group in .changeset/config.json keeps them equal; with nothing left to version, a mismatch means
    // someone edited a version by hand, and publishing would release packages that don't match.
    throw new Error(`the packages must share one version, found ${packages.map((p) => `${p.name}@${p.version}`)}`);
  }
  if (version === "0.0.0") return skip("the packages are still at 0.0.0, which is never released");
  const mismatch = preModeMismatch(version, pre);
  if (mismatch) throw new Error(mismatch);

  // The release first: once it exists, every upload of this version has returned, and npm's version index refuses
  // another, whatever the registry answers in the minutes before it makes the uploads public.
  if (!repo) throw new Error("set GITHUB_REPOSITORY to owner/name, so the plan can check the GitHub release");
  if (await hasGitHubRelease(repo, base.tag, { token, fetchImpl })) return skip(`${base.tag} is already released`);
  const toPublish = [];
  for (const pkg of packages) {
    if (!(await isPublished(pkg.name, version, fetchImpl))) toPublish.push(pkg.name);
  }
  if (toPublish.length === 0) {
    // An earlier run uploaded every package but stopped before the release; the publish job skips what npm holds.
    return {
      ...base,
      publish: true,
      reason: `npm holds every package at ${version}, but ${base.tag} has no release`,
      toPublish,
    };
  }
  return { ...base, publish: true, reason: `npm doesn't hold ${listNames(toPublish)} at ${version}`, toPublish };
}

/**
 * Returns one package's changelog section for `version`: the lines after its `## <version>` heading, up to the next
 * `## ` heading. Returns undefined when the changelog or the section is missing.
 */
export function changelogSection(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) return undefined;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** Builds the GitHub release notes: each package's changelog section under its name, in publish order. */
export function releaseNotes({ root, version }) {
  const parts = [];
  for (const dir of RELEASE_ORDER) {
    const { name } = readManifest(root, dir);
    const file = path.join(root, "packages", dir, "CHANGELOG.md");
    const section = existsSync(file) ? changelogSection(readFileSync(file, "utf8"), version) : undefined;
    if (section === undefined) throw new Error(`packages/${dir}/CHANGELOG.md has no "## ${version}" section`);
    parts.push(`## ${name}\n\n${section}`);
  }
  return `${parts.join("\n\n")}\n`;
}

/** Formats a plan as the key=value lines release.yml reads from $GITHUB_OUTPUT. */
export function formatOutputs(plan) {
  return [
    `version=${plan.version}`,
    `tag=${plan.tag}`,
    `publish=${plan.publish}`,
    `pending=${plan.pending}`,
    `needs_version=${plan.needsVersion}`,
    `dist_tag=${plan.distTag}`,
    `prerelease=${plan.prerelease}`,
    `docs_deploy=${plan.docsDeploy}`,
    `node=${plan.node}`,
    `reason=${plan.reason}`,
  ].join("\n");
}

async function main([command, arg]) {
  const root = process.cwd();
  if (command === "plan") {
    const plan = await planRelease({ root, repo: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN });
    console.log(formatOutputs(plan));
  } else if (command === "needs-version") {
    console.log(needsVersion(root));
  } else if (command === "notes" && arg) {
    const { version } = readManifest(root, RELEASE_ORDER[0]);
    writeFileSync(arg, releaseNotes({ root, version }));
  } else {
    throw new Error("usage: release-plan.mjs plan | needs-version | notes <file>");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release-plan: ${error.message}`);
    process.exit(1);
  });
}
