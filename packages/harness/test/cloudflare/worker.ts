// The Worker for test/cloudflare/cloudflare.test.ts, bundled with esbuild and run in workerd through Miniflare. Its
// Durable Object runs one case of the portability suite against the Cloudflare adapters on its own SQLite storage and
// alarm, and serves the race, alarm and WebSocket scenarios the Node side drives. Each suite case gets an object of
// its own, so each starts from empty tables. The fetch handler also runs the workerd smoke test: pi-schema, the
// fallback validator and the MCP client, loaded and used inside workerd.
import { createCloudflareTables, durableObjectEffectStore } from "@buildanagent/agent-safety/stores/cloudflare";
import { createModel, type Model } from "@buildanagent/gateway";
import { connectMcpServer } from "@buildanagent/harness/mcp";
import { createDispatcher, createHarness, type Dispatcher } from "@buildanagent/harness/server";
import type { EntryInput } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { type ClientMessage, decode, encode, type ServerMessage } from "@buildanagent/protocol";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { Validator } from "@cfworker/json-schema";
import { compile } from "@earendil-works/pi-schema";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { sessionObject } from "../../examples/cloudflare-session-object.js";
import {
  type AlarmScheduler,
  type DurableStorageLike,
  doAlarmScheduler,
  doLock,
  doSqliteIndex,
  doSqliteStore,
  type HibernatableWebSocketLike,
  type SecretsStoreSecretLike,
  type WebSocketHibernation,
  webSocketHibernation,
  workerKeyStore,
} from "../../src/cloudflare/index.js";
import { processScheduler } from "../../src/session/scheduler.js";
import { type PortabilityTarget, portabilityConformanceCases } from "../../src/testing/portability-conformance.js";
import type { DeliveredWake } from "../../src/testing/scheduler-conformance.js";

// The Workers runtime's types, by the shape this Worker uses, so the file type-checks with the package's Node types.
// The class below is a plain Durable Object class, reached through its `fetch()`, which needs no `cloudflare:workers`.
interface ObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  readonly HarnessDO: { idFromName(name: string): unknown; get(id: unknown): ObjectStub };
  readonly APPROVAL_KEYS: string;
  /** A Secrets Store binding: Miniflare's offline, and only on the live run when the owner configures one. */
  readonly APPROVAL_KEYS_STORE?: SecretsStoreSecretLike;
  /** Set only on the live run, whose deployment is public: every request must carry it as `?token=`. */
  readonly LIVE_TOKEN?: string;
  /** Set to "1" in the live run's config, so the Worker refuses every request until `LIVE_TOKEN` is set. */
  readonly LIVE?: string;
}

interface Storage extends DurableStorageLike {
  getAlarm(): Promise<number | null>;
}

interface State {
  readonly storage: Storage;
  acceptWebSocket(socket: HibernatableWebSocketLike): void;
  getWebSockets(): HibernatableWebSocketLike[];
}

const { WebSocketPair } = globalThis as unknown as {
  WebSocketPair: new () => Record<0 | 1, HibernatableWebSocketLike>;
};

/** What one suite case reports: its name, whether it skipped and why, or why it failed. */
export interface CaseOutcome {
  readonly name: string;
  readonly skipped?: string;
  readonly error?: string;
}

// The suite's fake clock starts in 2100, so no alarm the scheduler sets during a case comes due in real time and runs
// the object's own `alarm()` behind the case's back.
const START = Date.parse("2100-01-01T00:00:00.000Z");

function scriptedModel(answers: number): Model {
  const steps = Array.from({ length: answers }, (_, i) => ({ content: [{ type: "text" as const, text: `ok ${i}` }] }));
  return createModel({ adapter: new ScriptedModel(steps), id: "scripted-model", retries: 0 }) as Model;
}

function harnessFor(answers: number): ReturnType<typeof createHarness> {
  const model = scriptedModel(answers);
  return createHarness({ registry: createToolRegistry(), model, system: "You run Cloudflare adapter checks." });
}

/** An in-memory hibernatable socket pair: what the bridge sends reaches `onMessage`, and `deliver` feeds the bridge. */
class FakeHibernatable implements HibernatableWebSocketLike {
  readyState = 1;
  #attachment: unknown = null;
  readonly listeners = new Set<(message: ServerMessage) => void>();
  send(data: string): void {
    const message = decode(data) as ServerMessage;
    for (const listener of [...this.listeners]) listener(message);
  }
  close(): void {
    this.readyState = 3;
  }
  serializeAttachment(value: unknown): void {
    this.#attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown {
    return this.#attachment;
  }
}

export class HarnessDO {
  readonly ctx: State;
  readonly env: Env;
  // The example's server, built on first use and dropped by /ws/forget, as an eviction drops it.
  #server: Promise<{ readonly sockets: WebSocketHibernation }> | undefined;
  #sockets: WebSocketHibernation | undefined;
  #alarmScheduler: AlarmScheduler | undefined;

  // A new id each time the constructor runs, so the live run can tell a real eviction from a socket kept in memory.
  readonly #instance = crypto.randomUUID();

  constructor(ctx: State, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  /** The object's portability target, with the clocks the suite drives. */
  #target(): PortabilityTarget {
    const storage = this.ctx.storage;
    return {
      store: () => ({ store: doSqliteStore(storage) }),
      lock: () => {
        let time = START;
        const quiet = processScheduler({ now: () => time, setTimer: () => 0, clearTimer: () => undefined });
        const make = () => doLock(storage, { leaseMs: 2_000, renewMs: 1_999, now: () => time, scheduler: quiet });
        return {
          lock: make(),
          lease: {
            peer: make(),
            leaseMs: 2_000,
            staleness: "lease_only",
            advanceClock: (ms) => {
              time += ms;
            },
          },
        };
      },
      scheduler: () => this.#suiteScheduler(),
      keyStore: () => ({ store: workerKeyStore(this.env.APPROVAL_KEYS) }),
      transport: () => this.#fakeTransport(),
      effectStore: () => {
        createCloudflareTables(storage.sql);
        return durableObjectEffectStore(storage.sql);
      },
    };
  }

  #suiteScheduler() {
    let time = START;
    const scheduler = doAlarmScheduler(this.ctx.storage, { now: () => time });
    const delivered: DeliveredWake[] = [];
    scheduler.onWake((sessionId, at) => void delivered.push({ sessionId, at }));
    const storage = this.ctx.storage;
    return {
      scheduler,
      now: () => new Date(time),
      delivered: () => [...delivered],
      async advanceTo(to: Date) {
        time = to.getTime();
        // The real alarm is set in the object's storage; the suite runs it by hand once it is due on the fake clock.
        for (let rounds = 0; rounds < 100; rounds++) {
          const alarm = await storage.getAlarm();
          if (alarm === null || alarm > time) return;
          await scheduler.alarm();
        }
      },
    };
  }

  #fakeTransport() {
    const dispatcher = this.#makeDispatcher(4);
    const bridge = webSocketHibernation({ dispatcher });
    const socket = new FakeHibernatable();
    bridge.accept(socket);
    return {
      send: (message: ClientMessage) => bridge.webSocketMessage(socket, encode(message).slice(0, -1)),
      onMessage: (listener: (message: ServerMessage) => void) => {
        socket.listeners.add(listener);
        return () => socket.listeners.delete(listener);
      },
      close: () => bridge.webSocketClose(socket, 1000),
    };
  }

  #makeDispatcher(answers: number): Dispatcher {
    const storage = this.ctx.storage;
    return createDispatcher({
      harness: harnessFor(answers),
      store: doSqliteStore(storage),
      index: doSqliteIndex(storage),
      lock: doLock(storage),
      userId: "owner",
    });
  }

  async runCase(index: number): Promise<CaseOutcome> {
    const found = portabilityConformanceCases(this.#target())[index];
    if (found === undefined) return { name: `no case ${index}`, error: "there is no such case" };
    try {
      const outcome = await found.run();
      return outcome === undefined ? { name: found.name } : { name: found.name, skipped: outcome.skipped };
    } catch (error) {
      return { name: found.name, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** One writer in a race: it yields to the other requests first, then tries the lock and keeps what it won. */
  async raceLock(): Promise<"won" | "would_block"> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    const lock = doLock(this.ctx.storage);
    const result = await lock.acquire({ userId: "owner", sessionId: "raced" });
    return result === "would_block" ? result : "won";
  }

  /** One writer in a race to extend a log that ends at `h1`: exactly one may win. */
  async raceAppend(id: string): Promise<string> {
    const store = doSqliteStore(this.ctx.storage);
    const key = { userId: "owner", sessionId: "raced" };
    const header: EntryInput = {
      id: "h1",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      origin: "harness",
      type: "session_header",
      formatVersion: 1,
      harnessVersion: "0.0.0",
      sdkVersion: "0.0.0",
      defaultsHash: "d",
      capabilities: [],
      ablationHash: "a",
    };
    await store.append(key, [header]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    const entry: EntryInput = {
      id,
      parentId: "h1",
      timestamp: "2026-01-01T00:00:01.000Z",
      origin: "harness",
      type: "product_record",
      name: "race",
      data: {},
    };
    try {
      await store.append(key, [entry], { expectedLastId: "h1" });
      return "won";
    } catch (error) {
      return error instanceof Error ? error.name : "unknown";
    }
  }

  #liveScheduler(): AlarmScheduler {
    if (this.#alarmScheduler !== undefined) return this.#alarmScheduler;
    const scheduler = doAlarmScheduler(this.ctx.storage, { retryMs: 200 });
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS test_deliveries (wake_id TEXT, at INTEGER, outcome TEXT)");
    scheduler.onWake(async (id, at) => {
      // The first of a pair cancels the second, which is due in the same run.
      if (id === "cancel-a") await scheduler.cancel("cancel-b");
      const [row] = sql.exec("SELECT COUNT(*) AS n FROM test_deliveries WHERE wake_id = ?", id).toArray();
      const tries = Number(row?.n ?? 0);
      const fail = id.startsWith("flaky") && tries === 0;
      sql.exec("INSERT INTO test_deliveries VALUES (?, ?, ?)", id, at.getTime(), fail ? "threw" : "ok");
      if (fail) throw new Error("the first delivery of a flaky wake fails");
    });
    this.#alarmScheduler = scheduler;
    return scheduler;
  }

  /** Asks the real alarm for a wake `ms` from now. */
  async armWake(id: string, ms: number): Promise<number> {
    const at = Date.now() + ms;
    await this.#liveScheduler().wake(new Date(at), id);
    return at;
  }

  /** Asks for two wakes at one instant, so both are due in the same alarm run. */
  async armPair(first: string, second: string, ms: number): Promise<number> {
    const at = Date.now() + ms;
    await this.#liveScheduler().wake(new Date(at), first);
    await this.#liveScheduler().wake(new Date(at), second);
    return at;
  }

  async deliveries(): Promise<{ wake_id: string; at: number; outcome: string }[]> {
    this.#liveScheduler();
    return this.ctx.storage.sql.exec("SELECT * FROM test_deliveries ORDER BY rowid").toArray() as never;
  }

  async alarm(): Promise<void> {
    await this.#liveScheduler().alarm();
  }

  async #webSockets(): Promise<WebSocketHibernation> {
    this.#server ??= sessionObject({
      storage: this.ctx.storage,
      keyRing: this.env.APPROVAL_KEYS,
      model: scriptedModel(8),
      userId: "owner",
    });
    this.#sockets = (await this.#server).sockets;
    return this.#sockets;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const param = (name: string) => url.searchParams.get(name) ?? "";
    switch (url.pathname) {
      case "/case":
        return Response.json(await this.runCase(Number(param("index"))));
      case "/race/lock":
        return Response.json(await this.raceLock());
      case "/race/append":
        return Response.json(await this.raceAppend(param("id")));
      case "/alarm/arm":
        return Response.json(await this.armWake(param("id"), Number(param("ms"))));
      case "/alarm/pair":
        return Response.json(await this.armPair(param("first"), param("second"), Number(param("ms"))));
      case "/alarm/deliveries":
        return Response.json(await this.deliveries());
    }
    return this.#socketRequest(url);
  }

  async #socketRequest(url: URL): Promise<Response> {
    if (url.pathname === "/ws/forget") {
      // What an eviction does to memory: the server and its dispatcher are gone, and the sockets stay connected.
      this.#server = undefined;
      this.#sockets = undefined;
      return Response.json({ sockets: this.ctx.getWebSockets().length });
    }
    if (url.pathname === "/ws/served") {
      return Response.json({ served: this.#sockets?.served() ?? 0, instance: this.#instance });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    (await this.#webSockets()).accept(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
  }

  async webSocketMessage(ws: HibernatableWebSocketLike, message: string | ArrayBuffer): Promise<void> {
    await (await this.#webSockets()).webSocketMessage(ws, message);
  }

  async webSocketClose(ws: HibernatableWebSocketLike, code: number): Promise<void> {
    await (await this.#webSockets()).webSocketClose(ws, code);
  }

  async webSocketError(ws: HibernatableWebSocketLike): Promise<void> {
    await (await this.#webSockets()).webSocketError(ws);
  }
}

// The case names need no factory, so the live run lists them from the deployed Worker with these stand-ins.
const unlisted = (): never => {
  throw new Error("listed only");
};
const LISTED: PortabilityTarget = {
  store: unlisted,
  lock: unlisted,
  scheduler: unlisted,
  keyStore: unlisted,
  transport: unlisted,
  effectStore: unlisted,
};

/** Which object serves a path: each suite case has its own, and each scenario shares one. */
function objectFor(url: URL): string | undefined {
  const path = url.pathname;
  if (path === "/case") return `case-${url.searchParams.get("index") ?? 0}`;
  if (path.startsWith("/race/")) return path.slice(1);
  if (path.startsWith("/alarm/")) return "alarm";
  return path.startsWith("/ws") ? "ws" : undefined;
}

/** The smoke test: what each library did inside workerd, where `eval` and `new Function` are refused. */
async function smoke(env: Env): Promise<Record<string, unknown>> {
  const schema = {
    type: "object",
    properties: { order: { type: "integer" } },
    required: ["order"],
    additionalProperties: false,
  } as const;
  const pi = compile(schema);
  const fallback = new Validator(schema as never, "2020-12");
  let evalBlocked = false;
  try {
    new Function("return 1")();
  } catch {
    evalBlocked = true;
  }
  const server = new McpServer({ name: "smoke", version: "1.0.0" }, { capabilities: { tools: {} } });
  const json = { type: "object" };
  const anything = {
    "~standard": {
      version: 1,
      vendor: "smoke",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  };
  server.registerTool("echo", { description: "Returns its text.", inputSchema: anything as never }, (async (input: {
    text?: unknown;
  }) => ({ content: [{ type: "text", text: String(input.text) }] })) as never);
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const mcp = await connectMcpServer({ name: "smoke", transport: { kind: "in_process", channel: clientEnd as never } });
  const era = mcp.era;
  const tools = (await mcp.listTools()).map((tool) => tool.name);
  const called = await mcp.callTool("echo", { text: "from workerd" }, new AbortController().signal);
  await mcp.close();
  const ring = env.APPROVAL_KEYS_STORE === undefined ? undefined : await workerKeyStore(env.APPROVAL_KEYS_STORE).load();
  return {
    evalBlocked,
    pi: { valid: pi.check({ order: 1 }), invalid: pi.check({ order: "x" }) },
    fallback: { valid: fallback.validate({ order: 1 }).valid, invalid: fallback.validate({ order: "x" }).valid },
    era,
    tools,
    called,
    secretsStoreCurrent: ring?.current ?? null,
  };
}

// workerd loads a module Worker's handlers from its default export.
// biome-ignore lint/style/noDefaultExport: a module Worker must export its fetch handler as the default.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const live = env.LIVE === "1" || env.LIVE_TOKEN !== undefined;
    if (live && (env.LIVE_TOKEN === undefined || url.searchParams.get("token") !== env.LIVE_TOKEN)) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      if (url.pathname === "/cases") return Response.json(portabilityConformanceCases(LISTED).map((item) => item.name));
      if (url.pathname === "/smoke") return Response.json(await smoke(env));
      const object = (name: string) => env.HarnessDO.get(env.HarnessDO.idFromName(name));
      const name = objectFor(url);
      if (name !== undefined) return object(name).fetch(request);
      return new Response("not found", { status: 404 });
    } catch (error) {
      return new Response(error instanceof Error ? (error.stack ?? error.message) : String(error), { status: 500 });
    }
  },
};
