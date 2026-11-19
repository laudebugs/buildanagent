// Run complete, type-clean ADK doc examples offline with a scripted model.
// Doc sources run unmodified under scripts/scripted-preload.mjs, which resolves every model to a scripted
// BaseLlm and blocks non-local network access. A source that exports `rootAgent` without running it (the
// adk-js samples and most docs snippets, which `npx adk run` would drive) is probed: a generated driver
// imports it and sends one user message through an InMemoryRunner. Each run gets a temp cwd (with
// fixtures/), an allowlisted environment and a timeout.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2]
// For a directory other than extracted/, every *.ts file is run (our own examples, which bring their model).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  [/from ['"]@google\/adk-integrations/, "package outside the pinned set (@google/adk-integrations)"],
  [
    /from ['"](?!@google\/adk['"/]|@google\/genai['"/]|zod['"/]|node:|\.{1,2}\/)[^'"]+['"]/,
    "package outside the pinned set",
  ],
  [
    /MCPToolset|McpToolset|StdioConnectionParams|SseConnectionParams|StreamableHTTPConnectionParams/,
    "external MCP server",
  ],
  [/\.runLive\(|LiveRequestQueue/, "live (bidi streaming) API"],
  [/ComputerUseToolset|BaseComputer/, "drives a computer (host access)"],
  [
    /UnsafeLocalCodeExecutor|ContainerCodeExecutor|LocalEnvironment|AgentEngineSandboxCodeExecutor/,
    "executes code on the host or a sandbox",
  ],
  [
    /DatabaseSessionService|VertexAi\w*Service|VertexAi(Search|Rag)|GcsArtifactService|BigQuery|Spanner|AgentEngine|ApiHub|APIHubToolset|ApplicationIntegrationToolset|GCPSkillRegistry/,
    "Google Cloud service or external database",
  ],
  [/(Calendar|Docs|Gmail|Sheets|Slides|Youtube|BigQuery|Drive)Toolset|GoogleApiToolset/, "Google API with OAuth"],
  [/express\(|\.listen\(|createServer\(/, "server (needs HTTP requests)"],
  [/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET|CLIENT_ID|_URL)\b/, "third-party credential or endpoint"],
];
const needsExternal = (code) => EXTERNAL.find(([re]) => re.test(code))?.[1] ?? null;

// The driver for a source that exports rootAgent: one user turn through an InMemoryRunner.
const driver = (file) => `import { InMemoryRunner } from "@google/adk";
import * as mod from ${JSON.stringify(file)};
const agent = (mod as any).rootAgent;
const runner = new InMemoryRunner({ agent, appName: "probe" });
const session = await runner.sessionService.createSession({ appName: "probe", userId: "probe-user" });
let events = 0;
const errors: string[] = [];
for await (const e of runner.runAsync({
  userId: "probe-user",
  sessionId: session.id,
  newMessage: { role: "user", parts: [{ text: "hello world" }] },
  stateDelta: JSON.parse(process.env.PROBE_STATE ?? "{}"),
})) {
  events++;
  if (e.errorCode) errors.push(\`\${e.errorCode}: \${e.errorMessage}\`);
}
console.log(\`probe: \${events} events\`);
if (errors.length) throw new Error(\`probe: error events: \${errors.join("; ")}\`);
if (events === 0) throw new Error("probe: the run produced no events");
`;

let targets;
if (!ownExamples) {
  const manifest = JSON.parse(await readFile(join(dir, "_manifest.json"), "utf8"));
  const tc = existsSync("results/typecheck-docs.json")
    ? Object.fromEntries(JSON.parse(await readFile("results/typecheck-docs.json", "utf8")).map((r) => [r.id, r.status]))
    : {};
  targets = manifest
    .filter((m) => m.complete && tc[m.id] === "pass")
    .map((m) => ({ id: m.id, file: join(dir, m.file), source: m.source, probe: m.probe }));
} else {
  targets = (await readdir(dir))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ id: f.replace(/\.ts$/, ""), file: join(dir, f) }));
}
if (only) targets = targets.filter((t) => only.has(t.id));
await mkdir("results", { recursive: true });
const drivers = join(root, ".tmp", "drivers");
if (!ownExamples) await mkdir(drivers, { recursive: true });

async function runOne(t, state = {}) {
  const code = await readFile(t.file, "utf8");
  // Our own examples are offline by construction.
  const ext = ownExamples ? null : needsExternal(code);
  if (ext) return { ...t, outcome: "skipped", reason: ext };
  const cwd = await mkdtemp(join(tmpdir(), "adk-ex-"));
  if (existsSync(join(root, "fixtures"))) await cp(join(root, "fixtures"), cwd, { recursive: true });
  const log = join(await mkdtemp(join(tmpdir(), "adk-log-")), "model-calls");
  // Allowlisted environment: no inherited credentials can reach a real provider. GOOGLE_GENAI_USE_VERTEXAI
  // stays unset, so ADK picks the Gemini API backend; the dummy key only satisfies constructors that check
  // for one (the scripted model never sends it anywhere).
  const env = {
    PATH: process.env.PATH,
    HOME: dirname(log),
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
    MOCK_LOG: log,
    PROBE_STATE: JSON.stringify(state),
    ...(ownExamples ? {} : { GOOGLE_GENAI_API_KEY: "offline-dummy", GEMINI_API_KEY: "offline-dummy" }),
  };
  // A probe runs a generated driver inside the package (so "@google/adk" resolves) that imports the source.
  let entry = resolve(t.file);
  if (t.probe) {
    entry = join(drivers, `${t.id}.ts`);
    await writeFile(entry, driver(resolve(t.file)));
  }
  const args = ["--import", TSX];
  if (!ownExamples) args.push("--import", join(root, "scripts/scripted-preload.mjs"));
  // Our own examples also record their model exchange and checks as a transcript (results/transcripts/).
  const transcript = ownExamples ? transcriptRun(args, env) : undefined;
  args.push(entry);
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
  await rm(cwd, { recursive: true, force: true });
  const stats = existsSync(log) ? JSON.parse(await readFile(log, "utf8")) : { calls: 0, toolCalls: [] };
  await rm(dirname(log), { recursive: true, force: true });
  // An instruction template that reads a state key the page expects the app to have set ("{topic}") throws
  // "Context variable not found". That is probe input, not a doc error: rerun with the key set, up to 5 keys.
  const missing = /Context variable not found: `([^`]+)`/.exec(result.out)?.[1];
  if (t.probe && missing && Object.keys(state).length < 5 && !(missing in state)) {
    return runOne(t, { ...state, [missing]: "example" });
  }
  const blocked = /network disabled \(blocked ([^)]+)\)/.exec(result.out)?.[1];
  transcript?.write({ harnessDir: root, exampleFile: resolve(t.file), cwd });
  // Our own examples assert their behaviour, so exit 0 is a pass.
  const outcome = result.timedOut
    ? "timeout"
    : result.exit !== 0
      ? blocked
        ? "needs-network"
        : "error"
      : stats.calls > 0 || ownExamples
        ? "ran"
        : "ran-no-model";
  return {
    ...t,
    outcome,
    exit: result.exit,
    ms: Date.now() - started,
    modelCalls: stats.calls,
    toolCalls: stats.toolCalls?.length ? stats.toolCalls : undefined,
    blockedHost: blocked,
    probeState: Object.keys(state).length ? Object.keys(state) : undefined,
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
