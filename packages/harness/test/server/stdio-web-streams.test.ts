// The stdio transport over a Web `ReadableStream` and `WritableStream` pair, as a Worker or a browser would hand it:
// a full turn read by both JSON-RPC libraries of framing-interop.test.ts (HD6's framing check), backpressure from an
// output that stops taking lines, the end of the input, and the write timeout. Everything runs in this process.
import assert from "node:assert/strict";
import { type Dispatcher, stdioTransport } from "@buildanagent/harness/server";
import type { SessionStore } from "@buildanagent/harness/session";
import { decode, type ServerMessage } from "@buildanagent/protocol";
import { type JSONRPCMessage, ReadBuffer, serializeMessage } from "@modelcontextprotocol/client";
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { describe, test, vi } from "vitest";
import { memoryBackend } from "../session/memory-backend.js";
import { approvalSetup, callTool, gate, init, recorded, reply, settledCount, until } from "./server-helpers.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const initParams = { clientInfo: { name: "web", version: "0" }, capabilities: [] };

/** A Web stream pair the test drives: an input it writes to and an output it reads, or stops reading. */
class WebPair {
  readonly input: ReadableStream<Uint8Array>;
  readonly output: WritableStream<Uint8Array>;
  /** Every complete line the output has taken. */
  readonly lines: string[] = [];
  #controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly #listeners: ((chunk: Uint8Array) => void)[] = [];
  #partial = "";
  #taken = 0;
  #reading = true;
  #resume: (() => void) | undefined;

  /** `highWaterMark` is how many chunks the output's own queue holds before it reports itself full. */
  constructor(highWaterMark = 1) {
    this.input = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.output = new WritableStream<Uint8Array>(
      {
        write: async (chunk) => {
          while (!this.#reading) await new Promise<void>((resolve) => (this.#resume = resolve));
          this.#take(chunk);
        },
      },
      new CountQueuingStrategy({ highWaterMark }),
    );
  }

  /** Sends text to the transport as one chunk. */
  write(text: string): void {
    this.#controller.enqueue(encoder.encode(text));
  }

  /** Ends the input. */
  end(): void {
    this.#controller.close();
  }

  /** Calls `listener` with each chunk the output takes. */
  onChunk(listener: (chunk: Uint8Array) => void): void {
    this.#listeners.push(listener);
  }

  /** How many chunks the output has taken. */
  get taken(): number {
    return this.#taken;
  }

  /** While false, the output takes nothing, and what is written waits in the stream's own queue. */
  set reading(on: boolean) {
    this.#reading = on;
    if (on) this.#resume?.();
  }

  #take(chunk: Uint8Array): void {
    this.#taken += 1;
    this.#partial += decoder.decode(chunk, { stream: true });
    const parts = this.#partial.split("\n");
    this.#partial = parts.pop() ?? "";
    this.lines.push(...parts);
    for (const listener of this.#listeners) listener(chunk);
  }
}

const messagesOf = (pair: WebPair) => pair.lines.map((line) => decode(line) as unknown as ServerMessage);
const responseTo = (pair: WebPair, id: number) =>
  messagesOf(pair).find((message) => !("method" in message) && message.id === id);

interface ApprovalParams {
  readonly request: { readonly id: string };
}
const allow = (params: ApprovalParams) => ({
  resolutions: [{ requestId: params.request.id, decision: "allow", by: "ada" }],
});
const REFUND = [{ content: [callTool("c1", "refund", { id: "o1" })] }, reply("Refunded.")];
const turnInput = [{ type: "text", text: "refund o1" }];

describe("a full turn over Web streams", () => {
  test("json-rpc-2.0 reads every line of a turn that asks for approval, and answers the server's request", async () => {
    const { dispatcher, refunds } = approvalSetup(REFUND);
    const pair = new WebPair();
    const logs: string[] = [];
    const done = stdioTransport(dispatcher, { input: pair.input, output: pair.output, log: (line) => logs.push(line) });
    const invalid: unknown[] = [];
    const received: string[] = [];
    const peer = new JSONRPCServerAndClient(
      new JSONRPCServer({ errorListener: (message, data) => invalid.push([message, data]) }),
      new JSONRPCClient((request) => pair.write(`${JSON.stringify(request)}\n`)),
      { errorListener: (message, data) => invalid.push([message, data]) },
    );
    for (const method of ["event", "turn/settled", "$/cancelRequest"]) {
      peer.addMethod(method, () => {
        received.push(method);
      });
    }
    peer.addMethod("approval/request", (params) => {
      received.push("approval/request");
      return allow(params as unknown as ApprovalParams);
    });
    let at = 0;
    const failures: unknown[] = [];
    pair.onChunk(() => {
      for (; at < pair.lines.length; at += 1) {
        peer.receiveAndSend(JSON.parse(pair.lines[at] as string), undefined, undefined).catch((error: unknown) => {
          failures.push(error);
        });
      }
    });
    const result = await peer.request("initialize", initParams, undefined);
    assert.equal(result.serverInfo.specVersion, "v1");
    await peer.request("session/create", { session: "s1", cwd: "/work" }, undefined);
    assert.equal((await peer.request("turn/start", { session: "s1", input: turnInput }, undefined)).accepted, true);
    await until(() => received.filter((method) => method === "turn/settled").length === 2, "two turn/settled");
    assert.deepEqual(failures, []);
    assert.deepEqual(invalid, []);
    assert.deepEqual(refunds, [{ id: "o1" }]);
    assert.ok(received.filter((method) => method === "event").length > 10);
    pair.end();
    await done;
    assert.deepEqual(logs, []);
  });

  test("MCP's ReadBuffer reads every line of the same turn against MCP's strict schema", async () => {
    const { dispatcher } = approvalSetup(REFUND);
    const pair = new WebPair();
    const done = stdioTransport(dispatcher, { input: pair.input, output: pair.output });
    const buffer = new ReadBuffer();
    const messages: JSONRPCMessage[] = [];
    const failures: unknown[] = [];
    const send = (message: JSONRPCMessage) => pair.write(serializeMessage(message));
    pair.onChunk((chunk) => {
      buffer.append(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      try {
        for (let message = buffer.readMessage(); message !== null; message = buffer.readMessage()) {
          messages.push(message);
          if ("method" in message && "id" in message && message.method === "approval/request") {
            send({ jsonrpc: "2.0", id: message.id, result: allow(message.params as unknown as ApprovalParams) });
          }
        }
      } catch (error) {
        failures.push(error);
      }
    });
    const methods = () => messages.flatMap((message) => ("method" in message ? [message.method] : []));
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams });
    await until(() => responseTo(pair, 1) !== undefined, "the response to 1");
    send({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/work" } });
    await until(() => responseTo(pair, 2) !== undefined, "the response to 2");
    send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: turnInput } });
    await until(() => methods().filter((method) => method === "turn/settled").length === 2, "two turn/settled");
    assert.deepEqual(failures, []);
    // ReadBuffer skips a line that is not JSON without a word, so the count shows it skipped none.
    assert.equal(messages.length, pair.lines.length);
    assert.equal(methods().filter((method) => method === "approval/request").length, 1);
    pair.end();
    await done;
  });
});

describe("backpressure over a Web output", () => {
  test("an output that stops taking lines keeps the backlog to the connection's queue, and events are dropped", async () => {
    const steps = [{ content: [{ type: "text" as const, text: "x".repeat(20_000) }] }];
    const { dispatcher } = approvalSetup(steps, [], { queueSize: 16 });
    const pair = new WebPair(4);
    const done = stdioTransport(dispatcher, { input: pair.input, output: pair.output });
    pair.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams })}\n`);
    pair.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/w" } })}\n`,
    );
    await until(() => responseTo(pair, 2) !== undefined, "session/create");
    const watcher = recorded(dispatcher);
    await init(watcher.client);
    await watcher.client.request("session/open", { session: "s1", cwd: "/w" });
    pair.reading = false;
    const before = pair.taken;
    pair.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: [] } })}\n`,
    );
    // The turn streams 5,000 deltas while the output takes nothing.
    await until(() => settledCount(watcher.seen) === 1, "the watcher's turn/settled");
    watcher.client.close();
    assert.ok(pair.taken <= before + 1, `taken ${pair.taken - before}`);
    pair.reading = true;
    await until(() => messagesOf(pair).some((m) => "method" in m && m.method === "turn/settled"), "turn/settled");
    const events = messagesOf(pair).filter((m) => "method" in m && m.method === "event");
    const dropped = events.some(
      (m) => "params" in m && (m.params as { event: { type: string } }).event.type === "events_dropped",
    );
    assert.ok(dropped, "no events_dropped marker");
    // What waited was the stream's own queue, its sink's one chunk and the connection's queue of 16, plus the markers.
    const delivered = pair.lines.length;
    assert.ok(delivered < 100, `delivered ${delivered} lines for 5,000 deltas`);
    pair.end();
    await done;
  });
});

describe("the end of a Web input", () => {
  test("answers every command read before the end, then resolves, leaving both streams unlocked and open", async () => {
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
    const pair = new WebPair();
    let finished = false;
    const done = stdioTransport(dispatcher, { input: pair.input, output: pair.output }).then(() => {
      finished = true;
    });
    pair.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session/list", params: {} })}\n`);
    pair.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/list", params: {} }));
    pair.end();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    held.open();
    await done;
    assert.ok(responseTo(pair, 1) !== undefined && "result" in (responseTo(pair, 1) as object));
    // The last line had no newline, so the end of the input cut it: it is answered with a parse error.
    const errors = messagesOf(pair).filter((m) => "error" in m) as { id: unknown; error: { code: number } }[];
    assert.deepEqual(
      errors.map((m) => [m.id, m.error.code]),
      [[null, -32700]],
    );
    assert.equal(pair.input.locked, false);
    assert.equal(pair.output.locked, false);
    const writer = pair.output.getWriter();
    await writer.write(encoder.encode("still open\n"));
    assert.equal(pair.lines.at(-1), "still open");
  });
});

/** A dispatcher whose one connection lets the test send by hand. */
function handDispatcher(): { dispatcher: Dispatcher; send: () => (message: ServerMessage) => unknown } {
  let deliver: ((message: ServerMessage) => unknown) | undefined;
  return {
    dispatcher: {
      connect(send) {
        deliver = send;
        return { async receive() {}, close() {} };
      },
      async close() {},
    },
    send: () => deliver as (message: ServerMessage) => unknown,
  };
}

describe("the write timeout over Web streams", () => {
  test("stops once a Web output takes no line for 30 seconds after the input ended, with no timer left", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const hand = handDispatcher();
      const pair = new WebPair();
      pair.reading = false;
      const logs: string[] = [];
      let finished = false;
      const done = stdioTransport(hand.dispatcher, {
        input: pair.input,
        output: pair.output,
        log: (line) => logs.push(line),
      }).then(() => {
        finished = true;
      });
      for (let id = 1; id <= 3; id += 1) hand.send()({ jsonrpc: "2.0", id, result: {} } as unknown as ServerMessage);
      pair.end();
      await until(() => vi.getTimerCount() === 1, "the write timeout");
      await vi.advanceTimersByTimeAsync(29_999);
      assert.equal(finished, false);
      await vi.advanceTimersByTimeAsync(1);
      await done;
      assert.deepEqual(
        logs.filter((line) => line.startsWith("stdio: stopped")),
        ["stdio: stopped: the output took no line for 30000 ms after the input ended"],
      );
      assert.equal(vi.getTimerCount(), 0);
      assert.equal(pair.output.locked, false);
    } finally {
      vi.useRealTimers();
    }
  });
});
