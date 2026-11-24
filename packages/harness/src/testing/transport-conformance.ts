/**
 * The transport conformance suite: what every JSON-RPC 2.0 harness transport must do (`inProcessTransport`,
 * `stdioTransport`, `webSocketTransport` and any hosted transport). The cases verify the `initialize` handshake,
 * session creation and listing, a complete `turn/start` to `turn/settled` lifecycle, and clean close. The cases import
 * no test runner and no Node module, so any runner, including workerd, can call them.
 */
import type { ClientMessage, ClientResultMap, ServerMessage } from "@buildanagent/protocol";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";

/** One live JSON-RPC 2.0 client connection attached to a harness dispatcher. */
export interface TransportUnderTest {
  /** Sends one JSON-RPC 2.0 client message over the transport. */
  readonly send: (message: ClientMessage) => Promise<void> | void;
  /** Subscribes to every server message arriving over the transport; returns an unsubscribe function. */
  readonly onMessage: (listener: (message: ServerMessage) => void) => () => void;
  /** Closes the transport and releases any underlying resources. */
  readonly close: () => Promise<void> | void;
}

/** Makes a fresh connected transport backed by a scripted harness dispatcher for each case. */
export type TransportFactory = () => TransportUnderTest | Promise<TransportUnderTest>;

/** One case of the transport conformance suite. */
export type TransportCase = RunnableCase;

/** The report the transport conformance suite returns. */
export type TransportConformanceReport = CaseReport;

const DEFAULT_WAIT_MS = 5_000;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Transport conformance: ${message}`);
}

function createCollector(under: TransportUnderTest) {
  const seen: ServerMessage[] = [];
  const waiters: {
    readonly match: (msg: ServerMessage) => boolean;
    readonly resolve: (msg: ServerMessage) => void;
    readonly reject: (err: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }[] = [];

  const off = under.onMessage((msg) => {
    seen.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i];
      if (waiter?.match(msg)) {
        clearTimeout(waiter.timer);
        waiters.splice(i, 1);
        waiter.resolve(msg);
      }
    }
  });

  const waitFor = (match: (msg: ServerMessage) => boolean, description: string): Promise<ServerMessage> => {
    const existing = seen.find(match);
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error(`Transport conformance: timed out waiting for ${description}`));
      }, DEFAULT_WAIT_MS);
      waiters.push({ match, resolve, reject, timer });
    });
  };

  const dispose = () => {
    off();
    for (const waiter of waiters.splice(0)) clearTimeout(waiter.timer);
  };

  return { waitFor, dispose };
}

async function rpcCall<M extends keyof ClientResultMap>(
  under: TransportUnderTest,
  collector: ReturnType<typeof createCollector>,
  id: number,
  method: M,
  params: Record<string, unknown>,
): Promise<ClientResultMap[M]> {
  await under.send({ jsonrpc: "2.0", id, method, params } as ClientMessage);
  const reply = await collector.waitFor(
    (msg) => "id" in msg && msg.id === id && ("result" in msg || "error" in msg),
    `response to ${method} (id=${id})`,
  );
  check("result" in reply, `${method} returned an RPC error: ${JSON.stringify(reply)}`);
  return reply.result as ClientResultMap[M];
}

const INIT_PARAMS = { clientInfo: { name: "conformance", version: "0.0.0" }, capabilities: [] };

async function checkSessionLifecycle(under: TransportUnderTest): Promise<void> {
  const collector = createCollector(under);
  try {
    await rpcCall(under, collector, 1, "initialize", INIT_PARAMS);
    const created = await rpcCall(under, collector, 2, "session/create", { cwd: "/workspace" });
    check(typeof created.session === "string" && created.session.length > 0, "session/create must return a session id");

    const started = await rpcCall(under, collector, 3, "turn/start", {
      session: created.session,
      input: [{ type: "text", text: "hello" }],
    });
    check(started.accepted === true, `expected accepted: true, got ${JSON.stringify(started)}`);
    check(typeof started.turn === "string" && started.turn.length > 0, "accepted disposition must name a turn");
    const settled = await collector.waitFor(
      (msg) => "method" in msg && msg.method === "turn/settled",
      "turn/settled notification",
    );
    check(
      "params" in settled && typeof settled.params === "object" && settled.params !== null,
      "turn/settled must carry params",
    );
    const params = settled.params as { readonly session?: unknown; readonly turn?: unknown };
    check(params.session === created.session, "turn/settled must name the created session");
    check(params.turn === started.turn, "turn/settled must name the started turn");

    const listed = await rpcCall(under, collector, 4, "session/list", {});
    check(Array.isArray(listed.sessions), "session/list must return a sessions array");
    check(
      listed.sessions.some((item) => item.session === created.session),
      "session/list must include the session after its first turn",
    );
  } finally {
    collector.dispose();
  }
}

async function checkUnknownMethodError(under: TransportUnderTest): Promise<void> {
  const collector = createCollector(under);
  try {
    await under.send({ jsonrpc: "2.0", id: 1, method: "conformance/unknown", params: {} } as unknown as ClientMessage);
    const reply = await collector.waitFor(
      (msg) => "id" in msg && msg.id === 1 && ("result" in msg || "error" in msg),
      "error response to unknown method",
    );
    check(
      "error" in reply && typeof reply.error.code === "number",
      `expected JSON-RPC error, got ${JSON.stringify(reply)}`,
    );
    // The transport must stay usable after returning a JSON-RPC error.
    const init = await rpcCall(under, collector, 2, "initialize", INIT_PARAMS);
    check(Array.isArray(init.capabilities), "transport must answer initialize after an error response");
  } finally {
    collector.dispose();
  }
}

/** The transport conformance cases, each run against a fresh transport from `factory`. */
export function transportConformanceCases(factory: TransportFactory): readonly TransportCase[] {
  const named = (name: string, body: (under: TransportUnderTest) => Promise<void>): TransportCase => ({
    name,
    run: async () => {
      const under = await factory();
      try {
        await body(under);
      } finally {
        await under.close();
      }
      return undefined;
    },
  });

  return [
    named("initialize returns server capabilities and pending requests", async (under) => {
      const collector = createCollector(under);
      try {
        const result = await rpcCall(under, collector, 1, "initialize", INIT_PARAMS);
        check(Array.isArray(result.capabilities), "initialize must return a capabilities array");
        check(Array.isArray(result.pending), "initialize must return a pending array");
      } finally {
        collector.dispose();
      }
    }),
    named(
      "session/create, turn/start to turn/settled and session/list round-trip over the transport",
      checkSessionLifecycle,
    ),
    named("unknown method returns a JSON-RPC error without closing the transport", checkUnknownMethodError),
  ];
}

/** Runs every transport conformance case and reports which passed, skipped and failed. */
export function runTransportConformance(factory: TransportFactory): Promise<TransportConformanceReport> {
  return runCases(transportConformanceCases(factory));
}
