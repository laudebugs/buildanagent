// Run complete, type-clean examples against the mock Anthropic API.
// Each example gets its own mock server (so its request log is isolated), a temp cwd and a timeout.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2] [--live]
// For a directory other than extracted/, every *.ts file is run (our own examples), and each one's model exchange and
// checks are written to results/transcripts/.
// --live, which only scripts/live/run.mjs passes, runs one of our examples against a real provider. The CLI makes the
// model calls, so the example and its CLI run in a network namespace with only a loopback interface, and the calls
// leave through scripts/live/proxy.mjs, in this process, which alone holds the key (see the README's live section).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { liveMode } from "../../../scripts/live/harness.mjs";
import { eventTime, transcriptRun } from "../../../scripts/transcripts/write.mjs";
import { liveTool } from "./live-tools.mjs";
import { messagesOf, startMock } from "./mock-anthropic.mjs";

const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "extracted");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;
// The CLI refuses bypassPermissions as root, so 03-permission-order's query c) never reaches the model there, and a
// transcript recorded as root would differ from one recorded anywhere else. A root run writes none, except a live run's.
const asRoot = process.getuid?.() === 0;
if (asRoot)
  console.log("running as root: no transcripts are written, because the CLI refuses bypassPermissions as root");
const liveRun = liveMode();
// The proxy reads the key when it loads, so it loads only once liveMode() has accepted the run.
const proxy = liveRun ? await import("../../../scripts/live/proxy.mjs") : undefined;
const inNamespace = proxy?.loopbackNamespace();
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
  // A live run's calls go to the proxy, which records them as the mock would; otherwise the mock answers them.
  const live = liveRun
    ? await proxy.startLiveProxy({ allowTool: liveTool, messagesOf, secrets: liveRun.transcript.live.secrets, log })
    : undefined;
  const server = live
    ? undefined
    : await startMock(0, log, ownExamples ? (event) => mockEvents.push({ ...event, at: eventTime() }) : undefined);
  // Allowlisted environment: no inherited credentials or host config reach the spawned CLI. In a live run the preload
  // sets the base URL and a placeholder key, and the example gets only the proxy's socket, never LIVE_API_KEY_FILE.
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    ...(live
      ? live.env
      : {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
          ANTHROPIC_API_KEY: "sk-ant-mock-not-a-real-key",
        }),
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CONFIG_DIR: join(cwd, ".claude-config"),
    TASK_PROMPT: "Summarize the files in this directory",
    MOCK_LOG: log,
  };
  const args = ["--import", TSX];
  const transcript = ownExamples ? transcriptRun(args, env) : undefined;
  if (live) args.push("--import", join(root, "scripts/live-preload.mjs"));
  args.push(runFile);
  const [command, argv] = live ? inNamespace(process.execPath, args) : [process.execPath, args];
  const started = Date.now();
  const result = await new Promise((done) => {
    // A live run's example gets its own process group, so a timeout also stops the CLI it spawned.
    const child = spawn(command, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: Boolean(live) });
    if (live) groups.add(child.pid);
    const kill = () => {
      try {
        if (live) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    };
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      kill();
      done({ exit: null, timedOut: true, out });
    }, TIMEOUT_MS);
    child.on("close", (exit) => {
      clearTimeout(timer);
      if (live) kill();
      done({ exit, timedOut: false, out });
    });
  });
  server?.close();
  await live?.close();
  // A killed example never wrote its checks, so a transcript of only its requests and answers would replace a complete
  // one; the timeout is the finding, and the file stays as it was.
  if (!result.timedOut && (liveRun || !asRoot)) {
    transcript?.write({
      harnessDir: root,
      exampleFile: resolve(t.file),
      cwd,
      exit: result.exit,
      out: result.out,
      mockEvents: live ? live.events : mockEvents,
      ...liveRun?.transcript,
    });
  }
  // The CLI keeps its session files under the temporary home; a live run's hold a real model's answers, so they go.
  if (live) await rm(cwd, { recursive: true, force: true });
  const requests = (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.path.endsWith("/v1/messages"));
  const toolCalls = requests
    .flatMap((r) => r.body.messages ?? [])
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b) => b.type === "tool_result").length;
  const refused = live?.refused ?? [];
  const outcome =
    refused.length > 0
      ? "error"
      : result.timedOut
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
    // A live run's caller prints the tail when the example fails, so it loses the key and any account or request id.
    tail: (liveRun?.redact ?? String)(
      [
        ...refused.map((reason) => `live proxy refused a request: ${reason}`),
        ...result.out.trim().split("\n").slice(-6),
      ]
        .join("\n")
        .slice(-800),
    ),
  };
}

// A live example runs in its own process group, which a signal to this runner does not reach, so the runner stops every
// live group itself when it is told to stop or exits.
const groups = new Set();
const stopGroups = () => {
  for (const pid of groups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
};
process.on("exit", stopGroups);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stopGroups();
    process.exit(1);
  });
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
      if (liveRun && r.outcome !== "ran") console.log(r.tail);
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
