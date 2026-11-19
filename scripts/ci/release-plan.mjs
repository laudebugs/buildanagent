// Decides what release.yml does on a run, and writes the GitHub release notes. It reads only the checkout, the public
// npm registry and the repository's GitHub releases. It never runs package code, and the only token it reads is the
// run's read-only GITHUB_TOKEN, for the release check.
//
//   node scripts/ci/release-plan.mjs plan          prints key=value lines for $GITHUB_OUTPUT
//   node scripts/ci/release-plan.mjs needs-version prints true when `pnpm changeset version` has work to do
//   node scripts/ci/release-plan.mjs notes <file>  writes the changelog section of the current version to <file>
//
// The plan versions when changesets are pending, or when .changeset/pre.json is in "exit" mode: release.yml's
// `version` job then runs `pnpm changeset version`, pushes the result to main and plans again on that commit.
// The plan publishes only when every one of these holds, and says which one failed otherwise:
// - no package is `private` (none has been since L4a, and a test in release.test.mjs fails if the field comes back);
// - nothing needs versioning, because pending changesets must become a version first;
// - the version isn't 0.0.0, the workspace's never-released version, so dropping `private` alone publishes nothing;
// - the version matches the pre mode: while .changeset/pre.json says `"mode": "pre"`, only a prerelease whose
//   identifier is pre.json's `tag` (0.1.0-alpha.0 for `alpha`), published under that dist-tag; otherwise only a
//   plain x.y.z, published under `latest`. A mismatch throws, because publishing it would move the wrong dist-tag;
// - npm doesn't already hold every package at that version, or it does but the GitHub release v<version> is missing,
//   so a run that failed after the uploads can still tag the release.
// release.yml adds the last condition itself: only a push to main publishes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Publish order matters: the SDK depends on the gateway, so the gateway goes first.
export const RELEASE_ORDER = ["gateway", "sdk"];
const REGISTRY = "https://registry.npmjs.org";
const GITHUB_API = "https://api.github.com";
const STABLE = /^\d+\.\d+\.\d+$/;
// A dist-tag npm accepts and that can't be read as a version or range; `latest` is for stable releases only.
const PRE_TAG = /^[a-z][a-z0-9-]*$/;

function readManifest(root, dir) {
  return JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"));
}

/** Lists the pending changeset files, which Changesets keeps as `.changeset/*.md` beside its README. */
export function pendingChangesets(root) {
  const dir = path.join(root, ".changeset");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
}

/**
 * Reads `.changeset/pre.json`, which `pnpm changeset pre enter <tag>` writes: `{ mode, tag }`, with `mode` "pre"
 * while in pre mode and "exit" after `pnpm changeset pre exit`, until the next `pnpm changeset version` deletes it.
 * Returns undefined when the file doesn't exist.
 */
export function readPreState(root) {
  const file = path.join(root, ".changeset", "pre.json");
  if (!existsSync(file)) return undefined;
  const state = JSON.parse(readFileSync(file, "utf8"));
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
  const versions = new Set(packages.map((pkg) => pkg.version));
  if (versions.size !== 1) {
    // The fixed group in .changeset/config.json keeps them equal; a mismatch means someone edited a version by hand.
    throw new Error(`the packages must share one version, found ${packages.map((p) => `${p.name}@${p.version}`)}`);
  }
  const [version] = versions;
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
  if (privateOnes.length > 0) return skip(`${privateOnes.join(" and ")} still set "private": true`);
  // Before the version checks: until `changeset version` runs, the version may not match the pre mode yet, as after
  // `pnpm changeset pre exit`, which leaves the prerelease version in place.
  if (pending.length > 0)
    return skip(`${pending.length} changeset(s) are pending; the version job versions them first`);
  if (base.needsVersion) return skip("pre mode is exiting; the version job versions the packages first");
  if (version === "0.0.0") return skip("the packages are still at 0.0.0, which is never released");
  if (inPre) {
    const prerelease = new RegExp(`^\\d+\\.\\d+\\.\\d+-${pre.tag}\\.\\d+$`);
    if (!prerelease.test(version)) {
      throw new Error(
        `.changeset/pre.json is in pre mode with tag ${pre.tag}, but ${version} isn't a ${pre.tag} prerelease`,
      );
    }
  } else if (!STABLE.test(version)) {
    throw new Error(`${version} is not a plain x.y.z version, and .changeset/pre.json isn't in pre mode`);
  }

  const toPublish = [];
  for (const pkg of packages) {
    if (!(await isPublished(pkg.name, version, fetchImpl))) toPublish.push(pkg.name);
  }
  if (toPublish.length === 0) {
    if (!repo) throw new Error("set GITHUB_REPOSITORY to owner/name, so the plan can check the GitHub release");
    if (await hasGitHubRelease(repo, base.tag, { token, fetchImpl })) {
      return skip(`npm already holds every package at ${version}, and the release ${base.tag} exists`);
    }
    // An earlier run uploaded both packages but stopped before the release; the publish job skips what npm holds.
    return {
      ...base,
      publish: true,
      reason: `npm holds every package at ${version}, but ${base.tag} has no release`,
      toPublish,
    };
  }
  return { ...base, publish: true, reason: `npm doesn't hold ${toPublish.join(" and ")} at ${version}`, toPublish };
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
