// Run complete, type-clean OpenAI Agents SDK sources offline with a scripted model.
// Doc examples run unmodified under scripts/scripted-preload.mjs, which swaps the default model
// provider for a scripted one and blocks non-local network access. Each run gets a temp cwd
// (with fixtures/), an allowlisted environment with tracing disabled, and a timeout.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2] [--live]
// --live, which only scripts/live/run.mjs passes, runs one of our examples against a real provider
// (scripts/live/harness.mjs).
// For a directory other than extracted/, every *.ts file is run (our own examples).
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { liveMode } from "../../../scripts/live/harness.mjs";
import { transcriptRun } from "../../../scripts/transcripts/write.mjs";
import { realtimeNeedsConnection } from "./realtime-classifier.mjs";

const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "extracted");
const ownExamples = !dir.endsWith("extracted");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;
const liveRun = liveMode();
const TIMEOUT_MS = Number(process.env.EXAMPLE_TIMEOUT_MS ?? 60000);
const CONCURRENCY = Number(process.env.EXAMPLE_CONCURRENCY ?? 4);
const root = resolve(".");
// Resolve tsx from the workspace (pnpm keeps shared dev tools at the repo root).
const TSX = import.meta.resolve("tsx");

// Sources that need things the offline harness cannot provide.
const needsExternal = (code) =>
  realtimeNeedsConnection(code)
    ? "realtime session (WebRTC/WebSocket)"
    : /new OpenAI\(|OpenAIProvider\(|OpenAIResponsesModel\(|OpenAIChatCompletionsModel\(/.test(code)
      ? "explicit OpenAI client or model"
      : /OpenAIConversationsSession|OpenAIResponsesCompactionSession/.test(code)
        ? "hosted OpenAI session store (Conversations API)"
        : /DockerSandboxClient|@openai\/agents-extensions\/experimental\/codex|@openai\/codex-sdk/.test(code)
          ? "Docker or Codex runtime"
          : /MCPServer(Stdio|StreamableHttp|SSE)\(/.test(code)
            ? "external MCP server"
            : /@ai-sdk\//.test(code)
              ? "AI SDK provider (real model)"
              : /process\.env\.(?!OPENAI_AGENTS|NODE_ENV)[A-Z_]*(KEY|TOKEN|SECRET)/.test(code)
                ? "third-party credential"
                : null;

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

// A sandbox manifest's gitRepo() entry makes the SDK run `git clone https://github.com/<repo>.git` as a child process,
// which the preloads' socket block does not reach, so a doc example cloned the real repository and timed out when
// GitHub was slow. Git is pointed at local repositories instead: `insteadOf` rewrites every github.com URL to a folder
// that holds a one-commit `openai/openai-agents-js` (the only repository the docs name), and GIT_ALLOW_PROTOCOL
// refuses every other transport, so a clone of any other repository fails at once rather than going online.
const gitHub = await mkdtemp(join(tmpdir(), "oai-github-"));
{
  const repo = join(gitHub, "openai", "openai-agents-js.git");
  const work = await mkdtemp(join(tmpdir(), "oai-repo-"));
  const git = (cwd, ...args) =>
    execFileSync("git", ["-c", "user.name=verify", "-c", "user.email=verify@example.invalid", ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: work, GIT_CONFIG_NOSYSTEM: "1" },
      stdio: "ignore",
    });
  git(work, "init", "-q", "-b", "main");
  await writeFile(join(work, "README.md"), "# openai-agents-js\n\nA local stand-in for the offline doc examples.\n");
  git(work, "add", "README.md");
  git(work, "commit", "-q", "-m", "README");
  await mkdir(dirname(repo), { recursive: true });
  git(gitHub, "clone", "-q", "--bare", work, repo);
}
const OFFLINE_GIT = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: `url.file://${gitHub}/.insteadOf`,
  GIT_CONFIG_VALUE_0: "https://github.com/",
  GIT_ALLOW_PROTOCOL: "file",
};

async function runOne(t) {
  const code = await readFile(t.file, "utf8");
  const ext = needsExternal(code);
  if (ext) return { ...t, outcome: "skipped", reason: ext };
  // Sandbox examples mount sibling folders relative to the working directory, so they run from
  // their own folder (inside gitignored extracted/); everything else runs in a fresh temp dir.
  const cwd = /localDir\(|LocalDir|local_dir/.test(code)
    ? dirname(resolve(t.file))
    : await mkdtemp(join(tmpdir(), "oai-ex-"));
  if (existsSync(join(root, "fixtures"))) await cp(join(root, "fixtures"), cwd, { recursive: true });
  const log = join(await mkdtemp(join(tmpdir(), "oai-log-")), "model-calls");
  // Allowlisted environment: no inherited credentials can reach a real provider.
  const env = {
    PATH: process.env.PATH,
    HOME: dirname(log),
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
    OPENAI_AGENTS_DISABLE_TRACING: "1",
    SCRIPTED_LOG: log,
    ...OFFLINE_GIT,
    ...liveRun?.env,
  };
  const args = ["--import", TSX];
  if (!ownExamples) args.push("--import", join(root, "scripts/scripted-preload.mjs"));
  // Our own examples have no scripted provider preload, so a separate one keeps them off the network (a live run needs it).
  else if (!liveRun) args.push("--import", join(root, "scripts/block-network.mjs"));
  // Our own examples also record their model exchange and checks as a transcript (results/transcripts/).
  const transcript = ownExamples ? transcriptRun(args, env) : undefined;
  // A live run swaps @openai/agents/testing's ScriptedModel for one that calls the live provider (examples/lib/live.ts).
  if (liveRun) args.push("--import", join(root, "examples/lib/live-register.mjs"));
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
  transcript?.write({
    harnessDir: root,
    exampleFile: resolve(t.file),
    cwd,
    exit: result.exit,
    out: result.out,
    ...liveRun?.transcript,
  });
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
    tail: (liveRun?.redact ?? String)(result.out.trim().split("\n").slice(-8).join("\n").slice(-1200)),
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
      // A live run's caller reports the example's last lines, already redacted, when it fails.
      if (liveRun && r.outcome !== "ran") console.log(r.tail);
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
