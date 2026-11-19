// Run complete, type-clean AI SDK doc examples offline with a mock model.
// Doc examples run unmodified under scripts/mock-preload.mjs, which swaps provider models and the
// default (gateway) provider for mocks and blocks non-local network access. Each run gets a temp cwd
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
  [/from ['"](workflow|workflow\/api|@ai-sdk\/workflow(-harness)?)['"]/, "durable workflow runtime"],
  [/@vercel\/sandbox|@ai-sdk\/sandbox-vercel|just-bash/, "sandbox runtime"],
  [
    /@ai-sdk\/harness-claude-code|@ai-sdk\/tui|@ai-sdk\/policy-opa|@ai-sdk\/code-mode/,
    "package outside the pinned set",
  ],
  [/createMCPClient|@modelcontextprotocol\/sdk/, "external MCP server"],
  [/\buploadFile\s*\(|\.files\(\)/, "provider Files API"],
  [
    /\b(embed|embedMany|generateImage|experimental_generateImage|generateSpeech|transcribe|rerank)\s*\(/,
    "embedding, image or speech model (not mocked)",
  ],
  [
    /from ['"]@ai-sdk\/(?!openai|anthropic|provider|provider-utils|mcp|harness|otel)[\w-]+['"]/,
    "provider outside the pinned set",
  ],
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
  const cwd = await mkdtemp(join(tmpdir(), "vai-ex-"));
  if (existsSync(join(root, "fixtures"))) await cp(join(root, "fixtures"), cwd, { recursive: true });
  const log = join(await mkdtemp(join(tmpdir(), "vai-log-")), "model-calls");
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
  if (!ownExamples) args.push("--import", join(root, "scripts/mock-preload.mjs"));
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
  const modelCalls = existsSync(log) ? Number(await readFile(log, "utf8")) : 0;
  const blocked = /network disabled \(blocked ([^)]+)\)/.exec(result.out)?.[1];
  transcript?.write({ harnessDir: root, exampleFile: resolve(t.file), cwd });
  // Our own examples assert their behaviour, so exit 0 is a pass.
  const outcome = result.timedOut
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
