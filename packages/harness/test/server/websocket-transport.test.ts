// The WebSocket transport over an in-memory socket pair: a full turn, the answers to bad frames, the bounds it keeps,
// how it stops and what it leaves on the socket. No network socket is opened.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { type Dispatcher, type WebSocketLike, webSocketTransport } from "@buildanagent/harness/server";
import type { SessionStore } from "@buildanagent/harness/session";
import { ErrorCodes, JsonlFramer, type ServerMessage } from "@buildanagent/protocol";
import { describe, test, vi } from "vitest";
import { memoryBackend } from "../session/memory-backend.js";
import { MemorySocket } from "./memory-websocket.js";
import { approvalSetup, callTool, gate, init, recorded, reply, settledCount, until } from "./server-helpers.js";
import { initParams, methodsOf, type WsRun, wsRun, wsRunOn } from "./websocket-helpers.js";

/** A global `WebSocket`, as Node and browsers type it, fits the transport's socket type. */
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

/**
 * Makes `socket.close()` as strict as the standard `WebSocket`'s, which throws `InvalidAccessError` for any code but
 * 1000 and 3000 to 4999, and returns every code it was called with.
 */
function strictClose(socket: MemorySocket): (number | undefined)[] {
  const tried: (number | undefined)[] = [];
  const close = socket.close.bind(socket);
  socket.close = (code, reason) => {
    tried.push(code);
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999)) {
      throw new DOMException(
        `The close code must be either 1000, or between 3000 and 4999. ${code} is neither.`,
        "InvalidAccessError",
      );
    }
    close(code, reason);
  };
  return tried;
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

  test("a trailing newline is not counted: a message of exactly maxMessageBytes is served with or without one", async () => {
    const { dispatcher } = approvalSetup([]);
    const message = (id: number) => JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: initParams });
    const bound = new TextEncoder().encode(message(1)).length;
    const run = wsRun(dispatcher, { maxMessageBytes: bound });
    run.send(message(1));
    run.send(`${message(2)}\n`);
    run.send(`${message(3)}\r\n`);
    // The framer drops a trailing \r from a line before it counts it, so a lone one is not counted either.
    run.send(`${message(4)}\r`);
    await until(() => run.messages().length === 4, "four answers");
    assert.deepEqual(
      run.messages().map((m) => !("method" in m) && "result" in m && m.id),
      [1, 2, 3, 4],
    );
    assert.equal(run.server.readyState, 1);
    // One byte over, a space the JSON allows, is too big.
    run.send(`${message(5)} \n`);
    await run.done;
    assert.deepEqual(run.server.closeCalls, [{ code: 1009, reason: `a frame went over the bound of ${bound} bytes` }]);
  });

  for (const ending of ["", "\n", "\r\n", "\r", "\r\r\n", "\r\r", " \r\n"]) {
    test(`the bound treats a frame ending ${JSON.stringify(ending)} as stdio's framer treats that line`, async () => {
      const { dispatcher } = approvalSetup([]);
      const message = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams });
      const bound = new TextEncoder().encode(message).length;
      // The frame as one stdio line: its own newline, if it ends with one, ends the line.
      const line = ending.endsWith("\n") ? `${message}${ending}` : `${message}${ending}\n`;
      const framed = new JsonlFramer({ maxLineBytes: bound }).push(new TextEncoder().encode(line));
      const stdioTooBig = framed.some((m) => !m.ok && m.error.code === "line_too_long");
      const run = wsRun(dispatcher, { maxMessageBytes: bound });
      run.send(`${message}${ending}`);
      await until(() => run.messages().length > 0, "an answer");
      assert.equal(run.server.closeCalls[0]?.code === 1009, stdioTooBig);
      run.client.close(1000);
      await run.done;
    });
  }

  for (const [name, frame] of [
    ["an ArrayBuffer", () => new ArrayBuffer(65)],
    ["a Uint8Array", () => new Uint8Array(65)],
    ["a Buffer", () => Buffer.alloc(65)],
    ["a Blob", () => new Blob([new Uint8Array(65)])],
  ] as const) {
    test(`a binary frame over maxMessageBytes, as ${name}, is answered and the socket closed with 1009`, async () => {
      const { dispatcher } = approvalSetup([]);
      const run = wsRun(dispatcher, { maxMessageBytes: 64 });
      run.client.send(frame() as never);
      await run.done;
      await until(() => run.closes.length === 1, "the close");
      assert.deepEqual(
        errorsOf(run.messages()).map((m) => [m.id, m.error.code, m.error.message]),
        [[null, ErrorCodes.InvalidRequest, "a frame went over the bound of 64 bytes"]],
      );
      assert.deepEqual(run.server.closeCalls, [{ code: 1009, reason: "a frame went over the bound of 64 bytes" }]);
    });
  }

  test("a binary frame within maxMessageBytes is refused as binary, and the socket stays open", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher, { maxMessageBytes: 64 });
    run.client.send(new Uint8Array(64));
    await until(() => run.messages().length === 1, "the refusal");
    assert.deepEqual(
      errorsOf(run.messages()).map((m) => [m.id, m.error.message]),
      [[null, "a frame must be text, not binary"]],
    );
    assert.equal(run.server.readyState, 1);
    run.client.close(1000);
    await run.done;
  });

  test("a frame with a lone surrogate gets ParseError, as a line of bad UTF-8 does on stdio", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher);
    // JSON.stringify would escape the surrogate, so the frame is written by hand.
    run.send('{"jsonrpc":"2.0","id":7,"method":"x\uD800"}');
    // An escaped surrogate and a whole pair are well-formed text, so they reach the dispatcher.
    run.send('{"jsonrpc":"2.0","id":8,"method":"x\\ud800"}');
    run.send('{"jsonrpc":"2.0","id":9,"method":"x😀"}');
    await until(() => run.messages().length === 3, "three answers");
    assert.deepEqual(
      errorsOf(run.messages()).map((m) => [m.id, m.error.code]),
      [
        [null, ErrorCodes.ParseError],
        [8, ErrorCodes.MethodNotFound],
        [9, ErrorCodes.MethodNotFound],
      ],
    );
    assert.equal(errorsOf(run.messages())[0]?.error.message, "a frame is not valid UTF-8 JSON");
    run.client.close(1000);
    await run.done;
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

  test("with 1011 when send() throws on an open socket, logging the error's name but never its message", async () => {
    const fake = fakeDispatcher();
    const run = wsRun(fake.dispatcher);
    run.server.send = () => {
      throw Object.assign(new Error("SECRET"), { name: "RefusedError" });
    };
    assert.equal(fake.send()(notification(1)), undefined);
    await run.done;
    const reason = "the socket refused a frame: RefusedError";
    assert.deepEqual(stopped(run), [`websocket: stopped: ${reason}`]);
    assert.deepEqual(run.server.closeCalls, [{ code: 1011, reason }]);
    assert.deepEqual(fake.events, ["closed"]);
    for (const line of run.logs) assert.ok(!line.includes("SECRET"), line);
  });

  test("cuts a close reason to 123 UTF-8 bytes on a whole character", async () => {
    const fake = fakeDispatcher();
    const run = wsRun(fake.dispatcher);
    // 28 ASCII bytes, then three bytes a character: a cut by UTF-16 units would send 123 characters, 313 bytes.
    const name = "€".repeat(60);
    run.server.send = () => {
      throw Object.assign(new Error("x"), { name });
    };
    fake.send()(notification(1));
    await run.done;
    const sent = run.server.closeCalls[0]?.reason ?? "";
    assert.equal(sent, `the socket refused a frame: ${"€".repeat(31)}`);
    assert.equal(new TextEncoder().encode(sent).length, 121);
  });

  test("a socket that refuses 1008 is closed with 4008, as the standard WebSocket must be", async () => {
    const { dispatcher } = approvalSetup([]);
    const [server, client] = MemorySocket.pair();
    const tried = strictClose(server);
    client.reading = false;
    const run = wsRunOn(dispatcher, server, client, { maxBufferedBytes: 1 });
    for (let i = 0; i < 200; i += 1) run.send("{}");
    await run.done;
    const reason = "128 error responses wait unread";
    assert.deepEqual(tried, [1008, 4008]);
    assert.deepEqual(server.closeCalls, [{ code: 4008, reason }]);
    assert.equal(server.readyState, 2);
    assert.deepEqual(stopped(run), [`websocket: stopped: ${reason}`]);
    assert.ok(!run.logs.some((line) => line.includes("could not be closed")));
  });

  test("a socket that refuses 1009 is closed with 4009 after a frame that is too big", async () => {
    const { dispatcher } = approvalSetup([]);
    const run = wsRun(dispatcher, { maxMessageBytes: 8 });
    const tried = strictClose(run.server);
    run.send("x".repeat(9));
    await run.done;
    await until(() => run.closes.length === 1, "the close");
    assert.deepEqual(tried, [1009, 4009]);
    assert.deepEqual(run.server.closeCalls, [{ code: 4009, reason: "a frame went over the bound of 8 bytes" }]);
    assert.deepEqual(run.closes, [4009]);
  });

  test("a socket that refuses 1011 is closed with 4011 after send() throws", async () => {
    const fake = fakeDispatcher();
    const run = wsRun(fake.dispatcher);
    const tried = strictClose(run.server);
    run.server.send = () => {
      throw Object.assign(new Error("SECRET"), { name: "RefusedError" });
    };
    fake.send()(notification(1));
    await run.done;
    assert.deepEqual(tried, [1011, 4011]);
    assert.deepEqual(run.server.closeCalls, [{ code: 4011, reason: "the socket refused a frame: RefusedError" }]);
    assert.ok(!run.logs.some((line) => line.includes("could not be closed")));
  });

  test("a socket that refuses every close is left as it is, with one line logged and the transport resolved", async () => {
    const fake = fakeDispatcher();
    const run = wsRun(fake.dispatcher, { maxMessageBytes: 8 });
    const tried: (number | undefined)[] = [];
    run.server.close = (code) => {
      tried.push(code);
      throw Object.assign(new Error("SECRET message"), { name: "InvalidAccessError" });
    };
    run.send("x".repeat(9));
    await run.done;
    assert.ok(run.finished());
    assert.deepEqual(tried, [1009, 4009]);
    assert.equal(run.server.readyState, 1);
    const failures = run.logs.filter((line) => line.includes("could not be closed"));
    assert.deepEqual(failures, ["websocket: the socket could not be closed: InvalidAccessError"]);
    for (const line of run.logs) assert.ok(!line.includes("SECRET"), line);
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
