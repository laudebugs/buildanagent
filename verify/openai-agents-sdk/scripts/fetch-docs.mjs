// Mirror the OpenAI Agents SDK (JS) docs from the git tag that matches the pinned npm release.
// The docs are MDX pages whose code lives in examples/docs/*.ts, imported with `?raw`; the mirror
// keeps the repo's layout so those relative imports still resolve. MIT-licensed, so it is committed.
// Translations (ja, ko, zh) and the standalone example apps are left out.
// Usage: node scripts/fetch-docs.mjs [version]
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = process.argv[2] ?? pkg.dependencies["@openai/agents"];
const tag = `v${version}`;
const out = resolve("../../docs/reference/openai-agents-sdk/source");
const work = await mkdtemp(join(tmpdir(), "oai-docs-"));
// examples/basic/prompt-id.ts is the one embedded file outside examples/docs.
const paths = [
  "/LICENSE",
  "/packages/agents/README.md",
  "/docs/src/content/docs/",
  "/examples/docs/",
  "/examples/basic/prompt-id.ts",
];
const translations = ["ja", "ko", "zh"];

execFileSync(
  "git",
  [
    "-c",
    "advice.detachedHead=false",
    "clone",
    "-q",
    "--depth",
    "1",
    "--branch",
    tag,
    "--filter=blob:none",
    "--sparse",
    "https://github.com/openai/openai-agents-js",
    work,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
execFileSync("git", ["-C", work, "sparse-checkout", "set", "--no-cone", ...paths], { stdio: "inherit" });
const commit = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const p of paths) {
  const rel = p.replace(/^\//, "").replace(/\/$/, "");
  await mkdir(join(out, rel, ".."), { recursive: true });
  await cp(join(work, rel), join(out, rel), { recursive: true });
}
for (const lang of translations) {
  await rm(join(out, "docs/src/content/docs", lang), { recursive: true, force: true });
}
await writeFile(
  join(out, "_manifest.json"),
  `${JSON.stringify(
    {
      repo: "https://github.com/openai/openai-agents-js",
      tag,
      commit,
      fetchedAt: new Date().toISOString(),
      paths,
      excluded: [
        "docs translations: ja, ko, zh",
        "examples/* apps other than examples/docs (not embedded in the docs)",
      ],
    },
    null,
    2,
  )}\n`,
);
await rm(work, { recursive: true, force: true });
console.log(`OpenAI Agents SDK docs ${tag} (${commit.slice(0, 7)}) -> ${out}`);
