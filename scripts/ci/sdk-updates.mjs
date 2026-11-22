// Finds newer releases of the SDKs our verify/* harnesses pin, under AGENTS.md's age rule: a release must be at
// least MIN_AGE_DAYS old. A stable pin moves only to a newer stable release. A prerelease pin (such as
// miniflare's dated -beta builds) may also move to a newer prerelease of the same major version. A harness exists to
// test its main package (apps/manual/src/data/harnesses.json) as it installs, so a pin of a package that main's chosen
// release declares in its dependencies, optionalDependencies or peerDependencies moves only within that range, every
// chosen release's peerDependencies on the other pins must hold, and a range this script can't evaluate holds the pin
// (planBumps).
//
//   node scripts/ci/sdk-updates.mjs plan            JSON matrix of harnesses with updates, for GitHub Actions
//   node scripts/ci/sdk-updates.mjs apply <harness> <bumps>
//                                                   writes the plan's <bumps> into verify/<harness>/package.json and
//                                                   prints them
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
    // Semver ranks a numeric identifier below an alphanumeric one, whatever their characters.
    if (Number.isNaN(na) !== Number.isNaN(nb)) return Number.isNaN(na) ? 1 : -1;
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
 * Every release newer than `pinned` that is at least MIN_AGE_DAYS old, on the same channel as `pinned`, and not
 * deprecated, newest first.
 */
function eligibleReleases(pinned, versions, times, now, deprecated) {
  const pin = parse(pinned);
  if (!pin) return [];
  const cutoff = now - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  const found = [];
  for (const version of versions) {
    const v = parse(version);
    const published = Date.parse(times[version] ?? "");
    if (!v || deprecated.has(version) || Number.isNaN(published) || published > cutoff) continue;
    if (v.pre !== undefined && (pin.pre === undefined || v.nums[0] !== pin.nums[0])) continue;
    if (compare(v, pin) <= 0) continue;
    found.push({ version, parsed: v, published: times[version] });
  }
  return found.sort((a, b) => compare(b.parsed, a.parsed)).map(({ version, published }) => ({ version, published }));
}

/**
 * The newest release that is at least MIN_AGE_DAYS old, on the same channel as `pinned`, and not deprecated.
 */
export function newestEligible(pinned, versions, times, now = Date.now(), deprecated = new Set()) {
  return eligibleReleases(pinned, versions, times, now, deprecated)[0];
}

// A version in a range term, which may leave out its minor and patch or write them as x or *. Build metadata, such as
// `+build.5`, is read and ignored, as semver ignores it in precedence.
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Turns one range term, such as `^2.29.1`, `~1.4`, `2.x`, `>=0.5.0` or `1.3.27`, into comparators, the way npm's
 * semver desugars it. Returns undefined for a term it can't read.
 */
function termComparators(term) {
  const op = /^(\^|~|>=|<=|>|<|=)?/.exec(term)[1] ?? "";
  const m = PARTIAL.exec(term.slice(op.length));
  if (!m) return undefined;
  const wild = (part) => part === undefined || /^[xX*]$/.test(part);
  // A wildcard part ends the version: `1.x.3` isn't a version npm reads either.
  const parts = [m[1], m[2], m[3]];
  const given = parts.findIndex(wild);
  const known = given === -1 ? 3 : given;
  if (parts.slice(known).some((part) => !wild(part))) return undefined;
  if (m[4] !== undefined && known < 3) return undefined;
  const nums = parts.slice(0, known).map(Number);
  const at = (a, b = 0, c = 0, pre = undefined) => ({ nums: [a, b, c], pre });
  const lower = at(nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, m[4]);
  // The first release past a partial version: `1.2` ends before 1.3.0, `1` before 2.0.0.
  const past = (n) => (n === 1 ? at(nums[0] + 1) : n === 2 ? at(nums[0], nums[1] + 1) : undefined);
  // An upper bound npm adds ends before that version's first prerelease (`<2.0.0-0`), so includePrerelease can't
  // admit 2.0.0-beta into `^1.2.3`.
  const before = (v) => ({ op: "<", v: { ...v, pre: "0" } });
  if (known === 0) return op === "<" || op === ">" ? [before(at(0))] : [];
  if (op === "^") {
    const bump = nums[0] > 0 || known === 1 ? 1 : nums[1] > 0 || known === 2 ? 2 : 3;
    return [{ op: ">=", v: lower }, before(bump === 3 ? at(0, 0, nums[2] + 1) : past(bump))];
  }
  if (op === "~") return [{ op: ">=", v: lower }, before(past(known === 1 ? 1 : 2))];
  if (known === 3) return [{ op: op || "=", v: lower }];
  // A partial version after an operator stands for its whole span: `>=2` is >=2.0.0, `<=2` is <3.0.0-0.
  if (op === "" || op === "=") return [{ op: ">=", v: lower }, before(past(known))];
  if (op === ">=") return [{ op, v: lower }];
  if (op === "<") return [before(lower)];
  return op === ">" ? [{ op: ">=", v: past(known) }] : [before(past(known))];
}

/**
 * Reads an npm range, such as `^2.29.1`, `>=1.2.0 <2.0.0`, `1.2.3 - 2` or `^3.25.76 || ^4`, into a list of comparator
 * sets, one per `||` alternative. Returns undefined for anything that isn't a semver range, such as a dist-tag, an
 * `npm:` alias, a `workspace:`, `file:` or `link:` spec, a git spec or a URL, so the caller can refuse to guess.
 */
export function parseRange(range) {
  if (typeof range !== "string") return undefined;
  const sets = [];
  for (const alternative of range.split("||")) {
    // npm accepts a space between an operator and its version, and reads `~>` as `~`.
    const terms = alternative
      .trim()
      .replace(/~>/g, "~")
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1")
      .split(/\s+/)
      .filter(Boolean);
    if (terms.includes("-")) {
      // A hyphen range, `a - b`, is >=a and <=b, where a partial b covers its whole span.
      if (terms.length !== 3 || terms[1] !== "-") return undefined;
      const lower = termComparators(`>=${terms[0]}`);
      const upper = termComparators(`<=${terms[2]}`);
      if (!lower || !upper || /^[\^~<>=]/.test(terms[0]) || /^[\^~<>=]/.test(terms[2])) return undefined;
      sets.push([...lower, ...upper]);
      continue;
    }
    const set = [];
    for (const term of terms) {
      const comparators = termComparators(term);
      if (!comparators) return undefined;
      set.push(...comparators);
    }
    sets.push(set);
  }
  return sets;
}

/**
 * Says whether `version` satisfies a range parseRange read. As in npm, a prerelease satisfies a set only when one of
 * its comparators names a prerelease of the same major, minor and patch, unless `includePrerelease` is set, as npm's
 * option of that name does.
 */
export function satisfies(version, sets, { includePrerelease = false } = {}) {
  const v = parse(version);
  if (!v) return false;
  return sets.some((set) => {
    const holds = set.every(({ op, v: bound }) => {
      const c = compare(v, bound);
      return op === ">=" ? c >= 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : op === "<" ? c < 0 : c === 0;
    });
    const samePre = ({ v: bound }) => bound.pre !== undefined && bound.nums.every((n, i) => n === v.nums[i]);
    return holds && (v.pre === undefined || includePrerelease || set.some(samePre));
  });
}

// The fields of the main package's manifest whose ranges cap the harness's other pins. Every package's
// peerDependencies also bind the harness's other pins, because pnpm resolves those peers to the harness's own copies.
const MAIN_FIELDS = ["dependencies", "optionalDependencies", "peerDependencies"];
const PEER_FIELDS = ["peerDependencies"];

/**
 * Chooses the bumps for one harness. `main` is the package the harness exists to test, so the plan keeps the harness
 * installing it as its users would:
 * - A pin of a package that main's chosen release declares in its dependencies, optionalDependencies or
 *   peerDependencies moves only within that range. When the range can't be evaluated, the pin stays.
 * - A pin moves only to a release whose peerDependencies on the harness's other pins hold after the update, and only
 *   if the peer ranges the other pins' chosen releases declare on it still hold. A bump that breaks one stays at its
 *   pin.
 * - Main moves to its newest eligible release under which every range main declares on the other pins, and every
 *   peer range they declare on main, holds; else to an older one, or else main stays.
 * A prerelease pin is matched against a range as npm's includePrerelease option does, so a dated beta can move inside
 * a range written for stable releases. `registry(name)` returns the package's registry document. Returns the bumps,
 * and notes for the job log on every pin held below a newer release.
 */
export async function planBumps(manifest, main, registry, now = Date.now()) {
  const pins = manifest.dependencies ?? {};
  if (!Object.hasOwn(pins, main)) throw new Error(`${main}, the package the harness tests, isn't a dependency`);
  const names = Object.keys(pins);
  const docs = new Map();
  for (const name of names) docs.set(name, await registry(name));
  const meta = (name, version) => docs.get(name).versions?.[version];
  const eligible = new Map();
  const releases = (name) => {
    if (!eligible.has(name)) {
      const versions = docs.get(name).versions ?? {};
      const deprecated = new Set(Object.keys(versions).filter((v) => versions[v]?.deprecated));
      eligible.set(
        name,
        eligibleReleases(pins[name], Object.keys(versions), docs.get(name).time ?? {}, now, deprecated),
      );
    }
    return eligible.get(name);
  };
  const declared = (fields, manifestOf, name) =>
    fields.map((field) => manifestOf?.[field]?.[name]).filter((range) => range !== undefined);
  // True, false, or undefined when a range can't be evaluated.
  const fits = (name, version, ranges) => {
    const sets = ranges.map(parseRange);
    if (sets.includes(undefined)) return undefined;
    const includePrerelease = parse(pins[name])?.pre !== undefined;
    return sets.every((set) => satisfies(version, set, { includePrerelease }));
  };

  // Plans every other pin with main at `mainVersion`. Returns the versions chosen, the notes, and why main can't
  // move to `mainVersion`, if it can't.
  const planUnder = (mainVersion) => {
    const mainManifest = meta(main, mainVersion);
    if (!mainManifest) throw new Error(`npm registry: ${main}@${mainVersion} isn't published`);
    const chosen = { [main]: mainVersion };
    const notes = [];
    for (const name of names) {
      if (name === main) continue;
      const all = releases(name);
      const ranges = declared(MAIN_FIELDS, mainManifest, name);
      if (ranges.length === 0) {
        chosen[name] = all[0]?.version ?? pins[name];
        continue;
      }
      const shown = `${main}@${mainVersion} declares ${ranges.join(" and ")}`;
      if (ranges.map(parseRange).includes(undefined)) {
        chosen[name] = pins[name];
        if (all.length > 0)
          notes.push(`::warning::holds ${name} at ${pins[name]}: ${shown}, which this script can't evaluate`);
        continue;
      }
      const inRange = all.find((release) => fits(name, release.version, ranges));
      chosen[name] = inRange?.version ?? pins[name];
      if (all.length > 0 && all[0].version !== chosen[name]) {
        notes.push(`caps ${name} at ${chosen[name]} rather than ${all[0].version}: ${shown}`);
      }
    }
    // What is wrong with `x`'s chosen release's ranges on `q`'s chosen version, or undefined.
    const problem = (x, q) => {
      const ranges = declared(x === main ? MAIN_FIELDS : PEER_FIELDS, meta(x, chosen[x]), q);
      if (ranges.length === 0) return undefined;
      const ok = fits(q, chosen[q], ranges);
      if (ok) return undefined;
      const why = ok === undefined ? "which this script can't evaluate" : `which ${q}@${chosen[q]} doesn't satisfy`;
      return `${x}@${chosen[x]} declares ${q} ${ranges.join(" and ")}, ${why}`;
    };
    const moved = (name) => name !== main && chosen[name] !== pins[name];
    // Undoes a bump that breaks a peer range until none does. Each pass only undoes bumps, so it ends.
    for (let changed = true; changed; ) {
      changed = false;
      for (const x of names) {
        for (const q of names) {
          if (x === q || !(moved(x) || moved(q))) continue;
          const broken = problem(x, q);
          if (!broken) continue;
          const undo = moved(x) ? x : q;
          notes.push(`::warning::holds ${undo} at ${pins[undo]} rather than ${chosen[undo]}: ${broken}`);
          chosen[undo] = pins[undo];
          changed = true;
        }
      }
    }
    if (mainVersion === pins[main]) return { chosen, notes };
    for (const q of names) {
      if (q === main) continue;
      const broken = problem(main, q) ?? problem(q, main);
      if (broken) return { chosen, notes, refused: broken };
    }
    return { chosen, notes };
  };

  let result;
  let refused;
  for (const release of releases(main)) {
    const attempt = planUnder(release.version);
    if (!attempt.refused) {
      result = attempt;
      break;
    }
    refused ??= { version: release.version, why: attempt.refused };
  }
  result ??= planUnder(pins[main]);
  const notes = [...result.notes];
  if (refused) {
    const verb = result.chosen[main] === pins[main] ? "holds" : "caps";
    notes.unshift(
      `::warning::${verb} ${main} at ${result.chosen[main]} rather than ${refused.version}: ${refused.why}`,
    );
  }
  const bumps = names
    .filter((name) => result.chosen[name] !== pins[name])
    .map((name) => {
      const to = result.chosen[name];
      return { name, from: pins[name], to, published: docs.get(name).time?.[to] };
    });
  return { bumps, notes };
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

/**
 * Says whether a line of a new snapshot names a registry version, or an npm alias of one, for each dependency. A
 * snapshot's dependencies pick the packages entries pnpm installs, so a `link:` or `file:` there would install a path.
 */
function snapshotLine(line) {
  const value = /^ {6}(?:'[^']+'|[^\s:'"]+): (.*)$/.exec(line)?.[1];
  return value === undefined || /^[A-Za-z0-9@._/()+~^-]+$/.test(value);
}

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
// A registry version, with the peers pnpm resolved it against in parentheses. No `link:`, `file:` or URL, which would
// install a path or a download in place of the registry's package.
const REGISTRY_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\([^\s:]*\))?$/;

/**
 * Says what is wrong with one importer's new entry, or returns "". `pattern` matches each line whose second group may
 * change; every other line, and the key, must stay as they were.
 */
function importerProblem(name, prior, entry, pattern) {
  const mask = (lines) => trimBlank(lines.map((line) => (pattern ? line.replace(pattern, "$1…") : line)));
  if (entry.key !== prior.key || mask(entry.lines) !== mask(prior.lines)) {
    return pattern ? `changes more of the ${name} importer than an update may` : `changes the ${name} importer`;
  }
  const old = trimBlank(prior.lines).split("\n");
  const changed = trimBlank(entry.lines)
    .split("\n")
    .filter((line, i) => line !== old[i]);
  const valid = pattern === OWN_VALUE ? REGISTRY_VERSION : /^\([^\s:]*\)$/;
  return changed.every((line) => valid.test(pattern.exec(line)?.[2] ?? ""))
    ? ""
    : `the ${name} importer points a dependency at something other than a registry version`;
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
      } else if (section === "snapshots" && !entry.lines.every(snapshotLine)) {
        problems.push(`${file}: the new snapshot ${name} depends on something other than a registry version`);
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

// The package each harness exists to test: the map the book uses to caption its listings with that package's pin.
const mainPackages = path.join(root, "apps/manual/src/data/harnesses.json");

/** The package `harness` exists to test. Throws when the map lacks it, so a new harness can't skip the cap. */
function mainPackage(harness) {
  const main = JSON.parse(readFileSync(mainPackages, "utf8"))[`verify/${harness}`];
  if (typeof main !== "string") throw new Error(`${path.relative(root, mainPackages)} names no package for ${harness}`);
  return main;
}

/**
 * Plans every harness in `names`. `load(harness)` returns its `{ manifest, main }`. A harness whose plan throws, as on
 * a registry error, gets an `::error::` line and is left out, so the others' updates still reach the matrix. Returns
 * the matrix, the lines for the job log, and whether every harness failed.
 */
export async function planMatrix(names, load, registry, now = Date.now()) {
  const include = [];
  const log = [];
  let failed = 0;
  for (const harness of names) {
    let planned;
    try {
      const { manifest, main } = load(harness);
      planned = await planBumps(manifest, main, registry, now);
    } catch (error) {
      log.push(`::error::verify/${harness}: ${error.message}`);
      failed++;
      continue;
    }
    for (const note of planned.notes) log.push(note.replace(/^(::warning::)?/, `$1verify/${harness}: `));
    const { bumps } = planned;
    if (bumps.length > 0) include.push({ harness, bumps: bumps.map((b) => `${b.name}@${b.to}`).join(" ") });
  }
  return { matrix: { include }, log, allFailed: failed > 0 && failed === names.length };
}

async function plan() {
  const load = (harness) => ({
    manifest: JSON.parse(readFileSync(manifestPath(harness), "utf8")),
    main: mainPackage(harness),
  });
  const { matrix, log, allFailed } = await planMatrix(harnesses(), load, registryEntry);
  // stdout carries only the matrix the workflow reads, so the log goes to stderr.
  for (const line of log) process.stderr.write(`${line}\n`);
  process.stdout.write(`${JSON.stringify(matrix)}\n`);
  // sdk-updates.yml runs `matrix=$(… plan)` under bash -e, so a non-zero exit would drop every harness's update. The
  // plan therefore fails only when no harness could be planned, and otherwise leaves each failure as an annotation.
  if (allFailed) process.exitCode = 1;
}

/**
 * Writes the plan job's `bumpsText` into the harness's package.json. It takes the plan's versions rather than asking the
 * registry again, because the check holds the patch to them, and a release that crossed the age cutoff in between
 * would otherwise fail the update. The registry is read only for each version's publish date in the summary.
 */
async function apply(harness, bumpsText) {
  if (!harnesses().includes(harness)) throw new Error(`no harness named ${harness}`);
  const file = manifestPath(harness);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const bumps = [];
  for (const { name, version } of parseBumps(bumpsText)) {
    if (!Object.hasOwn(manifest.dependencies ?? {}, name)) throw new Error(`${name} isn't a dependency of ${harness}`);
    const published = (await registryEntry(name)).time?.[version] ?? "unknown";
    bumps.push({ name, from: manifest.dependencies[name], to: version, published });
  }
  for (const b of bumps) manifest.dependencies[b.name] = b.to;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const b of bumps)
    process.stdout.write(`| \`${b.name}\` | ${b.from} | ${b.to} | ${b.published.slice(0, 10)} |\n`);
}

const [command, arg, ...rest] = process.argv.slice(2);
if (command === "plan") await plan();
else if (command === "apply" && arg && rest.length === 1) await apply(arg, rest[0]);
else if (command === "check" && arg && rest.length === 3) {
  const problems = checkUpdate(process.cwd(), arg, ...rest);
  for (const problem of problems) process.stderr.write(`::error::sdk-updates check: ${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`The ${arg} update changes only its pins, its results and the lockfile.\n`);
} else if (command !== undefined) {
  process.stderr.write(
    "usage: sdk-updates.mjs plan | apply <harness> <bumps> | check <harness> <base> <head> <bumps>\n",
  );
  process.exit(2);
}
