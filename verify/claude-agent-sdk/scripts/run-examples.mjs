// Run complete, type-clean examples against the mock Anthropic API.
// Each example gets its own mock server (so its request log is isolated), a temp cwd and a timeout.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2]
// For a directory other than extracted/, every *.ts file is run (our own examples), and each one's model exchange and
// checks are written to results/transcripts/.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { transcriptRun } from "../../../scripts/transcripts/write.mjs";
import { startMock } from "./mock-anthropic.mjs";

const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "extracted");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;
const TIMEOUT_MS = Number(process.env.EXAMPLE_TIMEOUT_MS ?? 60000);
const CONCURRENCY = Number(process.env.EXAMPLE_CONCURRENCY ?? 4);
const root = resolve(".");
// Resolve tsx from the workspace (pnpm keeps shared dev tools at the repo root).
const TSX = import.meta.resolve("tsx");

// Blocks that need things the offline harness cannot provide.
const needsExternal = (code) =>
  /command:\s*["'](npx|uvx|node|python|docker)/.test(code)
    ? "external MCP server process"
    : /url:\s*["']https?:\/\//.test(code)
      ? "remote MCP/HTTP endpoint"
      : /process\.env\.(?!ANTHROPIC)[A-Z_]*(KEY|TOKEN|SECRET)/.test(code)
        ? "third-party credential"
        : /CLAUDE_CODE_USE_(BEDROCK|VERTEX)/.test(code)
          ? "cloud provider"
          : null;

let targets;
if (dir.endsWith("extracted")) {
  const manifest = JSON.parse(await readFile(join(dir, "_manifest.json"), "utf8"));
  const tc = existsSync("results/typecheck-docs.json")
    ? Object.fromEntries(JSON.parse(await readFile("results/typecheck-docs.json", "utf8")).map((r) => [r.id, r.status]))
    : {};
  targets = manifest
    .filter((m) => m.complete && tc[m.id] === "pass")
    .map((m) => ({ id: m.id, file: join(dir, `${m.id}.ts`), page: m.page, line: m.line }));
} else {
  targets = (await readdir(dir))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ id: f.replace(/\.ts$/, ""), file: join(dir, f) }));
}
if (only) targets = targets.filter((t) => only.has(t.id));

await mkdir(".tmp/logs", { recursive: true });

async function runOne(t) {
  const code = await readFile(t.file, "utf8");
  const ext = needsExternal(code);
  if (ext) return { ...t, outcome: "skipped", reason: ext };
  // Docs use placeholder folders ("/path/to/repo", "/work/session-a"); point them at a real temp dir.
  const cwd = await mkdtemp(join(tmpdir(), `ex-${t.id}-`));
  const placeholder = /(["'`])(\/path\/to\/[^"'`]*|\/work\/[^"'`]*)\1/g;
  const patched = placeholder.test(code);
  let runFile = t.file;
  if (patched) {
    await mkdir(".tmp/patched", { recursive: true });
    runFile = resolve(`.tmp/patched/${t.id}.ts`);
    await writeFile(runFile, code.replace(placeholder, JSON.stringify(cwd)));
  }
  // Files and env vars some examples expect (see fixtures/).
  await cp(join(root, "fixtures"), cwd, { recursive: true });
  const log = resolve(`.tmp/logs/${t.id}.jsonl`);
  await writeFile(log, "");
  // Our own examples also record their model exchange and checks as a transcript (results/transcripts/). The mock
  // runs in this process and the example in a child, so the mock reports its events here and the writer merges them
  // with the example's checks.
  const ownExamples = !dir.endsWith("extracted");
  const mockEvents = [];
  const server = await startMock(
    0,
    log,
    ownExamples ? (event) => mockEvents.push({ ...event, at: Date.now() }) : undefined,
  );
  // Allowlisted environment: no inherited credentials or host config reach the spawned CLI.
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
    ANTHROPIC_API_KEY: "sk-ant-mock-not-a-real-key",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CONFIG_DIR: join(cwd, ".claude-config"),
    TASK_PROMPT: "Summarize the files in this directory",
    MOCK_LOG: log,
  };
  const args = ["--import", TSX];
  const transcript = ownExamples ? transcriptRun(args, env) : undefined;
  args.push(runFile);
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
  server.close();
  transcript?.write({ harnessDir: root, exampleFile: resolve(t.file), cwd, mockEvents });
  const requests = (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.path.endsWith("/v1/messages"));
  const toolCalls = requests
    .flatMap((r) => r.body.messages ?? [])
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b) => b.type === "tool_result").length;
  const outcome = result.timedOut
    ? requests.length
      ? "timeout-after-model-call"
      : "timeout"
    : result.exit === 0
      ? requests.length
        ? "ran"
        : "exited-no-model-call"
      : "error";
  return {
    ...t,
    outcome,
    patchedPlaceholders: patched,
    exit: result.exit,
    ms: Date.now() - started,
    modelRequests: requests.length,
    toolResults: toolCalls,
    tail: result.out.trim().split("\n").slice(-6).join("\n").slice(-800),
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
      console.log(`${r.outcome.padEnd(26)} ${r.id}${r.reason ? ` (${r.reason})` : ""}`);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
const outFile = dir.endsWith("extracted") ? "results/run-docs.json" : "results/run-examples.json";
// A partial run (--only) must not overwrite the full results file.
if (!only) await writeFile(outFile, JSON.stringify(results, null, 2));
const tally = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
console.log(`\n${results.length} examples:`, tally);
process.exitCode =
  results.some((r) => r.outcome === "error" || r.outcome.startsWith("timeout")) && !dir.endsWith("extracted") ? 1 : 0;
