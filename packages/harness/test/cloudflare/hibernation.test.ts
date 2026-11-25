// The hibernation bridge in Node, over a fake hibernatable socket whose attachment is a structured clone, as
// Cloudflare's is. "Evicting" here means building a new dispatcher and a new bridge over the same store and socket,
// which is what an object that left memory does when the next frame arrives. The real-socket case is in
// cloudflare.test.ts; these cases check what the bridge keeps, bounds and refuses.
import assert from "node:assert/strict";
import { serialize } from "node:v8";
import { createModel, type Model } from "@buildanagent/gateway";
import { type HibernatableWebSocketLike, webSocketHibernation } from "@buildanagent/harness/cloudflare";
import { createDispatcher, createHarness } from "@buildanagent/harness/server";
import { memoryIndex, memoryStore, type SessionStore } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { type ClientMessage, decode, encode, type ServerMessage } from "@buildanagent/protocol";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { memoryLock } from "../session/memory-backend.js";

class FakeSocket implements HibernatableWebSocketLike {
  readyState = 1;
  attachment: unknown = null;
  readonly received: ServerMessage[] = [];
  readonly closed: (number | undefined)[] = [];
  send(data: string): void {
    this.received.push(decode(data) as ServerMessage);
  }
  close(code?: number): void {
    this.closed.push(code);
    this.readyState = 3;
  }
  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

function objectOver(store: SessionStore, index = memoryIndex(), lock = memoryLock()) {
  const steps = Array.from({ length: 4 }, () => ({ content: [{ type: "text" as const, text: "ok" }] }));
  const model = createModel({ adapter: new ScriptedModel(steps), id: "scripted-model", retries: 0 }) as Model;
  const harness = createHarness({ registry: createToolRegistry(), model, system: "You check the bridge." });
  const dispatcher = createDispatcher({ harness, store, index, lock, userId: "owner" });
  return webSocketHibernation({ dispatcher });
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const ends = Date.now() + 5_000;
  while (!condition()) {
    assert.ok(Date.now() < ends, `timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const frame = (message: ClientMessage) => encode(message).slice(0, -1);
const answerTo = (socket: FakeSocket, id: number) =>
  socket.received.find((message) => "id" in message && message.id === id && !("method" in message)) as
    | { result?: Record<string, unknown>; error?: unknown }
    | undefined;
const settledCount = (socket: FakeSocket) =>
  socket.received.filter((message) => "method" in message && message.method === "turn/settled").length;

async function startedSession(socket: FakeSocket, bridge: ReturnType<typeof objectOver>): Promise<void> {
  bridge.accept(socket);
  const init = { clientInfo: { name: "t", version: "1" }, capabilities: ["session/fork"] };
  await bridge.webSocketMessage(socket, frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: init }));
  await bridge.webSocketMessage(
    socket,
    frame({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/w" } }),
  );
  await until(() => answerTo(socket, 2) !== undefined, "session/create");
  const input = [{ type: "text" as const, text: "hi" }];
  await bridge.webSocketMessage(
    socket,
    frame({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input } }),
  );
  await until(() => settledCount(socket) === 1, "the first turn");
}

describe("webSocketHibernation", () => {
  test("records initialize and the opened session in the attachment, and nothing the client sent beside them", async () => {
    const socket = new FakeSocket();
    await startedSession(socket, objectOver(memoryStore()));
    assert.deepEqual(socket.attachment, {
      v: 1,
      initialize: { clientInfo: { name: "t", version: "1" }, capabilities: ["session/fork"] },
      sessions: [{ session: "s1", cwd: "/w" }],
    });
  });

  test("after an eviction, the next frame runs on a replayed connection that the client never sees", async () => {
    const store = memoryStore();
    const socket = new FakeSocket();
    await startedSession(socket, objectOver(store));
    const evicted = objectOver(store);
    assert.equal(evicted.served(), 0);
    const input = [{ type: "text" as const, text: "again" }];
    await evicted.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 4, method: "turn/start", params: { session: "s1", input } }),
    );
    await until(() => answerTo(socket, 4) !== undefined, "the second turn/start");
    assert.equal(answerTo(socket, 4)?.result?.accepted, true);
    await until(() => settledCount(socket) === 2, "the second turn");
    assert.ok(socket.received.every((message) => !("id" in message) || typeof message.id === "number"));
  });

  test("without the attachment, the same frame after an eviction is refused, so the replay is what carries it", async () => {
    const store = memoryStore();
    const socket = new FakeSocket();
    await startedSession(socket, objectOver(store));
    socket.attachment = null;
    const evicted = objectOver(store);
    const input = [{ type: "text" as const, text: "again" }];
    await evicted.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 4, method: "turn/start", params: { session: "s1", input } }),
    );
    await until(() => answerTo(socket, 4) !== undefined, "the second turn/start");
    assert.equal(answerTo(socket, 4)?.result?.accepted, false);
  });

  test("a session the client forked is still open on its connection after an eviction", async () => {
    const store = memoryStore();
    const socket = new FakeSocket();
    const bridge = objectOver(store);
    await startedSession(socket, bridge);
    await bridge.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 10, method: "session/open", params: { session: "s1", cwd: "/w" } }),
    );
    await until(() => answerTo(socket, 10) !== undefined, "session/open");
    const head = answerTo(socket, 10)?.result?.head as string;
    await bridge.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 11, method: "session/fork", params: { session: "s1", entryId: head } }),
    );
    await until(() => answerTo(socket, 11) !== undefined, "session/fork");
    const forked = answerTo(socket, 11)?.result?.session as string;
    assert.equal(typeof forked, "string");
    const evicted = objectOver(store);
    const input = [{ type: "text" as const, text: "on the fork" }];
    await evicted.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 12, method: "turn/start", params: { session: forked, input } }),
    );
    await until(() => answerTo(socket, 12) !== undefined, "turn/start on the fork");
    assert.equal(answerTo(socket, 12)?.result?.accepted, true);
  });

  test("the attachment keeps only the experimental opt-ins, and its largest form fits in 16,384 bytes", async () => {
    const socket = new FakeSocket();
    const bridge = objectOver(memoryStore());
    bridge.accept(socket);
    const wide = "\u4e00".repeat(512);
    const capabilities = [...Array.from({ length: 40 }, (_, i) => `cap-${i}-${"x".repeat(600)}`), "session/fork"];
    const init = { clientInfo: { name: wide, version: wide }, capabilities };
    await bridge.webSocketMessage(socket, frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: init }));
    await until(() => answerTo(socket, 1) !== undefined, "initialize");
    const attached = socket.attachment as { initialize?: { capabilities: string[] } };
    assert.deepEqual(attached.initialize?.capabilities, ["session/fork"]);
    // The largest state the bounds allow, in the two-byte strings V8 serializes at the most bytes per character.
    const largest = {
      v: 1,
      initialize: { clientInfo: { name: wide, version: wide }, capabilities: ["session/checkout", "session/fork"] },
      sessions: Array.from({ length: 8 }, (_, i) => ({ session: `${i}${"\u4e00".repeat(127)}`, cwd: wide })),
    };
    assert.ok(serialize(largest).length < 16_384, `${serialize(largest).length} bytes`);
  });

  test("a session created but never run is created again after an eviction", async () => {
    const store = memoryStore();
    const socket = new FakeSocket();
    const bridge = objectOver(store);
    bridge.accept(socket);
    await bridge.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 1, method: "session/create", params: { session: "fresh", cwd: "/w" } }),
    );
    await until(() => answerTo(socket, 1) !== undefined, "session/create");
    const evicted = objectOver(store);
    const input = [{ type: "text" as const, text: "first" }];
    await evicted.webSocketMessage(
      socket,
      frame({ jsonrpc: "2.0", id: 2, method: "turn/start", params: { session: "fresh", input } }),
    );
    await until(() => answerTo(socket, 2) !== undefined, "turn/start");
    assert.equal(answerTo(socket, 2)?.result?.accepted, true);
  });

  test("the attachment keeps at most 8 sessions and stays far below 16 KiB, and a foreign one is ignored", async () => {
    const store = memoryStore();
    const socket = new FakeSocket();
    const bridge = objectOver(store);
    bridge.accept(socket);
    for (let i = 0; i < 12; i++) {
      const params = { session: `s${i}`, cwd: `/${"w".repeat(500)}` };
      await bridge.webSocketMessage(socket, frame({ jsonrpc: "2.0", id: i, method: "session/create", params }));
      await until(() => answerTo(socket, i) !== undefined, `session/create ${i}`);
    }
    const kept = (socket.attachment as { sessions: { session: string }[] }).sessions.map((item) => item.session);
    assert.deepEqual(kept, ["s4", "s5", "s6", "s7", "s8", "s9", "s10", "s11"]);
    assert.ok(JSON.stringify(socket.attachment).length < 16_384 / 2);

    const other = new FakeSocket();
    other.attachment = { v: 1, sessions: [{ session: 42, cwd: "/w" }], initialize: { clientInfo: "x" } };
    await objectOver(store).webSocketMessage(
      other,
      frame({ jsonrpc: "2.0", id: 1, method: "session/list", params: {} }),
    );
    await until(() => answerTo(other, 1) !== undefined, "session/list");
    assert.ok(answerTo(other, 1)?.result, "the frame was served despite the attachment");
  });

  test("a peer's close is answered with its code when an application may send it, and with none otherwise", async () => {
    const bridge = objectOver(memoryStore());
    const normal = new FakeSocket();
    bridge.accept(normal);
    await bridge.webSocketClose(normal, 1000);
    const abnormal = new FakeSocket();
    bridge.accept(abnormal);
    await bridge.webSocketClose(abnormal, 1006);
    assert.deepEqual([normal.closed, abnormal.closed], [[1000], [undefined]]);
    assert.equal(bridge.served(), 0);
  });
});
