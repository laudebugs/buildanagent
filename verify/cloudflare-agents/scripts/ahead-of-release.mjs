// Classify API mismatches whose missing name exists only after the pinned release.
// agents@0.33.0 and @cloudflare/think@0.23.0 are also the latest npm releases (as of November
// 2026), so "newer" means the cloudflare/agents main branch, which developers.cloudflare.com and
// the repo docs track. Sparse-clones main's package sources (no install, no scripts) and greps them;
// also checks npm for a release newer than the pin. A mismatch counts as ahead of release when
// every missing name (or missing subpath export) appears on main and not in the pinned .d.ts files.
// Rewrites results/typecheck-docs.json, marking such files status "ahead-of-release".
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PKGS = {
  agents: "packages/agents",
  "@cloudflare/think": "packages/think",
  "@cloudflare/ai-chat": "packages/ai-chat",
};
const read = (root, re) =>
  readdirSync(root, { recursive: true })
    .filter((f) => re.test(f))
    .map((f) => readFileSync(join(root, f), "utf8"))
    .join("\n");

try {
  await fetch("https://registry.npmjs.org/agents/latest", { signal: AbortSignal.timeout(10000) });
} catch {
  console.warn("ahead-of-release: network unreachable; leaving api-mismatch statuses unchanged");
  process.exit(0);
}
const latest = {};
for (const p of Object.keys(PKGS))
  latest[p] = (await (await fetch(`https://registry.npmjs.org/${p.replace("/", "%2F")}/latest`)).json()).version;

const dir = mkdtempSync(join(tmpdir(), "cf-main-"));
let mainText = "";
let mainCommit = "";
const mainExports = {};
try {
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "inherit"] }).toString();
  git("init", "-q");
  git("remote", "add", "origin", "https://github.com/cloudflare/agents.git");
  git(
    "sparse-checkout",
    "set",
    "--no-cone",
    ...Object.values(PKGS).flatMap((p) => [`/${p}/src/`, `/${p}/package.json`]),
  );
  git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", "main");
  git("checkout", "-q", "FETCH_HEAD");
  mainCommit = git("rev-parse", "HEAD").trim();
  for (const [name, p] of Object.entries(PKGS)) {
    mainText += read(join(dir, p, "src"), /\.tsx?$/);
    mainExports[name] = Object.keys(JSON.parse(readFileSync(join(dir, p, "package.json"), "utf8")).exports ?? {});
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const pinnedText = Object.keys(PKGS)
  .map((p) => read(join("node_modules", p, "dist"), /\.d\.ts$/))
  .join("\n");
const pinnedExports = Object.fromEntries(
  Object.keys(PKGS).map((p) => [
    p,
    Object.keys(JSON.parse(readFileSync(join("node_modules", p, "package.json"), "utf8")).exports ?? {}),
  ]),
);

// The name a mismatch says is missing.
const missingName = (msg) =>
  msg.match(/Property '(\w+)' does not exist/)?.[1] ??
  msg.match(/no exported member(?: named)? '(\w+)'/)?.[1] ??
  msg.match(/and '(\w+)' does not exist in type/)?.[1];
// A missing subpath of an installed package: "Cannot find module 'agents/x'".
const missingSubpath = (msg) => {
  const spec = msg.match(/Cannot find module '([^']+)'/)?.[1];
  const pkg = spec && Object.keys(PKGS).find((p) => spec === p || spec.startsWith(`${p}/`));
  return pkg ? { pkg, sub: `.${spec.slice(pkg.length)}` } : null;
};
// Reviewed by hand: names that appear on main by coincidence (calling-llms.mdx calls its own
// `this.systemPrompt()` helper, which the page never defines).
const NOT_AHEAD = new Set(["systemPrompt"]);
const has = (text, n) => new RegExp(`\\b${n}\\b`).test(text);

const results = JSON.parse(readFileSync("results/typecheck-docs.json", "utf8"));
let ahead = 0;
for (const r of results.filter((r) => r.status === "api-mismatch")) {
  const api = r.errors.filter((e) => e.kind === "api");
  const verdicts = api.map((e) => {
    const sp = missingSubpath(e.message);
    if (sp)
      return mainExports[sp.pkg].includes(sp.sub) && !pinnedExports[sp.pkg].includes(sp.sub)
        ? `${sp.pkg}${sp.sub.slice(1)}`
        : null;
    // A member missing on an untyped value (unknown, {}) is the doc's own typing, not an SDK name.
    if (/on type '(unknown|\{\})'/.test(e.message)) return null;
    const n = missingName(e.message);
    return n && !NOT_AHEAD.has(n) && has(mainText, n) && !has(pinnedText, n) ? n : null;
  });
  if (verdicts.length && verdicts.every(Boolean)) {
    r.status = "ahead-of-release";
    r.aheadOf = [...new Set(verdicts)];
    ahead++;
  }
}
writeFileSync("results/typecheck-docs.json", JSON.stringify(results, null, 2));
writeFileSync(
  "results/latest-releases.json",
  `${JSON.stringify({ checkedAt: new Date().toISOString(), latest, main: mainCommit }, null, 2)}\n`,
);
console.log(
  `latest: ${JSON.stringify(latest)}, main ${mainCommit.slice(0, 7)}\n${ahead} api-mismatch files only use names from main`,
);
