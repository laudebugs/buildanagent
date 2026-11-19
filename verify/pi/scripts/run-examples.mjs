// Run complete, type-clean Pi examples offline with the faux model.
// Doc blocks and upstream SDK programs run unmodified under scripts/faux-preload.mjs, which injects the
// faux provider into every ModelRuntime. Each run gets a temp cwd (with fixtures/), a temp
// PI_CODING_AGENT_DIR whose settings select the faux model, and a timeout.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2]
// For a directory other than extracted/, every *.ts file is run (our own examples, which wire faux themselves).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { recorderArgs, writeTranscript } from "../../../scripts/transcripts/write.mjs";

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

// Blocks that need things the offline harness cannot provide.
const needsExternal = (code) =>
  /createModels\(\)[\s\S]*setProvider\((anthropic|openai|google)\w*Provider\(\)\)/.test(code) &&
  !/fauxProvider/.test(code)
    ? "real provider via createModels()"
    : /process\.env\.MY_\w*KEY/.test(code) && /getModel\(\s*["']anthropic/.test(code)
      ? "real Anthropic credential (static catalog model)"
      : /login\(|oauth/i.test(code) && /interaction|onAuth|authorize/i.test(code)
        ? "interactive OAuth login"
        : /url:\s*["']https?:\/\/(?!localhost|127)/.test(code)
          ? "remote endpoint"
          : /command:\s*["'](npx|uvx|docker)/.test(code)
            ? "external MCP server process"
            : null;

let targets;
if (!ownExamples) {
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
await mkdir("results", { recursive: true });

async function runOne(t) {
  const code = await readFile(t.file, "utf8");
  const ext = needsExternal(code);
  if (ext) return { ...t, outcome: "skipped", reason: ext };
  const cwd = await mkdtemp(join(tmpdir(), `pi-ex-${t.id}-`));
  await cp(join(root, "fixtures"), cwd, { recursive: true });
  const agentDir = join(cwd, ".pi-agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "faux", defaultModel: "faux-1" }));
  // Allowlisted environment: no inherited cloud or API credentials can reach a real provider.
  const env = {
    PATH: process.env.PATH,
    HOME: cwd,
    TMPDIR: tmpdir(),
    LANG: "C.UTF-8",
    NODE_NO_WARNINGS: "1",
    PI_CODING_AGENT_DIR: agentDir,
    FAUX_READ_FILE: "notes.txt",
  };
  const args = ["--import", TSX];
  if (!ownExamples) args.push("--import", join(root, "scripts/faux-preload.mjs"));
  // Our own examples also record their model exchange and checks as a transcript (results/transcripts/).
  const raw = ownExamples ? join(await mkdtemp(join(tmpdir(), "transcript-")), "events.json") : undefined;
  if (raw) {
    args.push(...recorderArgs());
    env.TRANSCRIPT_FILE = raw;
  }
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
  const fauxCalls = (result.out.match(/Faux model:/g) ?? []).length;
  const blocked = /network disabled \(blocked ([^)]+)\)/.exec(result.out)?.[1];
  if (raw) writeTranscript({ harnessDir: root, exampleFile: resolve(t.file), rawFile: raw, cwd, home: env.HOME });
  // "ran" = exit 0 and the faux model answered; "ran-no-model" = exit 0 without a model reply.
  // Our own examples assert their behaviour, so exit 0 is a pass.
  const outcome = result.timedOut
    ? "timeout"
    : result.exit !== 0
      ? "error"
      : fauxCalls > 0 || ownExamples
        ? "ran"
        : "ran-no-model";
  return {
    ...t,
    outcome,
    blockedHost: blocked,
    exit: result.exit,
    ms: Date.now() - started,
    fauxReplies: fauxCalls,
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
      console.log(`${r.outcome.padEnd(10)} ${r.id}${r.reason ? ` (${r.reason})` : ""}`);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
// A partial run (--only) must not overwrite the full results file.
if (!only)
  await writeFile(
    ownExamples ? "results/run-examples.json" : "results/run-docs.json",
    JSON.stringify(results, null, 2),
  );
const tally = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
console.log(`\n${results.length} examples:`, tally);
process.exitCode = ownExamples && results.some((r) => r.outcome !== "ran") ? 1 : 0;
