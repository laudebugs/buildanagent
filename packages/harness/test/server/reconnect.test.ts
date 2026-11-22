// Reconnecting: a pending approval survives a disconnect and is asked again once the new client opens the session,
// the answer resolves exactly once, and session/open with fromSeq replays exactly the entries a client missed, to that
// client only.
import assert from "node:assert/strict";
import { createDispatcher, createHarness, RpcFailure } from "@buildanagent/harness/server";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/session-helpers.js";
import {
  approvalSetup,
  callTool,
  cancelsOf,
  entrySeqs,
  gate,
  init,
  recorded,
  reply,
  requestsOf,
  scripted,
  settledCount,
  settledMessages,
  text,
  until,
} from "./server-helpers.js";

const REFUND = [{ content: [callTool("c1", "refund", { id: "o1" })] }, reply("Refunded.")];

const pendingIdOf = (message: ServerMessage | undefined): string =>
  (message as { params: { request: { id: string } } }).params.request.id;

describe("a pending approval across a reconnect", () => {
  test("survives the disconnect, is listed by initialize and asked again on open, and resolves exactly once", async () => {
    const setup = approvalSetup(REFUND);
    const first = recorded(setup.dispatcher);
    await init(first.client);
    const { session } = await first.client.request("session/create", { cwd: "/work" });
    await first.client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(first.seen) === 1, "the pause");
    const [asked] = requestsOf(first.seen, "approval/request");
    assert.ok(asked !== undefined);
    first.client.close();

    const second = recorded(setup.dispatcher);
    const joined = await init(second.client);
    assert.deepEqual(
      joined.pending.map((item) => [item.session, item.request.id]),
      [[session, pendingIdOf(asked)]],
    );
    // Nothing is asked before the client opens the session: initialize alone grants no access to it.
    assert.deepEqual(requestsOf(second.seen), []);
    await second.client.request("session/open", { session, cwd: "/work" });
    await until(() => requestsOf(second.seen).length === 1, "the request to be asked again");
    const [again] = requestsOf(second.seen, "approval/request");
    assert.ok(again !== undefined);
    assert.equal(pendingIdOf(again), pendingIdOf(asked));
    assert.notEqual(again.id, asked.id);
    // The id the closed client held is stale: an answer to it does nothing.
    second.client.respond<"approval/request">(asked.id, {
      resolutions: [{ requestId: pendingIdOf(asked), decision: "deny" }],
    });
    second.client.respond<"approval/request">(again.id, {
      resolutions: [{ requestId: pendingIdOf(again), decision: "allow" }],
    });
    second.client.respond<"approval/request">(again.id, {
      resolutions: [{ requestId: pendingIdOf(again), decision: "allow" }],
    });
    await until(() => settledCount(second.seen) === 1, "the resume");
    assert.equal(settledMessages(second.seen)[0]?.result.stopReason, "done");
    assert.equal(setup.resolved.length, 1);
    assert.equal((setup.resolved[0] as { decision: string }[])[0]?.decision, "allow");
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
    assert.deepEqual((await init(second.client)).pending, []);
  });

  test("a client that dropped without closing has its request withdrawn when the new client answers", async () => {
    const setup = approvalSetup(REFUND);
    const stale = recorded(setup.dispatcher);
    await init(stale.client);
    const { session } = await stale.client.request("session/create", { cwd: "/work" });
    await stale.client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(stale.seen) === 1, "the pause");
    const [old] = requestsOf(stale.seen);
    const fresh = recorded(setup.dispatcher);
    await init(fresh.client);
    await fresh.client.request("session/open", { session, cwd: "/work" });
    await until(() => requestsOf(fresh.seen).length === 1, "the request");
    const [current] = requestsOf(fresh.seen);
    assert.ok(old !== undefined && current !== undefined);
    fresh.client.respond<"approval/request">(current.id, {
      resolutions: [{ requestId: pendingIdOf(current), decision: "allow" }],
    });
    assert.deepEqual(cancelsOf(stale.seen), [old.id]);
    stale.client.respond<"approval/request">(old.id, {
      resolutions: [{ requestId: pendingIdOf(old), decision: "deny" }],
    });
    await until(() => settledCount(fresh.seen) === 1, "the resume");
    assert.equal(setup.resolved.length, 1);
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
  });

  test("a second process resumes a request the first asked about, and the first's answer then finds nothing waiting", async () => {
    const backend = memoryBackend();
    const one = approvalSetup(REFUND, [], {}, backend);
    const two = approvalSetup(REFUND.slice(1), [], {}, backend);
    const a = recorded(one.dispatcher);
    await init(a.client);
    const { session } = await a.client.request("session/create", { cwd: "/work" });
    await a.client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(a.seen) === 1, "the pause");
    const [askedByOne] = requestsOf(a.seen);
    const b = recorded(two.dispatcher);
    await init(b.client);
    await b.client.request("session/open", { session, cwd: "/work" });
    await until(() => requestsOf(b.seen).length === 1, "the request in the second process");
    const [askedByTwo] = requestsOf(b.seen);
    assert.ok(askedByOne !== undefined && askedByTwo !== undefined);
    b.client.respond<"approval/request">(askedByTwo.id, {
      resolutions: [{ requestId: pendingIdOf(askedByTwo), decision: "allow" }],
    });
    await until(() => settledCount(b.seen) === 1, "the second process's resume");
    a.client.respond<"approval/request">(askedByOne.id, {
      resolutions: [{ requestId: pendingIdOf(askedByOne), decision: "allow" }],
    });
    // The first process takes the lock, finds the request no longer waiting, and runs nothing.
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settledCount(a.seen), 1);
    assert.equal(two.resolved.length, 1);
    assert.equal(one.resolved.length, 0);
    assert.equal(one.refunds.length + two.refunds.length, 1);
  });
});

/** A tool that waits for the test's gate, so a turn is still writing while another client opens the session. */
function heldTool(held: Promise<void>): ToolDefinition<unknown, unknown, unknown> {
  return defineTool({
    name: "wait",
    description: "Waits.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async execute() {
      await held;
      return { content: [{ type: "text", text: "waited" }] };
    },
  }) as ToolDefinition<unknown, unknown, unknown>;
}

function plainSetup(steps: Parameters<typeof scripted>[0], tools: ToolDefinition<unknown, unknown, unknown>[] = []) {
  const registry = createToolRegistry();
  for (const definition of tools) registry.register({ name: definition.name, source: "builtin", definition });
  const harness = createHarness({ registry, model: scripted(steps), system: "s" });
  const backend = memoryBackend();
  return { backend, dispatcher: createDispatcher({ harness, ...backend, userId: "ada" }), harness };
}

describe("session/open with fromSeq", () => {
  test("replays exactly the entries a client missed, in order, and then the live ones", async () => {
    const { dispatcher } = plainSetup([reply("One."), reply("Two.")]);
    const writer = recorded(dispatcher);
    await init(writer.client);
    const { session } = await writer.client.request("session/create", { cwd: "/work" });
    const reader = recorded(dispatcher);
    await reader.client.request("session/open", { session, cwd: "/work" });
    await writer.client.request("turn/start", { session, input: text("a") });
    await until(() => settledCount(reader.seen) === 1, "the first turn");
    const had = entrySeqs(reader.seen);
    reader.client.close();
    await writer.client.request("turn/start", { session, input: text("b") });
    await until(() => settledCount(writer.seen) === 2, "the second turn");
    const back = recorded(dispatcher);
    const fromSeq = (had.at(-1) as number) + 1;
    await back.client.request("session/open", { session, cwd: "/work", fromSeq });
    await until(() => entrySeqs(back.seen).length > 0, "the replay");
    assert.deepEqual(
      entrySeqs(back.seen),
      entrySeqs(writer.seen).filter((seq) => seq >= fromSeq),
    );
    // No entry the client already had comes back, and together they cover the log with no gap.
    assert.deepEqual([...had, ...entrySeqs(back.seen)], entrySeqs(writer.seen));
  });

  test("replays and then streams with no entry missing or repeated while a turn is still writing", async () => {
    const held = gate();
    const { dispatcher } = plainSetup(
      [{ content: [callTool("c1", "wait", { id: "x" })] }, reply("Done.")],
      [heldTool(held.promise)],
    );
    const writer = recorded(dispatcher);
    await init(writer.client);
    const { session } = await writer.client.request("session/create", { cwd: "/work" });
    await writer.client.request("turn/start", { session, input: text("go") });
    await until(
      () => writer.seen.some((m) => "method" in m && m.method === "event" && m.params.event.type === "tool_call_start"),
      "the tool to start",
    );
    // A raw connection sees the response and the events in the order the server sent them.
    const wire: ServerMessage[] = [];
    const joiner = dispatcher.connect((message) => {
      wire.push(message);
    });
    const opened = joiner.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "session/open",
      params: { session, cwd: "/work", fromSeq: 0 },
    });
    // The turn writes its remaining entries while the open is in flight.
    held.open();
    await opened;
    await until(() => settledCount(writer.seen) === 1 && settledCount(wire) === 1, "the turn");
    const seqs = entrySeqs(wire);
    assert.deepEqual(seqs, entrySeqs(writer.seen));
    assert.deepEqual(
      seqs,
      seqs.map((_, index) => index),
    );
    assert.ok(!("method" in (wire[0] as ServerMessage)), "the open's response comes before any event");
  });

  test("entries written after the replay's read and before the open's response arrive once, after the replay", async () => {
    const backend = memoryBackend();
    const held = gate();
    let snapshotTaken!: () => void;
    const snapshot = new Promise<void>((resolve) => {
      snapshotTaken = resolve;
    });
    // The replay's read takes its entries at once and then waits, as a slow disk would, so entries written meanwhile
    // reach the opening client only through the events held for it.
    const store = {
      ...backend.store,
      load(key: Parameters<typeof backend.store.load>[0], options?: Parameters<typeof backend.store.load>[1]) {
        if (options?.fromSeq !== 1) return backend.store.load(key, options);
        return (async function* () {
          const entries = [];
          for await (const entry of backend.store.load(key, options)) entries.push(entry);
          snapshotTaken();
          await held.promise;
          yield* entries;
        })();
      },
    };
    const harness = createHarness({
      registry: createToolRegistry(),
      model: scripted([reply("One."), reply("Two.")]),
      system: "s",
    });
    const dispatcher = createDispatcher({ harness, ...backend, store, userId: "ada" });
    const writer = recorded(dispatcher);
    await init(writer.client);
    const { session } = await writer.client.request("session/create", { cwd: "/work" });
    await writer.client.request("turn/start", { session, input: text("a") });
    await until(() => settledCount(writer.seen) === 1, "the first turn");
    const joiner = recorded(dispatcher);
    const opened = joiner.client.request("session/open", { session, cwd: "/work", fromSeq: 2 });
    await snapshot;
    await writer.client.request("turn/start", { session, input: text("b") });
    await until(() => settledCount(writer.seen) === 2, "the second turn");
    held.open();
    await opened;
    // The second turn's turn/settled was held too, so it comes after its entries.
    await until(() => settledCount(joiner.seen) === 1, "the held turn/settled");
    assert.deepEqual(
      entrySeqs(joiner.seen),
      entrySeqs(writer.seen).filter((seq) => seq >= 2),
    );
    const last = joiner.seen.at(-1);
    assert.ok(last !== undefined && "method" in last && last.method === "turn/settled");
  });

  test("a fromSeq one past the last entry replays nothing, 0 replays the file, and one further or negative is refused", async () => {
    const { dispatcher } = plainSetup([reply("One.")]);
    const writer = recorded(dispatcher);
    await init(writer.client);
    const { session } = await writer.client.request("session/create", { cwd: "/work" });
    const reader = recorded(dispatcher);
    // A session with no file yet replays nothing from 0 and refuses anything later.
    await reader.client.request("session/open", { session, cwd: "/work", fromSeq: 0 });
    await assert.rejects(
      reader.client.request("session/open", { session, cwd: "/work", fromSeq: 1 }),
      (error: unknown) => error instanceof RpcFailure && error.rpc.code === ErrorCodes.InvalidParams,
    );
    await writer.client.request("turn/start", { session, input: text("a") });
    await until(() => settledCount(writer.seen) === 1, "the turn");
    const all = entrySeqs(writer.seen);
    const last = all.at(-1) as number;
    const caughtUp = recorded(dispatcher);
    await caughtUp.client.request("session/open", { session, cwd: "/work", fromSeq: last + 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(entrySeqs(caughtUp.seen), []);
    const whole = recorded(dispatcher);
    await whole.client.request("session/open", { session, cwd: "/work", fromSeq: 0 });
    await until(() => entrySeqs(whole.seen).length === all.length, "the whole file");
    assert.deepEqual(entrySeqs(whole.seen), all);
    for (const fromSeq of [last + 2, -1, 0.5]) {
      await assert.rejects(
        recorded(dispatcher).client.request("session/open", { session, cwd: "/work", fromSeq }),
        (error: unknown) => error instanceof RpcFailure && error.rpc.code === ErrorCodes.InvalidParams,
        String(fromSeq),
      );
    }
  });

  test("replays only to the client that opened the session, and never across users", async () => {
    const backend = memoryBackend();
    const harness = createHarness({ registry: createToolRegistry(), model: scripted([reply("One.")]), system: "s" });
    const ada = createDispatcher({ harness, ...backend, userId: "ada" });
    const bob = createDispatcher({ harness, ...backend, userId: "bob" });
    const writer = recorded(ada);
    // A client connected to the same dispatcher, and to the same user, that never opens the session.
    const bystander = recorded(ada);
    await init(writer.client);
    await init(bystander.client);
    const { session } = await writer.client.request("session/create", { cwd: "/work" });
    await writer.client.request("turn/start", { session, input: text("a") });
    await until(() => settledCount(writer.seen) === 1, "the turn");
    const opener = recorded(ada);
    await opener.client.request("session/open", { session, cwd: "/work", fromSeq: 0 });
    await until(() => entrySeqs(opener.seen).length > 0, "the replay");
    assert.deepEqual(bystander.seen, []);
    const other = recorded(bob);
    await assert.rejects(
      other.client.request("session/open", { session, cwd: "/work", fromSeq: 0 }),
      (error: unknown) => error instanceof RpcFailure && error.rpc.code === ErrorCodes.InvalidParams,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(other.seen, []);
  });

  test("a second dispatcher over the same store replays what the first wrote, because the log is the window", async () => {
    const backend = memoryBackend();
    const harness = createHarness({ registry: createToolRegistry(), model: scripted([reply("One.")]), system: "s" });
    const first = recorded(createDispatcher({ harness, ...backend, userId: "ada" }));
    await init(first.client);
    const { session } = await first.client.request("session/create", { cwd: "/work" });
    await first.client.request("turn/start", { session, input: text("a") });
    await until(() => settledCount(first.seen) === 1, "the turn");
    const later = recorded(createDispatcher({ harness, ...backend, userId: "ada" }));
    await later.client.request("session/open", { session, cwd: "/work", fromSeq: 2 });
    await until(() => entrySeqs(later.seen).length > 0, "the replay");
    assert.deepEqual(
      entrySeqs(later.seen),
      entrySeqs(first.seen).filter((seq) => seq >= 2),
    );
  });
});
