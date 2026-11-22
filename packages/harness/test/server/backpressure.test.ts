// Bounded queues: a connection holds at most 128 unanswered commands and refuses the next with QueueFull, and a slow
// client loses events, which an events_dropped marker stands in for, but never a server request or a turn/settled.
import assert from "node:assert/strict";
import { createDispatcher, createHarness } from "@buildanagent/harness/server";
import type { SessionStore } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/session-helpers.js";
import {
  approvalSetup,
  callTool,
  entrySeqs,
  gate,
  init,
  recorded,
  reply,
  requestsOf,
  scripted,
  settledCount,
  text,
  until,
} from "./server-helpers.js";

/** A store whose `list()` waits for the gate, so every `session/list` stays unanswered until the test opens it. */
function blockingList(store: SessionStore, held: Promise<void>): SessionStore {
  return {
    ...store,
    async *list(userId) {
      await held;
      yield* store.list(userId);
    },
  };
}

type Response = Extract<ServerMessage, { id: unknown; error: unknown }> | Extract<ServerMessage, { result: unknown }>;

const responses = (wire: readonly ServerMessage[]) => wire.filter((m): m is Response => !("method" in m));
const isQueueFull = (message: Response) => "error" in message && message.error.code === ErrorCodes.QueueFull;

function dispatcherWith(store: SessionStore, queueSize?: number) {
  const harness = createHarness({ registry: createToolRegistry(), model: scripted([]), system: "s" });
  const backend = memoryBackend();
  return createDispatcher({
    harness,
    ...backend,
    store,
    userId: "ada",
    ...(queueSize === undefined ? {} : { queueSize }),
  });
}

describe("the command queue", () => {
  test("128 unanswered commands fill it, the 129th gets QueueFull, and a refused command takes no place", async () => {
    const held = gate();
    const dispatcher = dispatcherWith(blockingList(memoryBackend().store, held.promise));
    const wire: ServerMessage[] = [];
    const connection = dispatcher.connect((message) => {
      wire.push(message);
    });
    const list = (id: number) => connection.receive({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    const sent = Array.from({ length: 128 }, (_, i) => list(i + 1));
    assert.deepEqual(wire, []);
    await list(129);
    await list(130);
    assert.deepEqual(
      responses(wire).map((message) => [message.id, isQueueFull(message)]),
      [
        [129, true],
        [130, true],
      ],
    );
    held.open();
    await Promise.all(sent);
    const answered = responses(wire).filter((message) => !isQueueFull(message));
    assert.equal(answered.length, 128);
    assert.ok(answered.every((message) => "result" in message));
    // Every place is free again: the next command is taken.
    await list(131);
    assert.ok("result" in (responses(wire).at(-1) as Response));
  });

  test("a command keeps its place until its response has gone out, so a client that doesn't read is refused", async () => {
    const dispatcher = dispatcherWith(memoryBackend().store, 4);
    const delivered: ServerMessage[] = [];
    const held = gate();
    // The first message the client is sent doesn't finish going out until the test lets it, so nothing after it does.
    const connection = dispatcher.connect((message) => {
      delivered.push(message);
      return delivered.length === 1 ? held.promise : undefined;
    });
    for (let id = 1; id <= 5; id++) {
      await connection.receive({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    }
    assert.equal(delivered.length, 1);
    held.open();
    await until(() => delivered.length === 5, "the responses");
    assert.deepEqual(
      responses(delivered).map((message) => [message.id, isQueueFull(message)]),
      [
        [1, false],
        [2, false],
        [3, false],
        [4, false],
        [5, true],
      ],
    );
  });

  test("a refused command takes no place, so the queue is whole again once its commands are answered", async () => {
    const held = gate();
    const dispatcher = dispatcherWith(blockingList(memoryBackend().store, held.promise), 2);
    const wire: ServerMessage[] = [];
    const connection = dispatcher.connect((message) => {
      wire.push(message);
    });
    const list = (id: number) => connection.receive({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    const sent = [list(1), list(2)];
    for (let id = 3; id <= 6; id++) await list(id);
    held.open();
    await Promise.all(sent);
    const next = [list(7), list(8)];
    await Promise.all(next);
    assert.deepEqual(
      responses(wire).map((message) => [message.id, isQueueFull(message)]),
      [
        [3, true],
        [4, true],
        [5, true],
        [6, true],
        [1, false],
        [2, false],
        [7, false],
        [8, false],
      ],
    );
  });

  test("a client that writes 10,000 commands and reads nothing is closed, so the queue stays bounded", async () => {
    const dispatcher = dispatcherWith(memoryBackend().store, 4);
    const delivered: ServerMessage[] = [];
    const held = gate();
    const connection = dispatcher.connect((message) => {
      delivered.push(message);
      return delivered.length === 1 ? held.promise : undefined;
    });
    for (let id = 1; id <= 10_000; id++) {
      await connection.receive({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    }
    held.open();
    await new Promise((resolve) => setImmediate(resolve));
    // Closing dropped what waited: the first message is all the client ever got.
    assert.equal(delivered.length, 1);
  });

  test("a client that reads keeps its connection however many commands the full queue refuses", async () => {
    const held = gate();
    const dispatcher = dispatcherWith(blockingList(memoryBackend().store, held.promise));
    const wire: ServerMessage[] = [];
    const connection = dispatcher.connect((message) => {
      wire.push(message);
    });
    const list = (id: number) => connection.receive({ jsonrpc: "2.0", id, method: "session/list", params: {} });
    const sent = Array.from({ length: 128 }, (_, i) => list(i + 1));
    for (let id = 129; id <= 10_000; id++) await list(id);
    assert.equal(responses(wire).filter(isQueueFull).length, 10_000 - 128);
    held.open();
    await Promise.all(sent);
    await list(10_001);
    assert.ok("result" in (responses(wire).at(-1) as Response));
  });

  test("a queue size that is not a whole number of at least 1 is refused", () => {
    for (const queueSize of [0, -1, 1.5]) {
      assert.throws(
        () => dispatcherWith(memoryBackend().store, queueSize),
        (error: unknown) => (error as { code?: string }).code === "invalid_dispatcher_options",
      );
    }
  });
});

/** Ten refunds in one step, each of which asks a person, after a long streamed reply. */
const FLOOD = [
  {
    content: [
      { type: "text" as const, text: "x".repeat(300) },
      ...Array.from({ length: 10 }, (_, i) => callTool(`c${i}`, "refund", { id: `o${i}` })),
    ],
  },
];

describe("a slow client under a flood of events", () => {
  test("loses events, each loss marked, but no server request and no turn/settled (asserted by count)", async () => {
    const setup = approvalSetup(FLOOD, [], { queueSize: 8 });
    // A reference client takes every message at once, so it sees what the server sent.
    const reference = recorded(setup.dispatcher);
    await init(reference.client);
    const { session } = await reference.client.request("session/create", { cwd: "/work" });
    // The slow client takes its first message, then waits until the test lets it go.
    const held = gate();
    const slow: ServerMessage[] = [];
    let first = true;
    const connection = setup.dispatcher.connect((message) => {
      slow.push(message);
      if (!first) return undefined;
      first = false;
      return held.promise;
    });
    await connection.receive({ jsonrpc: "2.0", id: 1, method: "session/open", params: { session, cwd: "/work" } });
    await reference.client.request("turn/start", { session, input: text("Refund all ten") });
    await until(() => settledCount(reference.seen) === 1, "the turn");
    held.open();
    await until(() => settledCount(slow) === 1, "the slow client's turn/settled");
    await new Promise((resolve) => setImmediate(resolve));

    const events = (wire: readonly ServerMessage[]) =>
      wire.filter((m) => "method" in m && m.method === "event" && m.params.event.type !== "events_dropped");
    const markers = slow.flatMap((m) =>
      "method" in m && m.method === "event" && m.params.event.type === "events_dropped"
        ? [{ seq: m.params.seq, count: m.params.event.count }]
        : [],
    );
    const sent = events(reference.seen).length;
    assert.ok(sent > 100, `the flood sent ${sent} events`);
    assert.ok(markers.length > 0, "some events were dropped");
    // Every event the server sent either reached the slow client or is counted by a marker.
    assert.equal(events(slow).length + markers.reduce((sum, marker) => sum + marker.count, 0), sent);
    assert.equal(requestsOf(reference.seen, "approval/request").length, 10);
    assert.equal(requestsOf(slow, "approval/request").length, 10);
    assert.equal(settledCount(slow), 1);
    connection.close();
  });

  test("a client that was told of a gap gets every missed entry back by opening the session from the last seq it had", async () => {
    const setup = approvalSetup(FLOOD, [], { queueSize: 4 });
    const reference = recorded(setup.dispatcher);
    await init(reference.client);
    const { session } = await reference.client.request("session/create", { cwd: "/work" });
    const held = gate();
    const slow: ServerMessage[] = [];
    let first = true;
    const connection = setup.dispatcher.connect((message) => {
      slow.push(message);
      if (!first) return undefined;
      first = false;
      return held.promise;
    });
    await connection.receive({ jsonrpc: "2.0", id: 1, method: "session/open", params: { session, cwd: "/work" } });
    await reference.client.request("turn/start", { session, input: text("Refund all ten") });
    await until(() => settledCount(reference.seen) === 1, "the turn");
    held.open();
    await until(() => settledCount(slow) === 1, "the slow client's turn/settled");
    const had = entrySeqs(slow);
    assert.ok(had.length < entrySeqs(reference.seen).length, "the slow client missed entries");
    // Recover from just after the first gap: everything from there on comes back, in order.
    const firstMissing = entrySeqs(reference.seen).find((seq) => !had.includes(seq)) as number;
    const before = slow.length;
    await connection.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "session/open",
      params: { session, cwd: "/work", fromSeq: firstMissing },
    });
    await until(() => entrySeqs(slow.slice(before)).length > 0, "the replay");
    const replayed = entrySeqs(slow.slice(before));
    assert.deepEqual(
      replayed,
      entrySeqs(reference.seen).filter((seq) => seq >= firstMissing),
    );
    connection.close();
  });

  test("with a client that takes each message at once, nothing is dropped", async () => {
    const setup = approvalSetup([reply("y".repeat(400))], [], { queueSize: 1 });
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Hi") });
    await until(() => settledCount(seen) === 1, "the turn");
    assert.equal(
      seen.some((m) => "method" in m && m.method === "event" && m.params.event.type === "events_dropped"),
      false,
    );
  });
});
