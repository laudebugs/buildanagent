// Classify API mismatches whose missing name exists in a newer release: those pages run ahead of
// the pinned packages (the docs mirror is from main, not a release tag). Downloads the latest
// tarballs of the pinned packages into a temp dir (no install, no scripts) and greps their .d.ts.
// Rewrites results/typecheck-docs.json, marking such files status "ahead-of-release".
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKGS = ["langchain", "@langchain/core", "@langchain/langgraph", "@langchain/anthropic", "@langchain/openai"];
const dir = mkdtempSync(join(tmpdir(), "lc-latest-"));
const dts = (root) =>
  readdirSync(root, { recursive: true })
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => readFileSync(join(root, f), "utf8"))
    .join("\n");

const latest = {};
let latestText = "";
try {
  await fetch("https://registry.npmjs.org/langchain/latest", { signal: AbortSignal.timeout(10000) });
} catch {
  console.warn("ahead-of-release: npm registry unreachable; leaving api-mismatch statuses unchanged");
  process.exit(0);
}
for (const p of PKGS) {
  const meta = await (await fetch(`https://registry.npmjs.org/${p.replace("/", "%2F")}/latest`)).json();
  latest[p] = meta.version;
  const tgz = join(dir, `${p.replace(/\W/g, "_")}.tgz`);
  writeFileSync(tgz, Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer()));
  const out = join(dir, p.replace(/\W/g, "_"));
  execFileSync("mkdir", ["-p", out]);
  execFileSync("tar", ["-xzf", tgz, "-C", out]);
  latestText += dts(out);
}
const pinnedText = PKGS.map((p) => dts(join("node_modules", p, "dist"))).join("\n");

// The name a mismatch says is missing: "Property 'x' does not exist", "no exported member 'x'",
// "'x' does not exist in type".
const missingName = (msg) =>
  msg.match(/Property '(\w+)' does not exist/)?.[1] ??
  msg.match(/no exported member(?: named)? '(\w+)'/)?.[1] ??
  msg.match(/and '(\w+)' does not exist in type/)?.[1];

const results = JSON.parse(readFileSync("results/typecheck-docs.json", "utf8"));
let ahead = 0;
for (const r of results.filter((r) => r.status === "api-mismatch")) {
  const api = r.errors.filter((e) => e.kind === "api");
  const names = api.map((e) => missingName(e.message));
  const isAhead = (n) => n && new RegExp(`\\b${n}\\b`).test(latestText) && !new RegExp(`\\b${n}\\b`).test(pinnedText);
  if (names.length && names.every(isAhead)) {
    r.status = "ahead-of-release";
    r.aheadOf = [...new Set(names)];
    ahead++;
  }
}
writeFileSync("results/typecheck-docs.json", JSON.stringify(results, null, 2));
writeFileSync(
  "results/latest-releases.json",
  `${JSON.stringify({ checkedAt: new Date().toISOString(), latest }, null, 2)}\n`,
);
console.log(`latest: ${JSON.stringify(latest)}\n${ahead} api-mismatch files only use names from newer releases`);
