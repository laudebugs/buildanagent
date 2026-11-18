// Compares each committed verify/*/results/*.json with the working copy after a run, ignoring what
// legitimately varies between runs: timings ("ms", "checkedAt"), the checkout path and temp dirs.
// Exits 1 and lists the files whose normalized content changed, so a scheduled verify flags drift.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const VOLATILE = new Set(["ms", "checkedAt"]);

function normString(s) {
  return s
    .split(`${root}/`)
    .join("<repo>/")
    .replace(/\/home\/[^/\s"']+\/[^/\s"']+\//g, "<repo>/")
    .replace(/\/(?:tmp|var\/folders)\/[^\s"']+/g, "<tmp>")
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms");
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

const changed = execFileSync("git", ["diff", "--name-only", "--", "verify/*/results/*.json"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

const drifted = [];
for (const file of changed) {
  let before;
  try {
    before = JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8" }));
  } catch {
    drifted.push(`${file} (new file)`);
    continue;
  }
  const after = JSON.parse(readFileSync(path.join(root, file), "utf8"));
  if (JSON.stringify(norm(before)) !== JSON.stringify(norm(after))) drifted.push(file);
}

const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "verify/*/results/"], {
  cwd: root,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);
drifted.push(...untracked.map((f) => `${f} (untracked)`));

if (drifted.length) {
  console.error("results drifted from the committed run:");
  for (const f of drifted) console.error(`  ${f}`);
  console.error("Review the diff, decide whether the docs, the SDK or the harness changed, then commit or fix.");
  process.exit(1);
}
console.log(`results-drift: ${changed.length} result file(s) touched, none drifted after normalization`);
