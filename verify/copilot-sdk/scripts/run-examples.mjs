// Run complete, type-clean docs examples (or our own examples) offline against the mock model.
// Each example runs in its own network namespace (unshare -rn, loopback only) with an allowlisted
// environment, a temp HOME and working directory, and sandbox-preload.mjs, which starts the mock
// model inside the namespace and points every session at it as a BYOK provider.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2] [--live]
// For a directory other than extracted/, every *.ts file is run (our own examples), and each one's model exchange and
// checks are written to results/transcripts/.
// --live, which only scripts/live/run.mjs passes, runs one of our examples against a real provider. The runtime makes
// the model calls from inside the namespace, so they leave through scripts/live/proxy.mjs, in this process, which
// alone holds the key and reaches the network (see the README's live section).
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { liveMode } from "../../../scripts/live/harness.mjs";
import { transcriptRun } from "../../../scripts/transcripts/write.mjs";
import { liveTool } from "./live-tools.mjs";
import { messagesOf } from "./mock-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "extracted");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;
const isDocs = dir.endsWith("extracted");
const VERBOSE = process.argv.includes("--verbose");
const liveRun = liveMode();
// The proxy reads the key when it loads, so it loads only once liveMode() has accepted the run.
const proxy = liveRun ? await import("../../../scripts/live/proxy.mjs") : undefined;

const TIMEOUT_MS = Number(process.env.EXAMPLE_TIMEOUT_MS ?? (isDocs ? 30000 : 90000));
const CONCURRENCY = Number(process.env.EXAMPLE_CONCURRENCY ?? 4);
const root = resolve(".");
const TSX = import.meta.resolve("tsx");
const PRELOAD = join(here, "sandbox-preload.mjs");
const DONE = "__copilot_example_done__";

// The network namespace is the only block that also covers the native runtime, so refuse to run
// without one. "ip" or Python brings the namespace's loopback interface up.
const has = (cmd, args) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const findOnPath = (name) =>
  (process.env.PATH ?? "")
    .split(delimiter)
    .map((d) => join(d, name))
    .find((p) => existsSync(p));
const IP = findOnPath("ip");
const PY = findOnPath("python3");
const LO_UP = IP
  ? `"${IP}" link set lo up`
  : PY
    ? `"${PY}" -I -c 'import socket,fcntl,struct;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);fcntl.ioctl(s,0x8914,struct.pack("16sH14s",b"lo",0x49,bytes(14)))'`
    : null;
if (!LO_UP || !has("unshare", ["-rn", "true"])) {
  console.error(
    "run-examples: needs `unshare -rn` (user and network namespaces) and `ip` or python3; refusing to run.",
  );
  process.exit(2);
}

// Reviewed by hand (see the findings): why a block is skipped, or what its failure means.
const SKIP_IDS = {
  docs__features__mcp__08: "tails MCP diagnostics until aborted, so it never ends by design",
};
const REVIEWED = {
  "docs__features__usage-and-billing__09": "docs error: calls client.rpc before client.start()",
  "docs__features__usage-and-billing__11": "docs error: calls client.rpc before client.start()",
  "docs__features__plugin-directories__10":
    "environment: retryManaged needs enterprise managed settings; the SDK's standalone runtime refuses it",
};

// Blocks that need things the offline harness cannot provide.
const needsExternal = (code) =>
  /command:\s*["'](npx|uvx|python3?|docker|deno|bunx?)["']/.test(code)
    ? "external MCP server process"
    : /url:\s*["']https?:\/\//.test(code)
      ? "remote MCP/HTTP endpoint"
      : /RuntimeConnection\.forUri|forTcp\(\s*\{\s*port:\s*\d|cliUrl/.test(code)
        ? "external runtime server"
        : /cloud:\s*\{|\.startAhpHost\(|joinSession\(/.test(code)
          ? "cloud session, AHP host or extension host"
          : /process\.env\.[A-Z_]*(TOKEN|KEY|SECRET)\b/.test(code)
            ? "third-party credential"
            : /from\s+["'](express|@azure\/identity|@opentelemetry\/[\w-]+)["']/.test(code)
              ? "uninstalled third-party package"
              : /^\s*declare\s+(const|let|function|class)\b/m.test(code)
                ? "declares names the host app must provide"
                : /node:readline|process\.stdin/.test(code)
                  ? "interactive (reads stdin)"
                  : /forStdio\(\s*\{\s*path:|COPILOT_CLI_PATH/.test(code)
                    ? "a locally installed CLI at a fixed path"
                    : null;

let targets;
if (isDocs) {
  const manifest = JSON.parse(await readFile(join(dir, "_manifest.json"), "utf8"));
  const tc = existsSync("results/typecheck-docs.json")
    ? Object.fromEntries(JSON.parse(await readFile("results/typecheck-docs.json", "utf8")).map((r) => [r.id, r.status]))
    : {};
  targets = manifest
    .filter((m) => m.complete && tc[m.id] === "pass")
    .map((m) => ({ id: m.id, file: join(dir, m.file), page: m.page, line: m.line, validate: m.validate }));
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
  const ext = isDocs ? (SKIP_IDS[t.id] ?? needsExternal(code)) : null;
  if (ext) return { ...t, outcome: "skipped", reason: ext };
  const home = await mkdtemp(join(tmpdir(), `cp-${t.id.slice(0, 40)}-`));
  const cwd = join(home, "work");
  await mkdir(cwd);
  await cp(join(root, "fixtures"), cwd, { recursive: true });
  const log = resolve(`.tmp/logs/${t.id}.jsonl`);
  await writeFile(log, "");
  // A live run's calls go to the proxy, which records them as the mock would and logs them where the mock logs.
  const live = liveRun
    ? await proxy.startLiveProxy({ allowTool: liveTool, messagesOf, secrets: liveRun.transcript.live.secrets, log })
    : undefined;
  // Allowlisted environment: no inherited tokens, proxies or host config reach the example or runtime. A live run adds
  // only the proxy's socket and the run's provider and model, never LIVE_API_KEY_FILE.
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: home,
    LANG: "C.UTF-8",
    MOCK_LOG: log,
    COPILOT_TELEMETRY_DISABLED: "true",
    COPILOT_AUTO_UPDATE: "false",
    COPILOT_DISABLE_LOGIN_SHELL_ENV: "1",
    FIXTURES: join(root, "fixtures"),
    ...live?.env,
  };
  // Docs blocks print a marker when their last statement has run, so a block that finishes but leaves
  // its client (and the runtime process) open counts as having run rather than timing out.
  let runFile = resolve(t.file);
  if (isDocs) {
    await mkdir(".tmp/patched", { recursive: true });
    runFile = resolve(`.tmp/patched/${t.id}.ts`);
    await writeFile(runFile, `${code}\nconsole.log(${JSON.stringify(DONE)});\n`);
  }
  // Our own examples also record their model exchange and checks as a transcript (results/transcripts/). The recorder
  // loads before the preload, which finds it when it starts the mock; the mock and the example share one process.
  const argv = ["--import", TSX];
  const transcript = isDocs ? undefined : transcriptRun(argv, env);
  argv.push("--import", PRELOAD, runFile);
  const started = Date.now();
  const result = await new Promise((done) => {
    const child = spawn("unshare", ["-rn", "sh", "-c", `${LO_UP} && exec "$0" "$@"`, process.execPath, ...argv], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    groups.add(child.pid);
    let out = "";
    let finished = false;
    const kill = () => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    child.stdout.on("data", (d) => {
      out += d;
      if (!finished && out.includes(DONE)) {
        finished = true;
        // Give a well-behaved block a moment to stop its client and exit by itself.
        setTimeout(() => {
          kill();
          done({ exit: null, timedOut: false, leftOpen: true, out });
        }, 3000);
      }
    });
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      kill();
      done({ exit: null, timedOut: true, out });
    }, TIMEOUT_MS);
    child.on("close", (exit) => {
      clearTimeout(timer);
      // Reap anything the example left behind in its process group (the runtime, MCP servers).
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      done({ exit, timedOut: false, out });
    });
  });
  await live?.close();
  // A killed example never wrote its checks, so a transcript of only its requests and answers would replace a complete
  // one; the timeout is the finding, and the file stays as it was.
  if (!result.timedOut) {
    transcript?.write({
      harnessDir: root,
      exampleFile: resolve(t.file),
      cwd,
      ...(live ? { mockEvents: live.events } : {}),
      ...liveRun?.transcript,
    });
  }
  await rm(home, { recursive: true, force: true }).catch(() => {});
  const entries = (await readFile(log, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  // The proxy logs a live run's calls at the path the runtime asked for, which on OpenAI ends in /responses.
  const requests = entries.filter((r) => /\/v1\/messages$|\/responses$/.test(r.path ?? ""));
  const toolCalls = requests.filter((r) => r.plan?.tool).map((r) => r.plan.tool);
  const refused = live?.refused ?? [];
  const outcome =
    refused.length > 0
      ? "error"
      : result.timedOut
        ? requests.length
          ? "timeout-after-model-call"
          : "timeout"
        : result.exit === 0 || result.leftOpen
          ? requests.length
            ? "ran"
            : "ran-no-model-call"
          : "error";
  const out = result.out.replace(`${DONE}\n`, "");
  // A first guess at why a block failed, for the reviewer; the fact-check decides.
  const cause =
    outcome !== "error"
      ? undefined
      : (/ReferenceError: (\w+) is not defined/.exec(out)?.[0] ??
        /Client is not connected\. Call start\(\) first\.|Client not connected/.exec(out)?.[0] ??
        /Error: [^\n]{0,160}/.exec(out)?.[0] ??
        "unknown");
  return {
    ...t,
    outcome,
    exit: result.exit,
    leftOpen: result.leftOpen ?? false,
    cause,
    review: REVIEWED[t.id],
    ms: Date.now() - started,
    modelRequests: requests.length,
    toolCalls,
    harness: entries.filter((e) => e.harness).map((e) => e.harness),
    // A live run's caller prints the tail when the example fails, so it loses the key and any account or request id.
    tail: (liveRun?.redact ?? String)(
      [
        ...refused.map((reason) => `live proxy refused a request: ${reason}`),
        ...out
          .trim()
          .split("\n")
          .slice(-(VERBOSE ? 40 : 8)),
      ]
        .join("\n")
        .slice(-(VERBOSE ? 4000 : 1000)),
    ),
  };
}

// Each example runs in its own process group, which a signal to this runner does not reach, so the runner stops every
// group itself when it is told to stop or exits.
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
      if (VERBOSE || (!isDocs && r.outcome !== "ran" && r.outcome !== "ran-no-model-call")) console.log(r.tail);
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
const outFile = isDocs ? "results/run-docs.json" : "results/run-examples.json";
// A partial run (--only) must not overwrite the full results file.
if (!only) await writeFile(outFile, JSON.stringify(results, null, 2));
const tally = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
console.log(`\n${results.length} examples:`, tally);
process.exitCode = !isDocs && results.some((r) => r.outcome === "error" || r.outcome.startsWith("timeout")) ? 1 : 0;
