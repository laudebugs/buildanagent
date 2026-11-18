// Run doc examples and our own examples offline in workerd (through Miniflare).
// Each example is bundled with esbuild (scripts/workerd.mjs), then run by scripts/worker-run.mjs
// in a child process with an allowlisted environment and a timeout. Outbound fetches from the
// Worker are refused; model providers are mock language models (shims/).
//   - Doc blocks: complete, type-clean blocks (results/typecheck-docs.json). The runner binds every
//     exported Durable Object class (using the binding names from the page's wrangler config when
//     it has them), instantiates each one, sends chat agents one message, and calls the block's
//     default fetch handler. "ran" means a mock model call happened, "ran-no-model" that every
//     request succeeded without one, "loaded" that the module started but exposes nothing to call,
//     "needs-network" that it failed only because a remote host was refused, "probe-input"
//     that its handler expects a request body the probe does not send, and "needs-binding" that
//     a linked example failed for want of a binding or secret its wrangler config names.
//   - Linked examples (extracted/examples/<name>): the wrangler entry, with its Durable Object
//     bindings and compatibility flags, probed the same way.
//   - Our examples (examples/*.ts): each exports `test(env, h)`, which asserts behavior; pass = ok.
// Usage: node scripts/run-examples.mjs [dir=extracted] [--only id1,id2]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundle, PKG } from "./workerd.mjs";

const dir = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "extracted");
const ownExamples = !dir.endsWith("extracted");
const only = process.argv.includes("--only")
  ? new Set(process.argv[process.argv.indexOf("--only") + 1].split(","))
  : null;
const TIMEOUT_MS = Number(process.env.EXAMPLE_TIMEOUT_MS ?? 60000);
const CONCURRENCY = Number(process.env.EXAMPLE_CONCURRENCY ?? 4);
const MARKER = "[verify-harness] mock model call";
// Bundles must live inside the package: workerd fails to load modules from some outside paths.
const WORK = join(PKG, ".tmp", ownExamples ? "examples" : "docs");

// Sources that need things the offline harness cannot provide. First match wins.
const EXTERNAL = [
  [
    /from ["'](react|react-dom|@ai-sdk\/react|agents\/react|agents\/ai-react|@cloudflare\/(think|ai-chat)\/react)["']/,
    "browser or React code (no Worker to run)",
  ],
  [/from ["']agents\/client["']|new AgentClient\(|agentFetch\(/, "client SDK code (runs in a browser or Node client)"],
  [
    /from ["']@cloudflare\/(sandbox|containers)["']|getSandbox\(|ContainerProxy|harness\/container/,
    "containers (Docker-backed, not offline)",
  ],
  [/env\.(BROWSER|MYBROWSER)\b|from ["']@cloudflare\/puppeteer["']|agents\/browser/, "Browser Rendering binding"],
  [/WorkflowEntrypoint|AgentWorkflow|env\.\w*WORKFLOW\w*\b/, "Workflows binding (not configured by the harness)"],
  [
    /env\.\w*(KV|BUCKET|R2|DB|D1|QUEUE|VECTORIZE|LOADER|EMAIL|SEND_EMAIL|IMAGES|HYPERDRIVE)\w*\b/,
    "binding the harness does not configure",
  ],
  [/OAuthProvider|@cloudflare\/workers-oauth-provider/, "OAuth provider (needs an authorization flow)"],
  [
    /agents\/(voice|x402)|@x402\/|agents\/experimental\/channels|from ["']chat["']|@chat-adapter\//,
    "voice, payments or chat-platform integration",
  ],
  [/^declare\s+(const|let|var|function)\s/m, "uses placeholders declared with `declare` (undefined at run time)"],
  [/process\.env\.[A-Z_]*(KEY|TOKEN|SECRET)|env\.[A-Z_]*(API_KEY|TOKEN|SECRET)\b/, "third-party credential"],
];
const needsExternal = (code) => EXTERNAL.find(([re]) => re.test(code))?.[1] ?? null;

const DO_BASE = /(Agent|Think|DurableObject|Server|McpAgent)$/;
/** Exported classes that are Durable Objects: Agents, Think, AIChatAgent, McpAgent, DurableObject, mixins. */
export function doClasses(code) {
  const classes = [...code.matchAll(/^export\s+class\s+(\w+)(?:<[^>{]*>)?\s+extends\s+([\w.]+)\s*(\(|<|\{|\s)/gm)];
  const local = new Map(classes.map((m) => [m[1], m]));
  const isDo = (name, seen = new Set()) => {
    const m = local.get(name);
    if (!m || seen.has(name)) return false;
    seen.add(name);
    const base = m[2].split(".").pop();
    if (m[3] === "(") return true; // withVoice(Agent) style
    if (DO_BASE.test(base)) return !/Workflow|Entrypoint/.test(base);
    if (new RegExp(`const\\s+${base}\\s*=\\s*\\w+\\(`).test(code)) return true;
    return isDo(base, seen);
  };
  return classes.map((m) => m[1]).filter((n) => isDo(n));
}

let targets;
if (!ownExamples) {
  const manifest = JSON.parse(await readFile(join(dir, "_manifest.json"), "utf8"));
  const tc = existsSync("results/typecheck-docs.json")
    ? Object.fromEntries(JSON.parse(await readFile("results/typecheck-docs.json", "utf8")).map((r) => [r.id, r.status]))
    : {};
  targets = manifest
    .filter((m) => m.complete && (tc[m.id] === "pass" || (m.example && tc[m.id] !== "api-mismatch")))
    .map((m) => ({ ...m, path: join(dir, m.file) }));
} else {
  targets = (await readdir(dir))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => ({ id: f.replace(/\.ts$/, ""), path: join(dir, f), bindings: [] }));
}
if (only) targets = targets.filter((t) => only.has(t.id));
await mkdir("results", { recursive: true });
await rm(WORK, { recursive: true, force: true });

function spawnRun(jobFile) {
  // Allowlisted environment: no inherited credentials reach workerd or the example.
  const env = { PATH: process.env.PATH, HOME: tmpdir(), TMPDIR: tmpdir(), LANG: "C.UTF-8", NODE_NO_WARNINGS: "1" };
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(PKG, "scripts/worker-run.mjs"), jobFile], {
      cwd: PKG,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL"); // the whole group, workerd included
      } catch {}
      done({ timedOut: true, out });
    }, TIMEOUT_MS);
    child.on("close", () => {
      clearTimeout(timer);
      done({ timedOut: false, out });
    });
  });
}

async function runOne(t) {
  const code = await readFile(t.path, "utf8");
  const ext = ownExamples ? null : needsExternal(code);
  if (ext && !t.example) return { id: t.id, page: t.page, line: t.line, outcome: "skipped", reason: ext };
  const exported = doClasses(code);
  const durableObjects = {};
  for (const b of t.bindings ?? [])
    if (exported.includes(b.className) || t.example) durableObjects[b.name] = b.className;
  for (const c of exported) if (!Object.values(durableObjects).includes(c)) durableObjects[c] = c;
  // McpAgent.serve() looks up the MCP_OBJECT binding unless told otherwise (agents' McpAgent docs).
  for (const c of exported)
    if (new RegExp(`class\\s+${c}\\b[^{]*extends\\s+McpAgent`).test(code) && !durableObjects.MCP_OBJECT)
      durableObjects.MCP_OBJECT = c;
  // A linked example's classes live in other files: keep its wrangler bindings as declared.
  const work = join(WORK, t.id);
  await mkdir(work, { recursive: true });
  const started = Date.now();
  const b = await bundle(resolve(t.path), work);
  const base = { id: t.id, page: t.page, line: t.line, durableObjects };
  if (!b.ok) {
    const missing = b.error.match(/Could not resolve "([^"]+)"/)?.[1];
    return missing && !/^\.{1,2}\//.test(missing)
      ? { ...base, outcome: "skipped", reason: `package outside the pinned set (${missing})` }
      : { ...base, outcome: "bundle-error", error: b.error.slice(0, 600) };
  }
  if (t.example && t.configBindings?.length)
    base.note = `wrangler bindings not configured: ${t.configBindings.join(", ")} (AI is mocked)`;
  const jobFile = join(work, "job.json");
  await writeFile(
    jobFile,
    JSON.stringify({
      file: b.file,
      mode: ownExamples ? "test" : "probe",
      durableObjects,
      compatibilityFlags: t.compatibilityFlags ?? [],
      vars: t.vars ?? {},
    }),
  );
  const run = await spawnRun(jobFile);
  const modelCalls = run.out.split(MARKER).length - 1;
  const line = run.out.split("\n").find((l) => l.startsWith("__RESULT__"));
  const r = line ? JSON.parse(line.slice("__RESULT__".length)) : null;
  const tail = run.out
    .split("\n")
    .filter((l) => l && !l.startsWith("__RESULT__") && !l.includes(MARKER))
    .slice(-8)
    .join("\n")
    .slice(-1200);
  const res = { ...base, ms: Date.now() - started, modelCalls, blockedHost: r?.blocked?.[0] };
  if (run.timedOut) return { ...res, outcome: "timeout", tail };
  if (!r) return { ...res, outcome: "error", error: "no result", tail };
  if (r.phase !== "run") return { ...res, outcome: "error", phase: r.phase, error: r.error, tail };
  if (ownExamples) return { ...res, outcome: r.ok ? "ran" : "error", error: r.error, stack: r.stack, tail };
  const failures = [
    ...(r.bindings ?? [])
      .filter((x) => x.error || x.chatStatus === "error")
      .map((x) => `${x.name}: ${x.error ?? x.chatError}`),
    ...(r.default?.error ? [`default fetch: ${r.default.error}`] : []),
  ];
  const exercised = (r.bindings ?? []).length > 0 || r.default;
  // A failure caused by the refused network is a dependency on a remote service, not an SDK result.
  const outcome = failures.length
    ? r.blocked?.length
      ? "needs-network"
      : failures.every((f) => /SyntaxError: Unexpected end of JSON input/.test(f))
        ? "probe-input"
        : t.example && (t.configBindings?.length || failures.some((f) => /must be configured/.test(f)))
          ? "needs-binding"
          : "error"
    : !exercised
      ? "loaded"
      : modelCalls > 0
        ? "ran"
        : "ran-no-model";
  return {
    ...res,
    outcome,
    report: r.bindings,
    defaultFetch: r.default,
    failures: failures.length ? failures : undefined,
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
      console.log(
        `${r.outcome.padEnd(13)} ${r.id}${r.reason ? ` (${r.reason})` : ""}${r.error && ownExamples ? `\n  ${r.error}` : ""}`,
      );
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));
if (!only || process.env.WRITE_PARTIAL) {
  await writeFile(
    ownExamples ? "results/run-examples.json" : "results/run-docs.json",
    JSON.stringify(results, null, 2),
  );
}
const tally = {};
for (const r of results) tally[r.outcome] = (tally[r.outcome] ?? 0) + 1;
console.log(`\n${results.length} examples:`, tally);
process.exitCode = ownExamples && results.some((r) => r.outcome !== "ran") ? 1 : 0;
