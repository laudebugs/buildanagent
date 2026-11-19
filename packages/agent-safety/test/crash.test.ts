import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type EffectRecord, type EffectStore, effectKey, memoryEffectStore } from "@buildanagent/agent-safety";
import { afterAll, beforeAll, beforeEach, test } from "vitest";

// The crash test: a child process stores its effect record, and the test kills it with SIGKILL at a chosen point,
// before the record settles. A second process then runs the same call. The store and the fake payment API live here,
// behind loopback HTTP, so they outlive the child, as a durable store and a real API would.
const SCRIPT = fileURLToPath(new URL("./fixtures/effect-process.ts", import.meta.url));
const TSX = import.meta.resolve("tsx");
const HOME = mkdtempSync(join(tmpdir(), "agent-safety-crash-"));
const START = Date.parse("2026-11-19T10:00:00.000Z");
const LEASE_MS = 60_000;
const KEY = await effectKey(
  { tenant: "user-1", session: "session-1", branch: "main", toolCallId: "call_1" },
  "refund:4417",
);

/** Where the test kills the running child: once its record is stored, or once the payment API holds its request. */
type KillPoint = "after-begin" | "after-request" | "hold-request";

let store: EffectStore = memoryEffectStore();
let requests: { key: string; orderId: number }[] = [];
let killAt: KillPoint | undefined;
let running: ChildProcess | undefined;
let reached: () => void = () => {};
let server: Server;
let base: string;

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(value));
}

/** Kills the running child at once, so it can do nothing after this point, and leaves its request unanswered. */
function kill(): void {
  running?.kill("SIGKILL");
  reached();
}

async function handleStore(path: string, request: IncomingMessage, response: ServerResponse, url: URL) {
  if (path === "/store/get") {
    const record = await store.get(url.searchParams.get("key") ?? "");
    return send(response, record === undefined ? {} : { record });
  }
  const record = (await body(request)) as EffectRecord;
  if (path === "/store/begin") {
    const claim = await store.begin(record);
    if (killAt === "after-begin" && claim === "started") return kill();
    return send(response, claim);
  }
  if (path === "/store/take-over") return send(response, await store.takeOver(record));
  return send(response, await store.settle(record));
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method === "GET") {
    const found = requests.find((r) => r.key === url.searchParams.get("key"));
    return send(response, found === undefined ? {} : { found: { id: `re_${found.orderId}` } });
  }
  const { key, orderId } = (await body(request)) as { key: string; orderId: number };
  requests.push({ key, orderId });
  // The API has accepted the request; the child dies before it reads the answer, so it can never settle.
  if (killAt === "after-request") return kill();
  if (killAt === "hold-request") return reached();
  return send(response, { id: `re_${orderId}` });
}

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const handled = url.pathname.startsWith("/store/")
      ? handleStore(url.pathname, request, response, url)
      : handleApi(request, response, url);
    handled.catch((error: unknown) => response.writeHead(500).end(String(error)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  running?.kill("SIGKILL");
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  rmSync(HOME, { recursive: true, force: true });
});

beforeEach(() => {
  store = memoryEffectStore();
  requests = [];
  killAt = undefined;
});

interface Attempt {
  readonly outcome: { kind: string; retry: string; reason?: string; effectKey?: string };
  readonly counts: { run: number; reconcile: number };
}

/** Forks one attempt with an environment that holds only what it needs: no credentials and no inherited state. */
function attempt(toolCallId: string, now: number, reconcile: boolean) {
  const child = fork(SCRIPT, [base, toolCallId, String(now), reconcile ? "yes" : "no"], {
    env: { PATH: process.env.PATH ?? "", HOME, TMPDIR: HOME, LANG: "C.UTF-8" },
    execArgv: ["--import", TSX],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    timeout: 30_000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => (stdout += chunk));
  child.stderr?.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on("exit", (code, signal) => resolve({ code, signal })),
  );
  return { child, exited, output: () => ({ stdout, stderr }) };
}

/** Runs an attempt to the end and returns what it printed. */
async function complete(toolCallId: string, now: number, reconcile: boolean): Promise<Attempt> {
  const run = attempt(toolCallId, now, reconcile);
  const { code } = await run.exited;
  assert.equal(code, 0, `the attempt failed: ${run.output().stderr}`);
  return JSON.parse(run.output().stdout) as Attempt;
}

/** Runs an attempt and kills it at `point`; resolves once it is dead, or, for `hold-request`, once it waits there. */
async function crash(point: KillPoint) {
  killAt = point;
  const run = attempt("call_1", START, false);
  running = run.child;
  await new Promise<void>((resolve) => {
    reached = resolve;
  });
  killAt = undefined;
  if (point !== "hold-request") {
    const { signal } = await run.exited;
    assert.equal(signal, "SIGKILL", "the first attempt was killed");
  }
  return run;
}

test("a child killed after the API accepted its request resumes as unknown, reconcile_first, with one request", async () => {
  await crash("after-request");
  assert.equal((await store.get(KEY))?.state, "started", "the record never settled");
  const resumed = await complete("call_1", START + LEASE_MS, false);
  assert.equal(resumed.outcome.kind, "unknown");
  assert.equal(resumed.outcome.retry, "reconcile_first");
  assert.equal(resumed.counts.run, 0);
  assert.equal(requests.length, 1);
}, 60_000);

test("a second process that calls while the first one's lease is live gets IN_PROGRESS and runs nothing", async () => {
  const first = await crash("hold-request");
  const second = await complete("call_2", START + LEASE_MS - 1, true);
  assert.equal(second.outcome.kind, "unknown");
  assert.equal(second.outcome.reason, "IN_PROGRESS");
  assert.deepEqual(second.counts, { run: 0, reconcile: 0 });
  first.child.kill("SIGKILL");
  await first.exited;
  assert.equal(requests.length, 1);
}, 60_000);

test("a child killed after the API accepted its request resumes as applied when reconcile finds it", async () => {
  await crash("after-request");
  const resumed = await complete("call_1", START + LEASE_MS, true);
  assert.equal(resumed.outcome.kind, "applied");
  assert.deepEqual(resumed.counts, { run: 0, reconcile: 1 });
  assert.equal(requests.length, 1);
  assert.equal((await store.get(KEY))?.state, "settled");
}, 60_000);

test("a child killed before its request left resumes, finds nothing, and sends once under the same key", async () => {
  await crash("after-begin");
  assert.equal(requests.length, 0);
  const resumed = await complete("call_1", START + LEASE_MS, true);
  assert.equal(resumed.outcome.kind, "applied");
  assert.deepEqual(resumed.counts, { run: 1, reconcile: 1 });
  assert.deepEqual(requests, [{ key: KEY, orderId: 4417 }]);
}, 60_000);

test("a regenerated turn in a new process, with a fresh call id and the same business key, sends nothing more", async () => {
  const first = await complete("call_1", START, false);
  assert.equal(first.outcome.kind, "applied");
  const regenerated = await complete("call_7", START + 1, false);
  assert.deepEqual(regenerated.outcome, first.outcome);
  assert.equal(regenerated.counts.run, 0);
  assert.equal(requests.length, 1);
}, 60_000);
