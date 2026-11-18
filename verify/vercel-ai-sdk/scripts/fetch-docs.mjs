// Mirror the agent-relevant core of the Vercel AI SDK docs from the git tag that matches the
// pinned `ai` release. The owner chose this scope (2026-11-18): foundations, agents, harnesses,
// the agent-related AI SDK Core pages and their reference pages, the OpenAI and Anthropic
// providers, and the agent cookbook recipes. Apache-2.0, so the mirror is committed.
// Usage: node scripts/fetch-docs.mjs [version]
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const version = process.argv[2] ?? pkg.dependencies.ai;
const tag = `ai@${version}`;
const out = resolve("../../docs/reference/vercel-ai-sdk/source");

const core = [
  "01-overview",
  "05-generating-text",
  "10-generating-structured-data",
  "15-tools-and-tool-calling",
  "16-mcp-tools",
  "17-mcp-events",
  "17-runtime-and-tool-context",
  "18-code-mode",
  "18-tools",
  "19-tool-search",
  "20-prompt-engineering",
  "25-settings",
  "26-reasoning",
  "40-middleware",
  "50-error-handling",
  "55-testing",
  "60-telemetry",
  "65-lifecycle-callbacks",
  "index",
].map((p) => `content/docs/03-ai-sdk-core/${p}.mdx`);
const reference = [
  "01-generate-text",
  "02-stream-text",
  "15-agent",
  "16-tool-loop-agent",
  "20-tool",
  "22-dynamic-tool",
  "23-create-mcp-client",
  "23-tool-search",
  "24-mcp-events",
  "24-mcp-stdio-transport",
  "25-json-schema",
  "26-zod-schema",
  "28-output",
  "29-filter-active-tools",
  "30-model-message",
  "34-sandbox",
  "40-provider-registry",
  "42-custom-provider",
  "60-wrap-language-model",
  "65-language-model-v2-middleware",
  "70-is-step-count",
  "71-has-tool-call",
  "72-loop-finished",
  "index",
].map((p) => `content/docs/07-reference/01-ai-sdk-core/${p}.mdx`);
const cookbook = [
  "00-guides/06-agent-skills",
  "00-guides/07-custom-memory-tool",
  "00-guides/08-agent-context-compaction",
  "05-node/50-call-tools",
  "05-node/51-call-tools-in-parallel",
  "05-node/53-call-tools-multiple-steps",
  "05-node/54-mcp-tools",
  "05-node/55-manual-agent-loop",
  "05-node/56-web-search-agent",
  "05-node/101-knowledge-base-agent",
].map((p) => `content/cookbook/${p}.mdx`);
const dirs = ["content/docs/02-foundations/", "content/docs/03-agents/", "content/docs/03-ai-sdk-harnesses/"];
const files = [
  "LICENSE",
  ...core,
  ...reference,
  ...cookbook,
  "content/providers/01-ai-sdk-providers/03-openai.mdx",
  "content/providers/01-ai-sdk-providers/05-anthropic.mdx",
];

const work = await mkdtemp(join(tmpdir(), "vai-docs-"));
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
    "https://github.com/vercel/ai",
    work,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
execFileSync("git", ["-C", work, "sparse-checkout", "set", "--no-cone", ...[...dirs, ...files].map((p) => `/${p}`)], {
  stdio: "inherit",
});
const commit = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

await rm(out, { recursive: true, force: true });
for (const p of [...dirs, ...files]) {
  const rel = p.replace(/\/$/, "");
  await mkdir(dirname(join(out, rel)), { recursive: true });
  await cp(join(work, rel), join(out, rel), { recursive: true });
}
await writeFile(
  join(out, "_manifest.json"),
  `${JSON.stringify({ repo: "https://github.com/vercel/ai", tag, commit, fetchedAt: new Date().toISOString(), dirs, files }, null, 2)}\n`,
);
await rm(work, { recursive: true, force: true });
console.log(`Vercel AI SDK docs ${tag} (${commit.slice(0, 7)}) -> ${out}`);
