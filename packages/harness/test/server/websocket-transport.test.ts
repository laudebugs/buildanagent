// The WebSocket transport over an in-memory socket pair: a full turn, the answers to bad frames, the bounds it keeps,
// how it stops and what it leaves on the socket. No network socket is opened.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { type Dispatcher, type WebSocketLike, webSocketTransport } from "@buildanagent/harness/server";
import type { SessionStore } from "@buildanagent/harness/session";
import { ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { describe, test, vi } from "vitest";
import { memoryBackend } from "../session/memory-backend.js";
import { MemorySocket } from "./memory-websocket.js";
import { approvalSetup, callTool, gate, init, recorded, reply, settledCount, until } from "./server-helpers.js";
import { initParams, methodsOf, type WsRun, wsRun, wsRunOn } from "./websocket-helpers.js";

/** A global `WebSocket`, as Node, browsers and Workers type it, fits the transport's socket type. */
const fits = (socket: WebSocket): WebSocketLike => socket;
void fits;

const errorsOf = (messages: readonly ServerMessage[]) =>
  messages.flatMap((message) => ("error" in message && !("method" in message) ? [message] : []));

const stopped = (run: WsRun) => run.logs.filter((line) => line.startsWith("websocket: stopped"));

/** A dispatcher whose one connection records what it is told, for tests that drive the server's side by hand. */
function fakeDispatcher(): {
  dispatcher: Dispatcher;
  send: () => (message: ServerMessage) => unknown;
  events: string[];
} {
  let deliver: ((message: ServerMessage) => unknown) | undefined;
  const events: string[] = [];
  const dispatcher: Dispatcher = {
    connect(send) {
      deliver = send;
      return {
        async receive(message) {
          events.push(`received ${JSON.stringify(message)}`);
        },
        close() {
          events.push("closed");
        },
      };
    },
    async close() {},
  };
  return { dispatcher, send: () => deliver as (message: ServerMessage) => unknown, events };
}

const notification = (n: number): ServerMessage =>
  ({ jsonrpc: "2.0", method: "event", params: { session: "s", seq: n, event: { type: "x".repeat(100) } } }) as never;

describe("a turn over a WebSocket", () => {
  test("runs a turn that asks for approval, with one message per text frame and no newline", async () => {
    const { dispatcher, refunds } = approvalSetup([
      { content: [callTool("c1", "refund", { id: "o1" })] },
      reply("Done."),
    ]);
    const run = wsRun(dispatcher);
    const init = await run.request(1, "initialize", initParams);
    assert.ok("result" in init);
    await run.request(2, "session/create", { session: "s1", cwd: "/w" });
    await run.request(3, "turn/start", { session: "s1", input: [{ type: "text", text: "refund o1" }] });
    await until(() => methodsOf(run.messages()).includes("approval/request"), "approval/request");
    const asked = run.messages().find((m) => "method" in m && m.method === "approval/request") as Extract<
      ServerMessage,
      { method: "approval/request" }
    >;
    const resolution = { requestId: asked.params.request.id, decision: "allow", by: "ada" };
    run.send({ jsonrpc: "2.0", id: asked.id, result: { resolutions: [resolution] } });
    await until(() => methodsOf(run.messages()).filter((m) => m === "turn/settled").length === 2, "two turn/settled");
    assert.deepEqual(refunds, [{ id: "o1" }]);
    assert.ok(methodsOf(run.messages()).filter((m) => m === "event").length > 5);
    for (const frame of run.frames) assert.ok(typeof frame === "string" && !frame.includes("\n"), String(frame));
    run.client.close(1000);
    await run.done;
    assert.deepEqual(stopped(run), ["websocket: stopped: the peer closed the socket with code 1000"]);
    assert.deepEqual(run.server.closeCalls, []);
  });

  test("the 129th command waiting on one connection gets QueueFull, as in the other transports", async () => {
    const held = gate();
    const backend = memoryBackend();
    const store: SessionStore = {
      ...backend.store,
      async *list(userId) {
        await held.promise;
        yield* backend.store.list(userId);
      },
    };
    const { dispatcher } = approvalSetup([], [], {}, { ...backend, store });
    const run = wsRun(dispatcher);
    for (let id = 1; id <= 129; id += 1) run.send({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    await until(() => run.messages().length === 1, "the refusal");
    const [refused] = errorsOf(run.messages());
    assert.equal(refused?.id, 129);
    assert.equal(refused?.error.code, ErrorCodes.QueueFull);
    held.open();
    await until(() => run.messages().length === 129, "every answer");
    run.client.close(1000);
    await run.done;
  });
});

describe("a bad frame gets the stdio transport's answer, and the socket stays open", () => {
  test("not JSON, binary, two lines, none, a batch and a bad envelope are each answered, and nothing echoes the client", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher);
    run.send("not json SECRET");
    run.client.send(new TextEncoder().encode('{"jsonrpc":"2.0","id":9,"method":"initialize"}'));
    run.send(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "x" })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "x" })}`,
    );
    run.send("  \r\n");
    run.send([{ jsonrpc: "2.0", id: 3, method: "initialize" }]);
    run.send({ jsonrpc: "1.0", id: 4, method: "SECRET" });
    run.send({ jsonrpc: "2.0", id: 99, result: {}, error: { code: 1, message: "SECRET" } });
    // A trailing newline is allowed, and the command after the bad frames is still served.
    run.send(`${JSON.stringify({ jsonrpc: "2.0", id: 5, method: "initialize", params: initParams })}\r\n`);
    await until(() => run.messages().some((m) => !("method" in m) && m.id === 5 && "result" in m), "initialize");
    const errors = errorsOf(run.messages()).map((m) => [m.id, m.error.code]);
    assert.deepEqual(errors, [
      [null, ErrorCodes.ParseError],
      [null, ErrorCodes.InvalidRequest],
      [null, ErrorCodes.InvalidRequest],
      [null, ErrorCodes.InvalidRequest],
      [null, ErrorCodes.InvalidRequest],
      [4, ErrorCodes.InvalidRequest],
    ]);
    assert.ok(
      run.logs.some((line) => line.startsWith("websocket: ignored a malformed response")),
      run.logs.join("\n"),
    );
    for (const text of [...run.logs, ...run.frames.map(String)]) assert.ok(!text.includes("SECRET"), text);
    assert.equal(run.server.readyState, 1);
    run.client.close(4000, "SECRET reason");
    await run.done;
    assert.deepEqual(stopped(run), ["websocket: stopped: the peer closed the socket with code 4000"]);
  });

  test("a frame over maxMessageBytes, counted in UTF-8 bytes, is answered and the socket closed with 1009", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher, { maxMessageBytes: 64 });
    // 46 characters but 66 bytes, so a bound read as characters would let it in.
    const frame = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "€".repeat(10) });
    assert.equal(frame.length, 46);
    run.send(frame);
    await run.done;
    await until(() => run.closes.length === 1, "the close");
    assert.deepEqual(
      errorsOf(run.messages()).map((m) => [m.id, m.error.code, m.error.message]),
      [[null, ErrorCodes.InvalidRequest, "a frame went over the bound of 64 bytes"]],
    );
    assert.deepEqual(run.closes, [1009]);
    assert.deepEqual(stopped(run), ["websocket: stopped: a frame went over the bound of 64 bytes"]);
  });

  test("a frame within maxMessageBytes is served", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher, { maxMessageBytes: 200 });
    const answered = await run.request(1, "initialize", initParams);
    assert.ok("result" in answered);
    run.client.close(1000);
    await run.done;
  });
});

describe("the transport stops itself, says why and closes the socket", () => {
  test("with 1008 once 128 error answers wait on a full send buffer", async () => {
    const { dispatcher } = approvalSetup([]);
    const [server, client] = MemorySocket.pair();
    client.reading = false;
    const run = wsRunOn(dispatcher, server, client, { maxBufferedBytes: 1 });
    for (let i = 0; i < 200; i += 1) run.send("{}");
    await run.done;
    assert.deepEqual(stopped(run), ["websocket: stopped: 128 error responses wait unread"]);
    assert.deepEqual(server.closeCalls, [{ code: 1008, reason: "128 error responses wait unread" }]);
    assert.equal(server.listenerCount, 0);
  });

  test("with 1008 when the dispatcher closes the connection for refusals left unread", async () => {
    const held = gate();
    const backend = memoryBackend();
    const store: SessionStore = {
      ...backend.store,
      async *list(userId) {
        await held.promise;
        yield* backend.store.list(userId);
      },
    };
    const { dispatcher } = approvalSetup([], [], { queueSize: 1 }, { ...backend, store });
    const [server, client] = MemorySocket.pair();
    client.reading = false;
    const run = wsRunOn(dispatcher, server, client, { maxBufferedBytes: 1 });
    for (let id = 1; id <= 4; id += 1) run.send({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    await run.done;
    assert.deepEqual(stopped(run), ["websocket: stopped: the connection closed"]);
    assert.equal(server.closeCalls[0]?.code, 1008);
    held.open();
  });

  test("with 1000 when the signal aborts, removing every listener and closing the connection", async () => {
    const fake = fakeDispatcher();
    const controller = new AbortController();
    const run = wsRun(fake.dispatcher, { signal: controller.signal });
    assert.equal(run.server.listenerCount, 3);
    controller.abort();
    await run.done;
    assert.equal(run.server.listenerCount, 0);
    assert.deepEqual(run.server.closeCalls, [{ code: 1000, reason: "the signal aborted" }]);
    assert.deepEqual(fake.events, ["closed"]);
    await until(() => run.closes.length === 1, "the client's close");
    assert.deepEqual(run.closes, [1000]);
  });

  test("an already aborted signal stops it at once", async () => {
    const fake = fakeDispatcher();
    const run = wsRun(fake.dispatcher, { signal: AbortSignal.abort() });
    await run.done;
    assert.deepEqual(stopped(run), ["websocket: stopped: the signal aborted"]);
  });
});

describe("the peer goes away", () => {
  test("a socket error stops the transport and closes the connection without closing the socket", async () => {
    const fake = fakeDispatcher();
    const run = wsRun(fake.dispatcher);
    run.client.fail();
    await run.done;
    assert.deepEqual(stopped(run), ["websocket: stopped: the socket failed"]);
    assert.deepEqual(run.server.closeCalls, []);
    assert.deepEqual(fake.events, ["closed"]);
    assert.equal(run.server.listenerCount, 0);
  });

  test("a close while a message waits for room ends the wait, and the transport resolves", async () => {
    const fake = fakeDispatcher();
    const [server, client] = MemorySocket.pair();
    client.reading = false;
    const run = wsRunOn(fake.dispatcher, server, client, { maxBufferedBytes: 10 });
    const waited = fake.send()(notification(1));
    assert.equal(typeof (waited as PromiseLike<void> | undefined)?.then, "function");
    client.close(1001);
    await run.done;
    await waited;
    assert.deepEqual(stopped(run), ["websocket: stopped: the peer closed the socket with code 1001"]);
  });
});

describe("backpressure", () => {
  test("a client that stops reading keeps the send buffer near its bound, and gets turn/settled once it reads", async () => {
    const steps = [{ content: [{ type: "text" as const, text: "x".repeat(20_000) }] }];
    const { dispatcher } = approvalSetup(steps);
    const [server, client] = MemorySocket.pair();
    const run = wsRunOn(dispatcher, server, client, { maxBufferedBytes: 4096 });
    await run.request(1, "initialize", initParams);
    await run.request(2, "session/create", { session: "s1", cwd: "/w" });
    // A client in this process watches the same session, so the test knows when the turn is done without a sleep.
    const watcher = recorded(dispatcher);
    await init(watcher.client);
    await watcher.client.request("session/open", { session: "s1", cwd: "/w" });
    client.reading = false;
    run.send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: [] } });
    // The turn streams 5,000 deltas while nothing is read.
    await until(() => settledCount(watcher.seen) === 1, "the watcher's turn/settled");
    assert.ok(server.bufferedAmount > 4096, `buffered ${server.bufferedAmount}`);
    // One frame may go over the bound before the transport waits; no more.
    assert.ok(server.mostBuffered < 4096 + 2048, `most buffered ${server.mostBuffered}`);
    watcher.client.close();
    client.reading = true;
    await until(() => methodsOf(run.messages()).includes("turn/settled"), "turn/settled");
    const dropped = run
      .messages()
      .some((m) => "method" in m && m.method === "event" && m.params.event.type === "events_dropped");
    assert.ok(dropped, "no events_dropped marker");
    client.close(1000);
    await run.done;
  }, 20_000);
});

/** Runs `body` on a fake clock for `setTimeout` and `clearTimeout` only, and checks no timer is left once it returns. */
async function onFakeClock(body: () => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await body();
    assert.equal(vi.getTimerCount(), 0, "a timer was left behind");
  } finally {
    vi.useRealTimers();
  }
}

describe("the write timeout", () => {
  test("stops a peer that reads nothing for 30 seconds with 1008, and polls with one timer", async () => {
    await onFakeClock(async () => {
      const fake = fakeDispatcher();
      const [server, client] = MemorySocket.pair();
      client.reading = false;
      const run = wsRunOn(fake.dispatcher, server, client, { maxBufferedBytes: 10 });
      for (let n = 0; n < 5; n += 1) fake.send()(notification(n));
      assert.equal(vi.getTimerCount(), 1);
      await vi.advanceTimersByTimeAsync(29_975);
      assert.equal(run.finished(), false);
      assert.equal(vi.getTimerCount(), 1);
      await vi.advanceTimersByTimeAsync(25);
      await run.done;
      assert.deepEqual(stopped(run), ["websocket: stopped: the peer read nothing for 30000 ms"]);
      assert.deepEqual(server.closeCalls, [{ code: 1008, reason: "the peer read nothing for 30000 ms" }]);
      assert.deepEqual(fake.events, ["closed"]);
    });
  });

  test("restarts each time the buffer shrinks, so a peer that reads slowly is never cut off", async () => {
    await onFakeClock(async () => {
      const fake = fakeDispatcher();
      const [server, client] = MemorySocket.pair();
      client.reading = false;
      const run = wsRunOn(fake.dispatcher, server, client, { maxBufferedBytes: 10, writeTimeoutMs: 1000 });
      const waited = fake.send()(notification(0));
      for (let n = 1; n < 4; n += 1) fake.send()(notification(n));
      // One frame read every 900 ms: four reads, 3.6 seconds in all, and no 1000 ms without one.
      for (let read = 0; read < 4; read += 1) {
        await vi.advanceTimersByTimeAsync(900);
        assert.equal(run.finished(), false);
        client.readOne();
      }
      await vi.advanceTimersByTimeAsync(25);
      await waited;
      assert.equal(vi.getTimerCount(), 0);
      assert.deepEqual(stopped(run), []);
      client.close(1000);
      await run.done;
    });
  });

  test("Infinity waits as long as it takes, and the abort clears the poll timer", async () => {
    await onFakeClock(async () => {
      const fake = fakeDispatcher();
      const [server, client] = MemorySocket.pair();
      client.reading = false;
      const controller = new AbortController();
      const run = wsRunOn(fake.dispatcher, server, client, {
        maxBufferedBytes: 10,
        writeTimeoutMs: Number.POSITIVE_INFINITY,
        signal: controller.signal,
      });
      fake.send()(notification(0));
      await vi.advanceTimersByTimeAsync(3_600_000);
      assert.equal(run.finished(), false);
      controller.abort();
      await run.done;
      assert.deepEqual(stopped(run), ["websocket: stopped: the signal aborted"]);
    });
  });
});

describe("a transport that can't start", () => {
  for (const [name, options] of [
    ["writeTimeoutMs", { writeTimeoutMs: 0 }],
    ["maxMessageBytes", { maxMessageBytes: 0 }],
    ["maxBufferedBytes", { maxBufferedBytes: 1.5 }],
  ] as const) {
    test(`refuses a bad ${name} before it connects`, async () => {
      const fake = fakeDispatcher();
      const [server] = MemorySocket.pair();
      await assert.rejects(
        webSocketTransport(fake.dispatcher, server, options),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_transport_options",
      );
      assert.equal(fake.send(), undefined);
      assert.equal(server.listenerCount, 0);
    });
  }

  test("refuses a socket that is not open, before it connects", async () => {
    const fake = fakeDispatcher();
    const [server] = MemorySocket.pair();
    server.readyState = 3;
    await assert.rejects(
      webSocketTransport(fake.dispatcher, server),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_transport_options",
    );
    assert.equal(fake.send(), undefined);
  });

  test("on a closed dispatcher leaves no listener on the socket", async () => {
    const { dispatcher } = approvalSetup([]);
    await dispatcher.close();
    const [server] = MemorySocket.pair();
    await assert.rejects(webSocketTransport(dispatcher, server), /the dispatcher is closed/);
    assert.equal(server.listenerCount, 0);
  });
});
