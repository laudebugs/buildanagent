// The stdio transport in this process, over Node and Web streams the test holds: how it stops, what it leaves on the
// streams, and the bounds it keeps under a full output. The child-process tests in stdio.test.ts cover the wire.
import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import { type Dispatcher, stdioTransport } from "@buildanagent/harness/server";
import type { SessionStore } from "@buildanagent/harness/session";
import { decode, ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { chunkReader, lineWriter, Stopper } from "../../src/server/stdio-streams.js";
import { memoryBackend } from "../session/memory-backend.js";
import { approvalSetup, callTool, gate, reply, until } from "./server-helpers.js";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const initialize = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: { clientInfo: { name: "t", version: "0" }, capabilities: [] },
});

/** An output that keeps every line written to it. */
function reading(): { output: Writable; messages: () => ServerMessage[] } {
  let text = "";
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      text += chunk.toString("utf8");
      callback();
    },
  });
  return {
    output,
    messages: () =>
      text
        .split("\n")
        .filter((part) => part !== "")
        .map((part) => decode(part) as unknown as ServerMessage),
  };
}

/** An output whose reader never reads: it reports itself full after one byte and never calls back. */
const stalled = () => new Writable({ highWaterMark: 1, write() {} });

/** Fails after `ms` when `promise` has not settled, so a transport that hangs fails the test instead of timing out. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

const settled = (messages: readonly ServerMessage[]) =>
  messages.filter((message) => "method" in message && message.method === "turn/settled").length;

describe("the transport stops, and says why", () => {
  test("when the dispatcher closes the connection for refusals the client leaves unread", async () => {
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
    const input = new PassThrough();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output: stalled(), log: (entry) => logs.push(entry) });
    // One command holds the queue's only place; each next one is refused, and the refusals are never read.
    for (let id = 1; id <= 4; id += 1) input.write(line({ jsonrpc: "2.0", id, method: "session/list", params: {} }));
    await within(done, 2000, "the transport");
    assert.ok(logs.includes("stdio: stopped: the connection closed"), logs.join("\n"));
    assert.equal(input.destroyed, false);
    held.open();
  });

  test("when the input fails, after answering what it already read", async () => {
    const { dispatcher } = approvalSetup([]);
    const input = new PassThrough();
    const { output, messages } = reading();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output, log: (entry) => logs.push(entry) });
    input.write(line(initialize(1)));
    await until(() => messages().length === 1, "the answer to initialize");
    input.destroy(new Error("EIO"));
    await within(done, 2000, "the transport");
    assert.ok(logs.includes("stdio: the input failed: EIO"), logs.join("\n"));
  });

  test("when a Web input errors, it resolves and logs instead of rejecting", async () => {
    const { dispatcher } = approvalSetup([]);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const input = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output: reading().output, log: (entry) => logs.push(entry) });
    controller.error(new Error("broken pipe"));
    await within(done, 2000, "the transport");
    assert.ok(logs.includes("stdio: the input failed: broken pipe"), logs.join("\n"));
  });
});

describe("the streams the transport leaves behind", () => {
  test("an abort leaves a Node input open and unread, with none of the transport's listeners on either stream", async () => {
    const { dispatcher } = approvalSetup([]);
    const input = new PassThrough();
    const output = stalled();
    const controller = new AbortController();
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);
    try {
      const done = stdioTransport(dispatcher, { input, output }, { signal: controller.signal });
      // A dozen bad lines while the output is full share one wait for room.
      input.write("not json\n".repeat(12));
      await until(() => output.listenerCount("drain") === 1, "the wait for room");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(output.listenerCount("drain"), 1);
      controller.abort();
      await within(done, 2000, "the transport");
      assert.equal(input.destroyed, false);
      for (const event of ["data", "end", "close", "error"]) assert.equal(input.listenerCount(event), 0, event);
      for (const event of ["drain", "close", "error"]) assert.equal(output.listenerCount(event), 0, event);
      // The input still works for its owner.
      input.write("still here\n");
      assert.equal(String(input.read()), "still here\n");
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(
        warnings.filter((warning) => warning.name === "MaxListenersExceededWarning"),
        [],
      );
    } finally {
      process.off("warning", onWarning);
    }
  });

  test("an abort releases a Web input without cancelling it", async () => {
    const { dispatcher } = approvalSetup([]);
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const input = new ReadableStream<Uint8Array>({
      start(c) {
        source = c;
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const done = stdioTransport(dispatcher, { input, output: reading().output }, { signal: controller.signal });
    controller.abort();
    await within(done, 2000, "the transport");
    assert.equal(cancelled, false);
    assert.equal(input.locked, false);
    source.enqueue(new TextEncoder().encode("x"));
    const read = await input.getReader().read();
    assert.equal(new TextDecoder().decode(read.value), "x");
  });
});

describe("the transport's own error answers", () => {
  test("a reading client's burst of bad lines is answered in full, and the command after it too", async () => {
    const { dispatcher } = approvalSetup([]);
    const input = new PassThrough();
    const { output, messages } = reading();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output, log: (entry) => logs.push(entry) });
    input.write(`${"{}\n".repeat(200)}${line(initialize(1))}`);
    await until(() => messages().some((message) => !("method" in message) && message.id === 1), "initialize");
    const errors = messages().filter(
      (message) => "error" in message && message.error.code === ErrorCodes.InvalidRequest,
    );
    assert.equal(errors.length, 200);
    assert.ok(!logs.some((entry) => entry.startsWith("stdio: stopped")), logs.join("\n"));
    input.end();
    await within(done, 2000, "the transport");
  });

  test("a client that never reads is cut off once 128 answers wait on the full output", async () => {
    const { dispatcher } = approvalSetup([]);
    const input = new PassThrough();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output: stalled(), log: (entry) => logs.push(entry) });
    input.write("{}\n".repeat(200));
    await within(done, 2000, "the transport");
    assert.ok(logs.includes("stdio: stopped: 128 error responses wait unread"), logs.join("\n"));
  });

  test("a malformed answer to a server request gets no answer, and the request still waits for a good one", async () => {
    const { dispatcher } = approvalSetup([{ content: [callTool("c1", "refund", { id: "o1" })] }, reply("Refunded.")]);
    const input = new PassThrough();
    const { output, messages } = reading();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output, log: (entry) => logs.push(entry) });
    const answer = (id: number) => until(() => messages().some((m) => !("method" in m) && m.id === id), `${id}`);
    input.write(line(initialize(1)));
    await answer(1);
    input.write(line({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/w" } }));
    await answer(2);
    input.write(line({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: [] } }));
    await until(() => messages().some((m) => "method" in m && m.method === "approval/request"), "approval/request");
    const asked = messages().find((m) => "method" in m && m.method === "approval/request") as Extract<
      ServerMessage,
      { method: "approval/request" }
    >;
    input.write(line({ jsonrpc: "2.0", id: asked.id, result: {}, error: { code: 1, message: "both" } }));
    await until(() => logs.some((entry) => entry.startsWith("stdio: ignored a malformed response")), "the log");
    assert.ok(!messages().some((m) => !("method" in m) && m.id === asked.id), "a response was answered");
    const resolution = { requestId: asked.params.request.id, decision: "allow", by: "ada" };
    input.write(line({ jsonrpc: "2.0", id: asked.id, result: { resolutions: [resolution] } }));
    await until(() => settled(messages()) === 2, "the resume's turn/settled");
    input.end();
    await within(done, 2000, "the transport");
  });
});

describe("a server request JSON can't carry", () => {
  test("is answered back into the connection with an error, so the server stops waiting on it", async () => {
    const received: unknown[] = [];
    let send!: (message: ServerMessage) => unknown;
    const dispatcher: Dispatcher = {
      connect(deliver) {
        send = deliver;
        return {
          async receive(message) {
            received.push(message);
          },
          close() {},
        };
      },
      async close() {},
    };
    const input = new PassThrough();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input, output: reading().output, log: (entry) => logs.push(entry) });
    send({
      jsonrpc: "2.0",
      id: "sr-1",
      method: "tool/call",
      params: { session: "s", callId: "c1", tool: "t", input: { big: 1n } },
    });
    await until(() => received.length === 1, "the error answer");
    assert.deepEqual(received, [
      {
        jsonrpc: "2.0",
        id: "sr-1",
        error: { code: ErrorCodes.InternalError, message: "the server could not write this request" },
      },
    ]);
    assert.ok(logs.some((entry) => entry.startsWith("stdio: a server message could not be written")));
    input.end();
    await within(done, 2000, "the transport");
  });
});

describe("waits that end leave nothing behind", () => {
  test("100,000 writes to a full output keep one drain listener and one stopper wait at most", async () => {
    const stopper = new Stopper();
    // The reader reads only while `reading` is on; meanwhile each write waits.
    let reading = false;
    const callbacks: (() => void)[] = [];
    const output = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        if (reading) callback();
        else callbacks.push(callback);
      },
    });
    const writer = lineWriter(output, stopper);
    const bytes = new TextEncoder().encode("{}\n");
    let most = 0;
    for (let i = 0; i < 100_000; i += 1) {
      const waiting = writer.write(bytes);
      most = Math.max(most, output.listenerCount("drain"), stopper.waits);
      if (i % 1000 === 999) {
        // The reader catches up, the output drains, and the wait for room ends.
        reading = true;
        for (const callback of callbacks.splice(0)) callback();
        await waiting;
        reading = false;
      }
    }
    assert.equal(most, 1);
    reading = true;
    for (const callback of callbacks.splice(0)) callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(output.listenerCount("drain"), 0);
    assert.equal(stopper.waits, 0);
    writer.release();
  });

  test("reading 10,000 chunks leaves no stopper wait behind", async () => {
    const stopper = new Stopper();
    const input = new PassThrough();
    const reader = chunkReader(input);
    for (let i = 0; i < 10_000; i += 1) {
      input.write("x");
      await stopper.until(reader.next());
    }
    assert.equal(stopper.waits, 0);
    reader.release();
  });
});

/** A dispatcher whose one connection records what it is told, for the tests that drive `send` by hand. */
function fakeDispatcher(answerMs = 0): {
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
          await new Promise((resolve) => setTimeout(resolve, answerMs));
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

describe("a transport that can't start", () => {
  test("on a closed dispatcher leaves no listener on either Node stream and the input not flowing", async () => {
    const { dispatcher } = approvalSetup([]);
    await dispatcher.close();
    const input = new PassThrough();
    const output = new PassThrough();
    await assert.rejects(stdioTransport(dispatcher, { input, output }), /the dispatcher is closed/);
    for (const event of ["data", "end", "close", "error"]) assert.equal(input.listenerCount(event), 0, event);
    for (const event of ["drain", "close", "error"]) assert.equal(output.listenerCount(event), 0, event);
    assert.notEqual(input.readableFlowing, true);
  });

  test("on a locked Web input releases the output and closes the connection", async () => {
    const { dispatcher, events } = fakeDispatcher();
    const input = new ReadableStream<Uint8Array>();
    input.getReader();
    const output = new WritableStream<Uint8Array>();
    await assert.rejects(stdioTransport(dispatcher, { input, output }));
    assert.equal(output.locked, false);
    assert.deepEqual(events, ["closed"]);
  });
});

describe("a message JSON can't carry, at the end of the input", () => {
  test("a refused server request is failed back into the connection before it closes", async () => {
    // The connection takes 50 ms to handle the answer, so a transport that does not wait closes first.
    const { dispatcher, send, events } = fakeDispatcher(50);
    const input = new PassThrough();
    const done = stdioTransport(dispatcher, { input, output: reading().output });
    send()({
      jsonrpc: "2.0",
      id: "sr-1",
      method: "tool/call",
      params: { session: "s", callId: "c1", tool: "t", input: { big: 1n } },
    });
    input.end();
    await within(done, 2000, "the transport");
    assert.equal(events.length, 2);
    assert.ok(events[0]?.startsWith('received {"jsonrpc":"2.0","id":"sr-1","error"'), String(events[0]));
    assert.equal(events[1], "closed");
  });

  test("a refused response's InternalError waits for room like any line", async () => {
    const { dispatcher, send } = fakeDispatcher();
    const input = new PassThrough();
    const controller = new AbortController();
    const done = stdioTransport(dispatcher, { input, output: stalled() }, { signal: controller.signal });
    const waited = send()({ jsonrpc: "2.0", id: 1, result: { big: 1n } } as unknown as ServerMessage);
    assert.equal(typeof (waited as PromiseLike<void> | undefined)?.then, "function");
    controller.abort();
    await within(done, 2000, "the transport");
  });
});
