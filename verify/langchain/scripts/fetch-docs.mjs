// Mirror the LangChain.js agent docs from the MIT-licensed langchain-ai/docs repo.
// The docs repo has no tags matching the npm releases, so the mirror pins a commit (COMMIT) and
// records it in source/_manifest.json. Only the in-scope pages are copied, plus the snippet files
// they import and the license. Pages mix Python and JS; the extractor keeps only the JS variants.
// Usage: node scripts/fetch-docs.mjs
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = "https://github.com/langchain-ai/docs.git";
const COMMIT = "9d9747d0cf241e086c616a16d5ce230ad8f8f31d"; // main on 2026-11-18 (committed 2026-11-17)
const OUT = resolve("../../docs/reference/langchain/source");

const LANGCHAIN = [
  "overview", "install", "quickstart", "philosophy", "component-architecture",
  "agents", "models", "messages", "tools", "short-term-memory", "long-term-memory",
  "streaming", "event-streaming", "structured-output", "runtime", "context-engineering",
  "human-in-the-loop", "guardrails",
  "middleware/overview", "middleware/built-in", "middleware/custom",
  "mcp/index", "mcp/tools", "mcp/connections",
  "multi-agent/index", "multi-agent/subagents", "multi-agent/handoffs", "multi-agent/router", "multi-agent/skills",
  "test/index", "test/unit-testing", "test/integration-testing",
].map((p) => `src/oss/langchain/${p}.mdx`);
const LANGGRAPH = [
  "overview", "quickstart", "workflows-agents", "persistence", "checkpointers", "add-memory",
  "interrupts", "streaming", "fault-tolerance", "use-time-travel", "functional-api", "graph-api",
].map((p) => `src/oss/langgraph/${p}.mdx`);
const PAGES = [...LANGCHAIN, ...LANGGRAPH];

const tmp = await mkdtemp(join(tmpdir(), "lc-docs-"));
const git = (...args) => execFileSync("git", args, { cwd: tmp, stdio: ["ignore", "pipe", "inherit"] }).toString();
try {
  git("init", "-q");
  git("remote", "add", "origin", REPO);
  git("config", "core.sparseCheckout", "true");
  git("sparse-checkout", "set", "--no-cone", "/LICENSE", "/src/oss/langchain/", "/src/oss/langgraph/", "/src/snippets/");
  git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", COMMIT);
  git("checkout", "-q", "FETCH_HEAD");
  const committedAt = git("log", "-1", "--format=%cI").trim();

  await rm(OUT, { recursive: true, force: true });
  const files = ["LICENSE", ...PAGES];
  const snippets = new Set();
  for (const page of PAGES) {
    const text = await readFile(join(tmp, page), "utf8");
    for (const m of text.matchAll(/from ['"]\/snippets\/([^'"]+)['"]/g)) {
      // Keep JS-specific and language-neutral snippets; skip Python-only tabs.
      if (!/(^|[-/])py(\.|-)|-py\.mdx$|chat-model-tabs\.mdx$|embeddings-tabs-py|vectorstore-tabs-py/.test(m[1])) snippets.add(`src/snippets/${m[1]}`);
    }
  }
  for (const f of [...files, ...snippets]) {
    await mkdir(dirname(join(OUT, f)), { recursive: true });
    await cp(join(tmp, f), join(OUT, f));
  }
  const manifest = {
    repo: REPO.replace(/\.git$/, ""),
    commit: COMMIT,
    committedAt,
    fetchedAt: new Date().toISOString(),
    note: "No docs tag matches the pinned npm versions; pages may describe newer releases.",
    pages: PAGES,
    snippets: [...snippets].sort(),
  };
  await writeFile(join(OUT, "_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`mirrored ${PAGES.length} pages and ${snippets.size} snippets from ${COMMIT.slice(0, 7)} (${committedAt})`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
