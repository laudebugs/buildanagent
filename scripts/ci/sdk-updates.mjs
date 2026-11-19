// Finds newer releases of the SDKs our verify/* harnesses pin, under AGENTS.md's age rule: a release must be at
// least MIN_AGE_DAYS old. A stable pin moves only to a newer stable release. A prerelease pin (such as
// miniflare's dated -beta builds) may also move to a newer prerelease of the same major version.
//
//   node scripts/ci/sdk-updates.mjs plan            JSON matrix of harnesses with updates, for GitHub Actions
//   node scripts/ci/sdk-updates.mjs apply <harness> rewrites verify/<harness>/package.json, prints the bumps
//   node scripts/ci/sdk-updates.mjs check <harness> <base> <head> <bumps>
//                                                   checks that the commit <head> on <base> changes only what an
//                                                   update of <harness> to the plan's <bumps> may, and prints what is
//                                                   wrong
//
// The script only reads the npm registry, edits package.json and reads git; it installs and runs nothing. It imports
// only node: modules and version-pr.mjs, which imports only node: modules and the two scripts beside it, because
// sdk-updates.yml runs `check` in the job that later holds the token able to write the update branch.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseRawDiff } from "./version-pr.mjs";

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

/**
 * The newest release that is at least MIN_AGE_DAYS old, on the same channel as `pinned`, and not deprecated.
 */
export function newestEligible(pinned, versions, times, now = Date.now(), deprecated = new Set()) {
  const pin = parse(pinned);
  if (!pin) return undefined;
  const cutoff = now - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  let best;
  for (const version of versions) {
    const v = parse(version);
    const published = Date.parse(times[version] ?? "");
    if (!v || deprecated.has(version) || Number.isNaN(published) || published > cutoff) continue;
    if (v.pre !== undefined && (pin.pre === undefined || v.nums[0] !== pin.nums[0])) continue;
    if (compare(v, pin) <= 0) continue;
    if (!best || compare(v, best.parsed) > 0) best = { version, parsed: v, published: times[version] };
  }
  return best && { version: best.version, published: best.published };
}

const REGULAR_FILE = "100644";

/**
 * Says what is wrong with an SDK update of `harness`, given its change as parseRawDiff entries. The change comes from a
 * job that ran the new releases' code, so it may touch only what that job means to change: the harness's
 * package.json, its committed results and the workspace lockfile. Each file it adds or edits must be a regular,
 * non-executable file, because createCommitOnBranch can't set a file's mode. Returns a list of problems, empty when
 * the change is one an update may make.
 */
export function updateProblems(entries, harness) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(harness)) return [`${JSON.stringify(harness)} isn't a harness name`];
  const problems = entries.length === 0 ? ["the change is empty"] : [];
  const results = `verify/${harness}/results/`;
  for (const { status, path: file, dstMode } of entries) {
    const where = `${status} ${file}`;
    const inResults = file.startsWith(results) && file.length > results.length;
    const edited = file === "pnpm-lock.yaml" || file === `verify/${harness}/package.json`;
    if (!["A", "M", "D"].includes(status)) problems.push(`${where}: only additions, edits and deletions are allowed`);
    else if (!inResults && !(edited && status === "M")) {
      problems.push(
        `${where}: an update may edit only verify/${harness}/package.json and pnpm-lock.yaml, and change ${results}`,
      );
    } else if (status !== "D" && dstMode !== REGULAR_FILE) {
      problems.push(`${where}: must be a regular, non-executable file (mode ${dstMode})`);
    }
  }
  return problems;
}

const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Parses the plan job's `bumps`, such as `"ai@7.0.170 @ai-sdk/openai@3.0.2"`, into `[{ name, version }]`. Throws on
 * anything else, because the check compares the change with them.
 */
export function parseBumps(text) {
  const bumps = String(text ?? "")
    .split(" ")
    .filter(Boolean)
    .map((bump) => {
      const at = bump.lastIndexOf("@");
      const name = bump.slice(0, at);
      const version = bump.slice(at + 1);
      if (at <= 0 || !PACKAGE_NAME.test(name) || !parse(version)) throw new Error(`${bump} isn't a planned bump`);
      return { name, version };
    });
  if (bumps.length === 0) throw new Error("no bumps were planned");
  return bumps;
}

/**
 * Says what is wrong with an update's verify/<harness>/package.json. `apply` rewrites it from main's copy with only
 * the planned versions changed, so the new text must be exactly that rewrite: no new script, dependency, override or
 * pnpm setting, and no version the plan job didn't choose.
 */
export function manifestProblems(before, after, bumps) {
  let manifest;
  try {
    manifest = JSON.parse(before);
  } catch (error) {
    return [`main's copy doesn't parse: ${error.message}`];
  }
  const problems = [];
  for (const { name, version } of bumps) {
    if (!Object.hasOwn(manifest.dependencies ?? {}, name)) problems.push(`${name} isn't a dependency to bump`);
    else manifest.dependencies[name] = version;
  }
  if (problems.length === 0 && after !== `${JSON.stringify(manifest, null, 2)}\n`) {
    problems.push(`changes more than the planned versions (${bumps.map((b) => `${b.name}@${b.version}`).join(" ")})`);
  }
  return problems;
}

/** Splits `lines` at each line that `isKey` accepts, into the lines before the first key and each key's block. */
function splitAt(lines, isKey) {
  const lead = [];
  const blocks = [];
  for (const line of lines) {
    if (isKey(line)) blocks.push({ key: line, body: [] });
    else (blocks.at(-1)?.body ?? lead).push(line);
  }
  return { lead, blocks };
}

const trimBlank = (lines) => {
  const out = [...lines];
  while (out.at(-1) === "") out.pop();
  return out.join("\n");
};

// An entry's key line, as pnpm writes it: a single-quoted name or a plain one, then an empty value or `{}`. Double
// quotes and escapes are refused, so two spellings of one name can't both pass as different entries.
const ENTRY_KEY = /^ {2}(?:'([^']+)'|([A-Za-z0-9_./][^\s:'"#]*)):(?: \{\})?$/;

// Where YAML starts a value: after the indent and any `- `, after `: `, and after a flow bracket or comma.
const VALUE_START = String.raw`(^\s*(?:-\s+)*|:\s+|[[{,]\s*)`;
const QUOTED = new RegExp(`${VALUE_START}'(?:[^']|'')*'`, "g");
const INDICATOR = new RegExp(`${VALUE_START}[&*!|>%@?'\`]`);

/**
 * Says whether a line of a new lockfile entry is one pnpm writes and no YAML trick: no double quotes, comments,
 * anchors, aliases, tags, block scalars or explicit keys, and quotes and brackets that close on the same line, so the
 * line can't swallow or rewrite its neighbours. An apostrophe inside a plain value, as in a deprecation message, is
 * plain text to YAML.
 */
function plainLine(line) {
  if (line === "") return true;
  if (!line.startsWith("    ")) return false;
  const bare = line.replace(QUOTED, "$1q");
  if (/["\\]|(?:^|\s)#/.test(bare) || INDICATOR.test(bare)) return false;
  const count = (re) => (bare.match(re) ?? []).length;
  return count(/\{/g) === count(/\}/g) && count(/\[/g) === count(/\]/g);
}

// A key whose value is a block scalar, as pnpm writes a deprecation message that spans lines (`deprecated: |-`).
const BLOCK_SCALAR_KEY = /^( {4,})[A-Za-z][A-Za-z0-9]*: [|>][-+]?$/;

/**
 * Says whether a new lockfile entry's body holds only plain lines. A block scalar's lines, those indented deeper than
 * its key, are text to YAML and end at the first line that isn't, so they can't reach a neighbouring entry and are
 * skipped.
 */
function plainEntry(lines) {
  let blockIndent;
  for (const line of lines) {
    if (blockIndent !== undefined && (line === "" || /^ */.exec(line)[0].length > blockIndent)) continue;
    blockIndent = undefined;
    const block = BLOCK_SCALAR_KEY.exec(line);
    if (block) blockIndent = block[1].length;
    else if (!plainLine(line)) return false;
  }
  return true;
}

// A package pnpm fetches from the registry by name and version and checks against this hash. A tarball URL, a git
// repository or a local path would let a tampered lockfile install code that npm doesn't hold under that name.
const REGISTRY_RESOLUTION = /^ {4}resolution: \{integrity: sha512-[A-Za-z0-9+/]+={0,2}\}$/;

/** Says whether a packages entry's body has exactly one resolution, and that one REGISTRY_RESOLUTION. */
function registryResolved(lines) {
  const resolutions = lines.filter((line) => /^ {4}resolution:/.test(line));
  return resolutions.length === 1 && REGISTRY_RESOLUTION.test(resolutions[0]);
}

/**
 * Parses one of the lockfile's sections (importers, packages, snapshots) into a Map from entry name to its key line
 * and body, or returns a problem string.
 */
function lockEntries(section, body) {
  const { lead, blocks } = splitAt(body, (line) => /^ {2}\S/.test(line));
  if (lead.some((line) => line !== "")) return `${section}: holds a line before its first entry`;
  const entries = new Map();
  for (const { key, body: lines } of blocks) {
    const match = ENTRY_KEY.exec(key);
    if (!match) return `${section}: ${JSON.stringify(key)} isn't an entry pnpm writes`;
    const name = match[1] ?? match[2];
    if (entries.has(name)) return `${section}: lists ${name} twice`;
    if (lines.some((line) => line !== "" && !line.startsWith("    "))) return `${section}: ${name} is badly indented`;
    entries.set(name, { key, body: trimBlank(lines), lines });
  }
  return entries;
}

// The values in an importer that an update may change: in the harness's own, each dependency's specifier and resolved
// version; in another harness's, only the peers in a resolved version's parentheses, because pnpm shares one
// resolution of a peer across the workspace, so bumping one harness can move a peer that another harness installs.
const OWN_VALUE = /^( {8}(?:specifier|version): )(.*)$/;
const PEER_SUFFIX = /^( {8}version: [^(\s]+)(\(.*)$/;
const PLAIN_VALUE = /^[A-Za-z0-9@._/()+~^:*-]+$/;

/**
 * Says what is wrong with one importer's new entry, or returns "". `pattern` matches each line whose second group may
 * change; every other line, and the key, must stay as they were.
 */
function importerProblem(name, prior, entry, pattern) {
  const mask = (lines) => trimBlank(lines.map((line) => (pattern ? line.replace(pattern, "$1…") : line)));
  if (entry.key !== prior.key || mask(entry.lines) !== mask(prior.lines)) {
    return pattern ? `changes more of the ${name} importer than an update may` : `changes the ${name} importer`;
  }
  const values = pattern ? entry.lines.map((line) => pattern.exec(line)?.[2]).filter((v) => v !== undefined) : [];
  return values.every((value) => PLAIN_VALUE.test(value))
    ? ""
    : `the ${name} importer holds a version pnpm doesn't write`;
}

/**
 * Says what is wrong with an update's pnpm-lock.yaml, given main's text and the update's. Every importer but the
 * harness's must stay byte for byte, and in the harness's only its dependencies' specifiers and versions may change.
 * In `packages` and `snapshots` an entry may be added or removed but never changed, because an existing entry may be
 * one that main's other importers install. Every other section, such as `settings` and `overrides`, stays as it was.
 * New entries must be plain lines, so no YAML construct can make them read differently to pnpm than to this check.
 */
export function lockfileProblems(before, after, harness) {
  const file = "pnpm-lock.yaml";
  if (/[\t\r]/.test(after)) return [`${file}: holds a tab or a carriage return`];
  const top = (text) => splitAt(text.split("\n"), (line) => /^\S/.test(line));
  const was = top(before);
  const now = top(after);
  if (now.lead.some((line) => line !== "")) return [`${file}: holds a line before its first section`];
  const keys = (parsed) => parsed.blocks.map((block) => block.key);
  if (JSON.stringify(keys(was)) !== JSON.stringify(keys(now))) {
    return [`${file}: its sections changed from ${keys(was)} to ${keys(now)}`];
  }
  const problems = [];
  for (const [i, { key, body }] of now.blocks.entries()) {
    const section = key.replace(/:.*$/, "");
    const old = was.blocks[i].body;
    if (!["importers", "packages", "snapshots"].includes(section)) {
      if (trimBlank(old) !== trimBlank(body)) problems.push(`${file}: changes ${section}`);
      continue;
    }
    const oldEntries = lockEntries(section, old);
    const newEntries = lockEntries(section, body);
    if (typeof oldEntries === "string" || typeof newEntries === "string") {
      problems.push(`${file}: ${typeof oldEntries === "string" ? `main's ${oldEntries}` : newEntries}`);
      continue;
    }
    if (section === "importers") {
      const own = `verify/${harness}`;
      if (JSON.stringify([...oldEntries.keys()]) !== JSON.stringify([...newEntries.keys()])) {
        problems.push(`${file}: adds, removes or reorders an importer`);
        continue;
      }
      for (const [name, entry] of newEntries) {
        // The workspace's own importers (the root, packages/*, apps/*) hold the tools CI and the release run.
        const pattern = name === own ? OWN_VALUE : name.startsWith("verify/") ? PEER_SUFFIX : undefined;
        const problem = importerProblem(name, oldEntries.get(name), entry, pattern);
        if (problem) problems.push(`${file}: ${problem}`);
      }
      continue;
    }
    for (const [name, entry] of newEntries) {
      const prior = oldEntries.get(name);
      if (prior) {
        if (entry.key !== prior.key || entry.body !== prior.body) problems.push(`${file}: changes ${section} ${name}`);
      } else if (!plainEntry(entry.lines)) {
        problems.push(`${file}: the new ${section} entry ${name} holds a line pnpm doesn't write`);
      } else if (section === "packages" && !registryResolved(entry.lines)) {
        problems.push(`${file}: the new package ${name} doesn't resolve from the npm registry by its integrity alone`);
      }
    }
  }
  return problems;
}

/** Reads the change from `base` to `head` in the git checkout at `root` and returns every problem with it. */
function checkUpdate(root, harness, base, head, bumpsText) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const entries = parseRawDiff(git("diff", "--raw", "-z", "--no-renames", "--no-abbrev", base, head));
  const problems = updateProblems(entries, harness);
  if (problems.length > 0) return problems;
  let bumps;
  try {
    bumps = parseBumps(bumpsText);
  } catch (error) {
    return [error.message];
  }
  const changed = new Set(entries.map((entry) => entry.path));
  const manifest = `verify/${harness}/package.json`;
  if (!changed.has(manifest)) return [`${manifest}: the planned versions aren't in it`];
  const show = (rev, file) => git("show", `${rev}:${file}`);
  problems.push(...manifestProblems(show(base, manifest), show(head, manifest), bumps).map((p) => `${manifest}: ${p}`));
  if (changed.has("pnpm-lock.yaml")) {
    problems.push(...lockfileProblems(show(base, "pnpm-lock.yaml"), show(head, "pnpm-lock.yaml"), harness));
  }
  return problems;
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
    const versions = entry.versions ?? {};
    const deprecated = new Set(Object.keys(versions).filter((v) => versions[v]?.deprecated));
    const next = newestEligible(pinned, Object.keys(versions), entry.time ?? {}, Date.now(), deprecated);
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

const [command, arg, ...rest] = process.argv.slice(2);
if (command === "plan") await plan();
else if (command === "apply" && arg) await apply(arg);
else if (command === "check" && arg && rest.length === 3) {
  const problems = checkUpdate(process.cwd(), arg, ...rest);
  for (const problem of problems) process.stderr.write(`::error::sdk-updates check: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`The ${arg} update changes only its pins, its results and the lockfile.\n`);
} else if (command !== undefined) {
  process.stderr.write("usage: sdk-updates.mjs plan | apply <harness> | check <harness> <base> <head> <bumps>\n");
  process.exit(2);
}
