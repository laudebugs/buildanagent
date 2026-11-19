// Run complete, type-clean LangChain doc examples offline with a scripted model.
// Doc examples run unmodified under scripts/scripted-preload.mjs, which swaps the Anthropic and OpenAI chat
// models (including string model ids) for scripted ones and blocks non-local network access. Each run gets a temp cwd
// (with fixtures/), an allowlisted environment and a timeout.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2]
// For a directory other than extracted/, every *.ts file is run (our own examples).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { transcriptRun } from "../../../scripts/transcripts/write.mjs";

const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "extracted");
const ownExamples = !dir.endsWith("extracted");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;
const TIMEOUT_MS = Number(process.env.EXAMPLE_TIMEOUT_MS ?? 60000);
const CONCURRENCY = Number(process.env.EXAMPLE_CONCURRENCY ?? 4);
const root = resolve(".");
// Resolve tsx from the workspace (pnpm keeps shared dev tools at the repo root).
const TSX = import.meta.resolve("tsx");

// Sources that need things the offline harness cannot provide. Order matters: first match wins.
const EXTERNAL = [
  [/export (async )?function (POST|GET)\b|from ['"]next\/server['"]/, "server route handler (needs an HTTP request)"],
  [/checkpoint-(postgres|mongodb|redis|sqlite)|from ['"](mongodb|pg|redis|ioredis)['"]/, "external database"],
  [/MultiServerMCPClient|@langchain\/mcp-adapters|@modelcontextprotocol\//, "external MCP server"],
  [
    /from ['"]deepagents['"]|@langchain\/langgraph-sdk|from ['"]langsmith/,
    "package outside the pinned set (Deep Agents, LangGraph SDK, LangSmith)",
  ],
  [/Embeddings\(|embedQuery|embedDocuments|index:\s*\{[^}]*embed/, "embedding model (not mocked)"],
  [/from ['"]@langchain\/(?!core|langgraph|anthropic|openai)[\w-]+/, "provider or integration outside the pinned set"],
  [
    /["'`](google|google-genai|google-vertexai|openrouter|fireworks|baseten|ollama|bedrock|groq|mistralai|azure_openai|together|deepseek|xai|cohere|cerebras):/,
    "provider outside the pinned set",
  ],
  [/initChatModel\(\s*["'`](?!(anthropic|openai):|gpt-|claude-|o\d)/, "provider outside the pinned set"],
  [/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)/, "third-party credential"],
];
const needsExternal = (code) => EXTERNAL.find(([re]) => re.test(code))?.[1] ?? null;

let targets;
if (!ownExamples) {
  const manifest = JSON.parse(await readFile(join(dir, "_manifest.json"), "utf8"));
  const tc = existsSync("results/typecheck-docs.json")
    ? Object.fromEntries(JSON.parse(await readFile("results/typecheck-docs.json", "utf8")).map((r) => [r.id, r.status]))
    : {};
  targets = manifest
    .filter((m) => m.complete && tc[m.id] === "pass")
    .map((m) => ({ id: m.id, file: join(dir, m.file), pages: m.pages }));
} else {
  targets = (await readdir(dir))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ id: f.replace(/\.ts$/, ""), file: join(dir, f) }));
}
if (only) targets = targets.filter((t) => only.has(t.id));
await mkdir("results", { recursive: true });

async function runOne(t) {
  const code = await readFile(t.file, "utf8");
  // Our own examples are offline by construction (in-process MCP server included).
  const ext = ownExamples ? null : needsExternal(code);
  if (ext) return { ...t, outcome: "skipped", reason: ext };
  const cwd = await mkdtemp(join(tmpdir(), "lc-ex-"));
  if (existsSync(join(root, "fixtures"))) await cp(join(root, "fixtures"), cwd, { recursive: true });
  const log = join(await mkdtemp(join(tmpdir(), "lc-log-")), "model-calls");
  // Allowlisted environment: no inherited credentials can reach a real provider.
  const env = {
    PATH: process.env.PATH,
    HOME: dirname(log),
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
    MOCK_LOG: log,
  };
  const args = ["--import", TSX];
  if (!ownExamples) args.push("--import", join(root, "scripts/scripted-preload.mjs"));
  // Our own examples also record their model exchange and checks as a transcript (results/transcripts/).
  const transcript = ownExamples ? transcriptRun(args, env) : undefined;
  args.push(resolve(t.file));
  const started = Date.now();
  const result = await new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ exit: null, timedOut: true, out });
    }, TIMEOUT_MS);
    child.on("close", (exit) => {
      clearTimeout(timer);
      done({ exit, timedOut: false, out });
    });
  });
  // A bare model id the SDK can't infer a provider for is a doc error that hides everything after
  // it. Record it, then rerun a copy with the provider prefix added, to exercise the rest.
  if (!ownExamples && /Unable to infer model provider/.test(result.out)) {
    const patched = join(dirname(resolve(t.file)), `${t.id}.prefixed.ts`);
    await writeFile(patched, code.replace(/(["'`])(gpt-[\w.-]+)\1/g, "$1openai:$2$1"));
    const rerun = await runOne({ ...t, file: patched, rerun: true });
    return {
      ...t,
      outcome: "error",
      reason: "uninferable model id",
      prefixedOutcome: rerun.outcome,
      modelCalls: rerun.modelCalls,
      tail: rerun.tail,
    };
  }
  const modelCalls = existsSync(log) ? Number(await readFile(log, "utf8")) : 0;
  const blocked = /network disabled \(blocked ([^)]+)\)/.exec(result.out)?.[1];
  transcript?.write({ harnessDir: root, exampleFile: resolve(t.file), cwd });
  // Our own examples assert their behaviour, so exit 0 is a pass.
  // A block whose comments say a call throws, and that exits with that error, ran as documented.
  const throwsAsDocumented =
    !ownExamples &&
    result.exit !== 0 &&
    [...code.matchAll(/\/\/ throws "([^"]+)"/g)].some((m) => result.out.includes(m[1]));
  const outcome = throwsAsDocumented
    ? "ran-throws-as-documented"
    : result.timedOut
      ? "timeout"
      : result.exit !== 0
        ? "error"
        : modelCalls > 0 || ownExamples
          ? "ran"
          : "ran-no-model";
  return {
    ...t,
    outcome,
    exit: result.exit,
    ms: Date.now() - started,
    modelCalls,
    blockedHost: blocked,
    tail: result.out.trim().split("\n").slice(-8).join("\n").slice(-1200),
  };
}

const results = [];
const queue = [...targets];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const r = await runOne(t);
      results.push(r);
      console.log(`${r.outcome.padEnd(13)} ${r.id}${r.reason ? ` (${r.reason})` : ""}`);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
// A partial run (--only) must not overwrite the full results file.
if (!only) {
  await writeFile(
    ownExamples ? "results/run-examples.json" : "results/run-docs.json",
    JSON.stringify(results, null, 2),
  );
}
const tally = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
console.log(`\n${results.length} examples:`, tally);
process.exitCode = ownExamples && results.some((r) => r.outcome !== "ran") ? 1 : 0;
