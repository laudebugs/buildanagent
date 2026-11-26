// The Cloudflare adapters in workerd, through Miniflare, with every outbound request refused and recorded. Each case of
// the portability suite runs in a Durable Object of its own, on its real SQLite storage and alarm. The scenarios after
// it test across requests what the suite tests within one: concurrent writers, the real alarm, hibernatable sockets
// after the object's memory is lost, and the smoke test of the libraries the harness loads in workerd.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { workerKeyStore } from "@buildanagent/harness/cloudflare";
import { type PortabilityTarget, portabilityConformanceCases } from "@buildanagent/harness/testing";
import { type ClientMessage, decode, encode, type ServerMessage } from "@buildanagent/protocol";
import { afterAll, beforeAll, describe, test } from "vitest";
import { startWorker, type TestWorker } from "./miniflare.js";
import type { CaseOutcome } from "./worker.js";

const ENTRY = fileURLToPath(new URL("./worker.ts", import.meta.url));

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const RING = JSON.stringify({ current: "2026-11", keys: { "2026-11": base64url(randomBytes(32)) } });
const STORE_RING = JSON.stringify({ current: "store-1", keys: { "store-1": base64url(randomBytes(32)) } });

let worker: TestWorker | undefined;

beforeAll(async () => {
  worker = await startWorker(ENTRY, ["HarnessDO"], {
    vars: { APPROVAL_KEYS: RING },
    secretsStoreSecrets: { APPROVAL_KEYS_STORE: { storeId: "test-store", secretName: "approval-keys" } },
  });
  const admin = (await worker.mf.getSecretsStoreSecretAPI("APPROVAL_KEYS_STORE"))();
  await admin.create(STORE_RING);
}, 120_000);

afterAll(async () => {
  const blocked = worker?.blocked ?? [];
  await worker?.dispose();
  assert.deepEqual(blocked, [], "the Worker tried to reach the network");
});

async function get<T>(path: string): Promise<T> {
  assert.ok(worker, "Miniflare started");
  const response = await worker.mf.dispatchFetch(`http://localhost${path}`);
  const body = await response.text();
  assert.equal(response.status, 200, body);
  return JSON.parse(body) as T;
}

// The suite's case names need no factory, so the Node side lists them with stand-ins and the Worker runs each one.
const unused = () => {
  throw new Error("the Node side only lists the cases");
};
const SEAMS: PortabilityTarget = {
  store: unused,
  lock: unused,
  scheduler: unused,
  keyStore: unused,
  transport: unused,
  effectStore: unused,
};
const CASES = portabilityConformanceCases(SEAMS).map((item) => item.name);

// The cases that need what a Durable Object doesn't have: a log file to tear, and a key store the harness can write.
const EXPECTED_SKIPS = new Set([
  "store: a torn last line is skipped by load and reported once, with every complete entry kept",
  "store: an append after a torn line cuts it off, so the next entry is not glued to it",
  "keyStore: rotate adds a new current key and keeps the old one",
  "keyStore: prune keeps the current key and every key in use, and returns the ids it removed",
]);

describe("the Cloudflare target passes the portability suite in workerd", () => {
  test("the Worker lists the same cases, as the live run reads them", async () => {
    assert.deepEqual(await get<string[]>("/cases"), CASES);
  });

  test("it covers six of the eight seams; the sandbox and its egress are the Cloudflare sandbox backend's", () => {
    const seams = new Set(CASES.map((name) => name.split(": ")[0]));
    assert.deepEqual([...seams], ["store", "lock", "scheduler", "keyStore", "transport", "effectStore"]);
    assert.ok(CASES.length >= 35, `expected at least 35 cases, got ${CASES.length}`);
  });

  for (const [index, name] of CASES.entries()) {
    test(name, async () => {
      const outcome = await get<CaseOutcome>(`/case?index=${index}`);
      assert.equal(outcome.name, name, "the Worker ran another case than the test asked for");
      assert.equal(outcome.error, undefined, `${name}: ${outcome.error}`);
      if (EXPECTED_SKIPS.has(name)) assert.ok(outcome.skipped, `${name} was expected to skip`);
      else assert.equal(outcome.skipped, undefined, `${name} skipped: ${outcome.skipped}`);
    }, 30_000);
  }
});

describe("concurrent requests to one Durable Object", () => {
  test("of 16 concurrent requests that each try the session lock, exactly one wins", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => get<string>("/race/lock")));
    assert.equal(results.filter((result) => result === "won").length, 1, results.join());
    assert.equal(results.filter((result) => result === "would_block").length, 15);
  }, 30_000);

  test("of 16 concurrent appends that expect the same tail, exactly one is written and the rest conflict", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => get<string>(`/race/append?id=r${i}`)));
    assert.equal(results.filter((result) => result === "won").length, 1, results.join());
    assert.equal(results.filter((result) => result === "ConflictError").length, 15, results.join());
  }, 30_000);
});

interface Delivery {
  readonly wake_id: string;
  readonly at: number;
  readonly outcome: string;
}

async function deliveriesOf(id: string, count: number): Promise<Delivery[]> {
  const ends = Date.now() + 20_000;
  for (;;) {
    const found = (await get<Delivery[]>("/alarm/deliveries")).filter((row) => row.wake_id === id);
    if (found.length >= count || Date.now() > ends) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("the alarm scheduler on workerd's real alarm", () => {
  test("a wake arrives through the object's alarm() at or after its time, with the time it asked for", async () => {
    const asked = Date.now();
    const at = await get<number>("/alarm/arm?id=live&ms=300");
    const [delivery] = await deliveriesOf("live", 1);
    assert.ok(delivery, "the alarm never delivered the wake");
    assert.equal(delivery.at, at);
    assert.equal(delivery.outcome, "ok");
    assert.ok(Date.now() >= asked + 300, "the wake arrived before its time");
  }, 30_000);

  test("a wake whose handler throws stays stored and is delivered again after retryMs", async () => {
    const at = await get<number>("/alarm/arm?id=flaky&ms=50");
    const deliveries = await deliveriesOf("flaky", 2);
    assert.deepEqual(
      deliveries.map((row) => row.outcome),
      ["threw", "ok"],
    );
    assert.ok(deliveries.every((row) => row.at === at));
  }, 30_000);
});

describe("a wake cancelled during an alarm run", () => {
  test("is not delivered, though it was already due when the run began", async () => {
    await get<number>("/alarm/pair?first=cancel-a&second=cancel-b&ms=100");
    const [first] = await deliveriesOf("cancel-a", 1);
    assert.ok(first, "the first wake never arrived");
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.deepEqual(await deliveriesOf("cancel-b", 0), []);
  }, 30_000);
});

/** A client on a real WebSocket to the object, which collects every message the server sends. */
async function connect() {
  assert.ok(worker, "Miniflare started");
  const response = await worker.mf.dispatchFetch("http://localhost/ws", { headers: { Upgrade: "websocket" } });
  const socket = response.webSocket;
  assert.ok(socket, `no WebSocket: ${response.status}`);
  socket.accept();
  const seen: ServerMessage[] = [];
  socket.addEventListener("message", (event) => {
    seen.push(decode(String(event.data)) as ServerMessage);
  });
  const waitFor = async (match: (message: ServerMessage) => boolean, what: string) => {
    const ends = Date.now() + 10_000;
    for (;;) {
      const found = seen.find(match);
      if (found !== undefined) return found;
      assert.ok(Date.now() < ends, `timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const send = (message: ClientMessage) => socket.send(encode(message).slice(0, -1));
  return { socket, seen, send, waitFor };
}

const answer = (id: number) => (message: ServerMessage) =>
  "id" in message && message.id === id && !("method" in message);
const settled = (count: number, seen: readonly ServerMessage[]) => () =>
  seen.filter((message) => "method" in message && message.method === "turn/settled").length >= count;

describe("the protocol over hibernatable WebSockets", () => {
  test("a client keeps its socket, its initialize and its session after the object's memory is lost", async () => {
    const { socket, seen, send, waitFor } = await connect();
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "t", version: "1" }, capabilities: [] },
    });
    await waitFor(answer(1), "initialize");
    send({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/workspace" } });
    await waitFor(answer(2), "session/create");
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "turn/start",
      params: { session: "s1", input: [{ type: "text", text: "hi" }] },
    });
    await waitFor(settled(1, seen), "the first turn to settle");

    // What eviction does: the bridge and the dispatcher are gone from memory, and the socket stays connected.
    assert.deepEqual(await get("/ws/forget"), { sockets: 1 });
    assert.equal((await get<{ served: number }>("/ws/served")).served, 0);

    send({
      jsonrpc: "2.0",
      id: 4,
      method: "turn/start",
      params: { session: "s1", input: [{ type: "text", text: "again" }] },
    });
    const started = await waitFor(answer(4), "the second turn/start");
    assert.equal((started as { result?: { accepted?: unknown } }).result?.accepted, true);
    await waitFor(settled(2, seen), "the second turn to settle");
    assert.equal((await get<{ served: number }>("/ws/served")).served, 1);
    // The bridge's own replay is answered to the bridge alone.
    assert.ok(
      seen.every((message) => !("id" in message) || !String(message.id).startsWith("$/hibernation/")),
      "the client saw an answer to the bridge's replay",
    );
    socket.close(1000);
  }, 60_000);
});

describe("the workerd smoke test", () => {
  test("pi-schema, @cfworker/json-schema, the MCP client and a Secrets Store key ring all work in workerd", async () => {
    const result = await get<Record<string, unknown>>("/smoke");
    assert.equal(result.evalBlocked, true, "workerd refuses new Function, which a code-generating validator needs");
    assert.deepEqual(result.pi, { valid: true, invalid: false });
    assert.deepEqual(result.fallback, { valid: true, invalid: false });
    assert.deepEqual(result.tools, ["echo"]);
    assert.match(JSON.stringify(result.called), /from workerd/);
    assert.equal(result.secretsStoreCurrent, "store-1");
  }, 60_000);
});

describe("workerKeyStore keeps the ring's text out of what it shows", () => {
  test("the store object, its errors and a failed load hold no key text", async () => {
    const store = workerKeyStore(RING);
    assert.equal(JSON.stringify(store), "{}");
    const key = JSON.parse(RING).keys["2026-11"] as string;
    assert.ok(!String(Object.values(store)).includes(key));
    const broken = workerKeyStore(`{"current":"x","keys":{"x":"${key.slice(0, 10)}"}}`);
    const error = await broken.load().then(
      () => undefined,
      (failure: unknown) => failure as Error,
    );
    assert.ok(error, "a ring with a short key must not load");
    assert.ok(!`${error.message} ${String(error.cause)} ${error.stack}`.includes(key.slice(0, 10)));
    assert.throws(() => workerKeyStore(undefined), /invalid|needs/);
    assert.throws(() => workerKeyStore(""), /empty/);
  });
});
