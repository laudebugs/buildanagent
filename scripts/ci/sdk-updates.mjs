// Finds newer releases of the SDKs our verify/* harnesses pin, under AGENTS.md's age rule: a release must be at
// least MIN_AGE_DAYS old. A stable pin moves only to a newer stable release. A prerelease pin (such as
// miniflare's dated -beta builds) may also move to a newer prerelease of the same major version.
//
//   node scripts/ci/sdk-updates.mjs plan            JSON matrix of harnesses with updates, for GitHub Actions
//   node scripts/ci/sdk-updates.mjs apply <harness> rewrites verify/<harness>/package.json, prints the bumps
//
// The script only reads the npm registry and edits package.json; it installs and runs nothing.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MIN_AGE_DAYS = 7;
const REGISTRY = "https://registry.npmjs.org";
const root = path.resolve(import.meta.dirname, "../..");
const verifyDir = path.join(root, "verify");

/** Parses `1.2.3` or `1.2.3-beta.4` into comparable parts; returns undefined for other shapes. */
function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!m) return undefined;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] };
}

function comparePre(a, b) {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    const na = /^\d+$/.test(pa[i]) ? Number(pa[i]) : Number.NaN;
    const nb = /^\d+$/.test(pb[i]) ? Number(pb[i]) : Number.NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Semver ordering of two parsed versions. */
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] - b.nums[i];
  return comparePre(a.pre, b.pre);
}

/** The newest release of `name` that is at least MIN_AGE_DAYS old and on the same channel as `pinned`. */
export function newestEligible(pinned, versions, times, now = Date.now()) {
  const pin = parse(pinned);
  if (!pin) return undefined;
  const cutoff = now - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  let best;
  for (const version of versions) {
    const v = parse(version);
    const published = Date.parse(times[version] ?? "");
    if (!v || Number.isNaN(published) || published > cutoff) continue;
    if (v.pre !== undefined && (pin.pre === undefined || v.nums[0] !== pin.nums[0])) continue;
    if (compare(v, pin) <= 0) continue;
    if (!best || compare(v, best.parsed) > 0) best = { version, parsed: v, published: times[version] };
  }
  return best && { version: best.version, published: best.published };
}

async function registryEntry(name) {
  const res = await fetch(`${REGISTRY}/${name.replace("/", "%2F")}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`npm registry: ${name}: HTTP ${res.status}`);
  return res.json();
}

function harnesses() {
  return readdirSync(verifyDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function manifestPath(harness) {
  return path.join(verifyDir, harness, "package.json");
}

/** Every runtime dependency of `harness` with a newer eligible release. */
async function bumpsFor(harness) {
  const manifest = JSON.parse(readFileSync(manifestPath(harness), "utf8"));
  const bumps = [];
  for (const [name, pinned] of Object.entries(manifest.dependencies ?? {})) {
    const entry = await registryEntry(name);
    const next = newestEligible(pinned, Object.keys(entry.versions ?? {}), entry.time ?? {});
    if (next) bumps.push({ name, from: pinned, to: next.version, published: next.published });
  }
  return bumps;
}

async function plan() {
  const include = [];
  for (const harness of harnesses()) {
    const bumps = await bumpsFor(harness);
    if (bumps.length > 0) include.push({ harness, bumps: bumps.map((b) => `${b.name}@${b.to}`).join(" ") });
  }
  process.stdout.write(`${JSON.stringify({ include })}\n`);
}

async function apply(harness) {
  if (!harnesses().includes(harness)) throw new Error(`no harness named ${harness}`);
  const file = manifestPath(harness);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const bumps = await bumpsFor(harness);
  for (const b of bumps) manifest.dependencies[b.name] = b.to;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const b of bumps)
    process.stdout.write(`| \`${b.name}\` | ${b.from} | ${b.to} | ${b.published.slice(0, 10)} |\n`);
}

const [command, arg] = process.argv.slice(2);
if (command === "plan") await plan();
else if (command === "apply" && arg) await apply(arg);
else if (command !== undefined) {
  process.stderr.write("usage: sdk-updates.mjs plan | apply <harness>\n");
  process.exit(2);
}
