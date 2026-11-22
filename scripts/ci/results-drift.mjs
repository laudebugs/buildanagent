// Compares each committed verify/*/results/*.json with the working copy after a run, ignoring what
// legitimately varies between runs: timings ("ms", "checkedAt"), raw stdout ("tail"), the checkout path
// and temp dirs. For our own examples (run-examples.json) it compares only each example's verdict.
// Transcripts (results/transcripts/*.json, in verify/* and in our own packages/*) are written normalised, so they
// are compared byte for byte; a transcript a run wrote that is not committed, a committed one the run deleted, and a
// committed one whose example no longer exists also count as drift.
// Exits 1 and lists the files whose normalized content changed, so a scheduled verify flags drift.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
// "tail" is a run's raw stdout (process ids, interleaved logs), so it is diagnostic, not a result.
const VOLATILE = new Set(["ms", "checkedAt", "tail"]);
// Our own examples assert their claims themselves, so for run-examples.json only the verdict counts;
// counters such as modelRequests vary with runtime retries and are not compared.
const VERDICT = ["file", "outcome", "exit"];
const verdicts = (v) =>
  Array.isArray(v) ? v.map((e) => Object.fromEntries(VERDICT.filter((k) => k in e).map((k) => [k, e[k]]))) : v;

function normString(s) {
  return (
    s
      .split(`${root}/`)
      .join("<repo>/")
      .replace(/\/home\/[^/\s"']+\/[^/\s"']+\//g, "<repo>/")
      .replace(/\/(?:tmp|var\/folders)\/[^\s"']+/g, "<tmp>")
      .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms")
      // Stack frames of bundled code: line and column move with the bundle, not with the result.
      .replace(/(\.m?[jt]s):\d+:\d+/g, "$1:<l>:<c>")
  );
}

function norm(v) {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) if (!VOLATILE.has(k)) out[k] = norm(x);
    return out;
  }
  return typeof v === "string" ? normString(v) : v;
}

// Collects "path: before -> after" for each differing leaf, so a CI log shows what changed.
function diff(a, b, at, out) {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], `${at}/${k}`, out);
    return;
  }
  const show = (v) => (v === undefined ? "(absent)" : JSON.stringify(v).slice(0, 160));
  out.push(`${at || "/"}: ${show(a)} -> ${show(b)}`);
}

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean);
// A git pathspec's "*" also matches "/", so this covers results/transcripts/ too.
// Our own packages keep only transcripts under results/, which the shared runner in scripts/transcripts/book-examples.ts writes for each package.
const PACKAGE_TRANSCRIPTS = "packages/*/results/transcripts/*.json";
const changed = git("diff", "--name-only", "--", "verify/*/results/*.json", PACKAGE_TRANSCRIPTS);
const TRANSCRIPT = /^(?:verify|packages)\/[^/]+\/results\/transcripts\/[^/]+\.json$/;

const drifted = [];
for (const file of changed) {
  if (!existsSync(path.join(root, file))) {
    drifted.push(`${file} (deleted)`);
    continue;
  }
  if (TRANSCRIPT.test(file)) {
    // A transcript holds no machine- or run-specific value, so any change is a change in behaviour.
    drifted.push(file);
    const diffs = [];
    diff(
      JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8" })),
      JSON.parse(readFileSync(path.join(root, file), "utf8")),
      "",
      diffs,
    );
    for (const d of diffs.slice(0, 12)) console.error(`  ${file}: ${d}`);
    if (diffs.length > 12) console.error(`  ${file}: … ${diffs.length - 12} more`);
    if (diffs.length === 0)
      console.error(`  ${file}: same JSON, different bytes; regenerate it with the harness's pnpm test`);
    continue;
  }
  let before;
  try {
    before = JSON.parse(
      execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }),
    );
  } catch {
    drifted.push(`${file} (new file)`);
    continue;
  }
  const after = JSON.parse(readFileSync(path.join(root, file), "utf8"));
  const pick = file.endsWith("/run-examples.json") ? verdicts : (v) => v;
  const diffs = [];
  diff(norm(pick(before)), norm(pick(after)), "", diffs);
  if (diffs.length) {
    drifted.push(file);
    for (const d of diffs.slice(0, 12)) console.error(`  ${file}: ${d}`);
    if (diffs.length > 12) console.error(`  ${file}: … ${diffs.length - 12} more`);
  }
}

const untracked = git("ls-files", "--others", "--exclude-standard", "--", "verify/*/results/*", PACKAGE_TRANSCRIPTS);
drifted.push(...untracked.map((f) => `${f} (untracked)`));

// A transcript stays committed after its example is renamed or deleted unless someone removes it.
for (const file of git("ls-files", "--", "verify/*/results/transcripts/*.json", PACKAGE_TRANSCRIPTS)) {
  const [, harness, name] = /^((?:verify|packages)\/[^/]+)\/results\/transcripts\/(.+)\.json$/.exec(file) ?? [];
  if (harness === undefined) continue;
  const examples = path.join(root, harness, "examples");
  const found = [".ts", ".mts", ".tsx"].some((ext) => existsSync(path.join(examples, `${name}${ext}`)));
  if (!found) drifted.push(`${file} (no example ${harness}/examples/${name}.ts)`);
}

if (drifted.length) {
  console.error("results drifted from the committed run:");
  for (const f of drifted) console.error(`  ${f}`);
  console.error("Review the diff, decide whether the docs, the SDK or the harness changed, then commit or fix.");
  process.exit(1);
}
console.log(`results-drift: ${changed.length} result file(s) touched, none drifted after normalization`);
