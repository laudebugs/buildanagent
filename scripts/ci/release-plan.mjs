// Decides what release.yml does on a run, and writes the GitHub release notes. It reads only the checkout and the
// public npm registry, and never runs package code, so the plan job needs no token.
//
//   node scripts/ci/release-plan.mjs plan          prints key=value lines for $GITHUB_OUTPUT
//   node scripts/ci/release-plan.mjs notes <file>  writes the changelog section of the current version to <file>
//
// The plan publishes only when every one of these holds, and says which one failed otherwise:
// - no package is `private` (L4a removes the field);
// - the version isn't 0.0.0, the workspace's never-released version, so dropping `private` alone publishes nothing;
// - no changeset is pending, because pending changesets belong in the "Version packages" pull request first;
// - npm doesn't already hold every package at that version.
// release.yml adds the last condition itself: only a push to main publishes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Publish order matters: the SDK depends on the gateway, so the gateway goes first.
export const RELEASE_ORDER = ["gateway", "sdk"];
const REGISTRY = "https://registry.npmjs.org";
const STABLE = /^\d+\.\d+\.\d+$/;

function readManifest(root, dir) {
  return JSON.parse(readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"));
}

/** Lists the pending changeset files, which Changesets keeps as `.changeset/*.md` beside its README. */
export function pendingChangesets(root) {
  const dir = path.join(root, ".changeset");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
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

/** Works out the release plan for the checkout at `root`. */
export async function planRelease({ root, fetchImpl = fetch }) {
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
  const base = {
    version,
    tag: `v${version}`,
    pending: pending.length > 0,
    docsDeploy: existsSync(path.join(root, ".github", "workflows", "docs-deploy.yml")),
    node: readFileSync(path.join(root, ".nvmrc"), "utf8").trim(),
  };
  const skip = (reason) => ({ ...base, publish: false, reason, toPublish: [] });

  const privateOnes = packages.filter((pkg) => pkg.private).map((pkg) => pkg.name);
  if (privateOnes.length > 0) return skip(`${privateOnes.join(" and ")} still set "private": true`);
  if (version === "0.0.0") return skip("the packages are still at 0.0.0, which is never released");
  if (!STABLE.test(version)) {
    // npm needs an explicit dist-tag for a prerelease, and release.yml publishes to `latest` only.
    throw new Error(`${version} is not a plain x.y.z version; release.yml doesn't publish prereleases`);
  }
  if (pending.length > 0)
    return skip(`${pending.length} changeset(s) are pending; merge the "Version packages" pull request first`);

  const toPublish = [];
  for (const pkg of packages) {
    if (!(await isPublished(pkg.name, version, fetchImpl))) toPublish.push(pkg.name);
  }
  if (toPublish.length === 0) return skip(`npm already holds every package at ${version}`);
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
    `docs_deploy=${plan.docsDeploy}`,
    `node=${plan.node}`,
    `reason=${plan.reason}`,
  ].join("\n");
}

async function main([command, arg]) {
  const root = process.cwd();
  if (command === "plan") {
    const plan = await planRelease({ root });
    console.log(formatOutputs(plan));
  } else if (command === "notes" && arg) {
    const { version } = readManifest(root, RELEASE_ORDER[0]);
    writeFileSync(arg, releaseNotes({ root, version }));
  } else {
    throw new Error("usage: release-plan.mjs plan | notes <file>");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release-plan: ${error.message}`);
    process.exit(1);
  });
}
