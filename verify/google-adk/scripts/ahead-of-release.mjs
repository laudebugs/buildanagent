// Classify API mismatches whose missing name exists only after the pinned release.
// @google/adk@2.5.0 is also the latest npm release (as of November 2026), and google.github.io/adk-docs
// renders adk-docs main, so "newer" means the google/adk-js main branch. Sparse-clones main's core/src
// (no install, no scripts) and compares exported names, not any text: an export missing from the pinned
// package counts only if main exports it, and a missing property only if main declares it as a member
// (`name:`, `name?:`, `name(`) of a class or interface. A mismatch counts as ahead of release when every
// API error names something main has and 2.5.0 lacks.
// Rewrites results/typecheck-docs.json, marking such files status "ahead-of-release".
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (root, re) =>
  readdirSync(root, { recursive: true })
    .filter((f) => re.test(f))
    .map((f) => readFileSync(join(root, f), "utf8"))
    .join("\n");
// Names a source exports: declarations and export lists.
const exportedNames = (text) => {
  const names = new Set();
  for (const m of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|enum|type|interface)\s+(\w+)/g,
  ))
    names.add(m[1]);
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g))
    for (const part of m[1].split(",")) {
      const n = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1);
      if (/^\w+$/.test(n)) names.add(n);
    }
  return names;
};
const declaresMember = (text, n) =>
  new RegExp(
    `^\\s+(?:readonly\\s+|static\\s+|async\\s+|get\\s+|set\\s+|protected\\s+|public\\s+)*${n}\\??\\s*[:(<]`,
    "m",
  ).test(text);

try {
  await fetch("https://registry.npmjs.org/@google%2Fadk/latest", { signal: AbortSignal.timeout(10000) });
} catch {
  console.warn("ahead-of-release: network unreachable; leaving api-mismatch statuses unchanged");
  process.exit(0);
}
const latest = {
  "@google/adk": (await (await fetch("https://registry.npmjs.org/@google%2Fadk/latest")).json()).version,
};

const dir = mkdtempSync(join(tmpdir(), "adk-main-"));
let mainText = "";
let mainCommit = "";
try {
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "inherit"] }).toString();
  git("init", "-q");
  git("remote", "add", "origin", "https://github.com/google/adk-js.git");
  git("sparse-checkout", "set", "--no-cone", "/core/src/");
  git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", "main");
  git("checkout", "-q", "FETCH_HEAD");
  mainCommit = git("rev-parse", "HEAD").trim();
  mainText = read(join(dir, "core/src"), /\.ts$/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const pinnedText = read("node_modules/@google/adk/dist/types", /\.d\.ts$/);
const mainExports = exportedNames(mainText);
const pinnedExports = exportedNames(pinnedText);

const results = JSON.parse(readFileSync("results/typecheck-docs.json", "utf8"));
let ahead = 0;
for (const r of results.filter((r) => r.status === "api-mismatch")) {
  const api = r.errors.filter((e) => e.kind === "api");
  const verdicts = api.map((e) => {
    const exp = e.message.match(/Module '"@google\/adk"' has no exported member(?: named)? '(\w+)'/)?.[1];
    if (exp) return mainExports.has(exp) && !pinnedExports.has(exp) ? exp : null;
    const prop =
      e.message.match(/Property '(\w+)' does not exist/)?.[1] ?? e.message.match(/'(\w+)' does not exist in type/)?.[1];
    // A member missing on an untyped value (unknown, {}) is the doc's own typing, not an SDK name.
    if (!prop || /on type '(unknown|\{\})'/.test(e.message)) return null;
    return declaresMember(mainText, prop) && !declaresMember(pinnedText, prop) ? prop : null;
  });
  if (verdicts.length && verdicts.every(Boolean)) {
    r.status = "ahead-of-release";
    r.aheadOf = [...new Set(verdicts)];
    ahead++;
  }
}
writeFileSync("results/typecheck-docs.json", JSON.stringify(results, null, 2));
const newOnMain = [...mainExports].filter((n) => !pinnedExports.has(n)).sort();
writeFileSync(
  "results/latest-releases.json",
  `${JSON.stringify({ checkedAt: new Date().toISOString(), latest, main: mainCommit, exportsOnMainNotIn250: newOnMain }, null, 2)}\n`,
);
console.log(
  `latest: ${JSON.stringify(latest)}, main ${mainCommit.slice(0, 7)} (${newOnMain.length} exported names not in 2.5.0)\n${ahead} api-mismatch files only use names from main`,
);
