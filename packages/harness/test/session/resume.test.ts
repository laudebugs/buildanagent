// Resuming after a crash: a call with no result is settled by what it could have done, and a repeated write is
// recognised by its effect key.
import assert from "node:assert/strict";
import { guardedWrite, memoryEffectStore, renderOutcome, writeOutcome } from "@buildanagent/agent-safety";
import { createModel, type Model } from "@buildanagent/gateway";
import { createHarness } from "@buildanagent/harness/server";
import {
  type EntryInput,
  effectScope,
  openSession,
  rerunFrom,
  runTurn,
  type SessionEntry,
} from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { BACKENDS, type Backend, KEY } from "./session-helpers.js";

const entriesOf = async (backend: Backend) => {
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) found.push(entry);
  return found;
};

/** Writes the entries before the first tool_result into `backend`, as a log that a crash cut short. */
async function crashedLog(
  source: Backend,
  target: Backend,
  cutAt: (entry: SessionEntry) => boolean = (entry) => entry.type === "tool_result",
): Promise<void> {
  const all = await entriesOf(source);
  const cut = all.findIndex(cutAt);
  const kept = all.slice(0, cut).map(({ seq: _seq, ...rest }) => rest as EntryInput);
  await target.store.append(KEY, kept);
}

const read = defineTool({
  name: "lookup",
  description: "Looks up a customer.",
  inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  async execute(input: { id: number }) {
    return { content: [{ type: "text", text: `customer ${input.id}` }] };
  },
});

function write(onRun: () => void) {
  return defineTool({
    name: "refund",
    description: "Refunds an order.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    effect: { kind: "write", businessKey: (input: { orderId: string }) => `refund:${input.orderId}` },
    async execute() {
      onRun();
      return { content: [{ type: "text", text: "refunded" }] };
    },
  });
}

function setup(tool: ReturnType<typeof defineTool>, steps: ConstructorParameters<typeof ScriptedModel>[0]) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const registry = createToolRegistry();
  registry.register({ name: tool.name, source: "builtin", definition: tool as never });
  return { adapter, harness: createHarness({ registry, model, system: "You triage tickets." }) };
}

const call = (name: string, input: unknown) => ({
  content: [{ type: "tool_call" as const, callId: "c1", name, input }],
});

describe.each(BACKENDS)("%s", (_name, make) => {
  test("an open call to a read-only tool gets an aborted error, and the turn gets an end", async () => {
    const full = make();
    const first = setup(read, [call("lookup", { id: 1 }), { content: [{ type: "text", text: "Done." }] }]);
    const session = await openSession({ store: full.store, index: full.index, lock: full.lock, key: KEY });
    await runTurn(session, first.harness, { input: "go" });
    await session.close();
    const crashed = make();
    await crashedLog(full, crashed);
    const peek = await openSession({ store: crashed.store, index: crashed.index, key: KEY });
    assert.equal(
      (await peek.toContext()).messages.at(-1)?.role,
      "assistant",
      "the call is open until a turn settles it",
    );
    const next = setup(read, [{ content: [{ type: "text", text: "Resumed." }] }]);
    const reopened = await openSession({ store: crashed.store, index: crashed.index, lock: crashed.lock, key: KEY });
    const result = await runTurn(reopened, next.harness, { input: "carry on" });
    assert.equal(result.stopReason, "done");
    const settled = (await entriesOf(crashed)).find((entry) => entry.type === "tool_result");
    assert.ok(settled?.type === "tool_result" && settled.isError && settled.callId === "c1");
    assert.match(JSON.stringify(settled.content), /interrupted before a result was recorded/);
    const entries = await entriesOf(crashed);
    const aborted = entries.find((entry) => entry.type === "turn_end");
    assert.ok(aborted?.type === "turn_end" && aborted.stopReason === "aborted");
    const roles = next.adapter.calls[0]?.context.messages.map((message) => message.role);
    assert.deepEqual(roles, ["user", "assistant", "tool", "user"]);
    await reopened.close();
  });

  test("an open call to a write gets an unknown outcome that says to reconcile first, not an aborted error", async () => {
    const full = make();
    const first = setup(
      write(() => undefined),
      [call("refund", { orderId: "o1" }), { content: [{ type: "text", text: "Done." }] }],
    );
    const session = await openSession({ store: full.store, index: full.index, lock: full.lock, key: KEY });
    await runTurn(session, first.harness, { input: "refund o1" });
    await session.close();
    const crashed = make();
    await crashedLog(full, crashed);
    const next = setup(
      write(() => undefined),
      [{ content: [{ type: "text", text: "Checking." }] }],
    );
    const reopened = await openSession({ store: crashed.store, index: crashed.index, lock: crashed.lock, key: KEY });
    await runTurn(reopened, next.harness, { input: "carry on" });
    const settled = (await entriesOf(crashed)).find((entry) => entry.type === "tool_result");
    assert.ok(settled?.type === "tool_result");
    const expected = renderOutcome(
      writeOutcome({
        kind: "unknown",
        operation: "refund",
        retry: "reconcile_first",
        reason: "WRITE_INTERRUPTED",
        currentState: "The call stopped before it recorded a result, so it may have taken effect.",
        next: "Check whether it took effect before you do anything else, and tell the user if you cannot.",
      }),
    );
    assert.deepEqual(settled.details, { outcome: expected.payload });
    assert.equal(settled.content[0]?.type === "text" && settled.content[0].text, expected.text);
    assert.match(JSON.stringify(settled.content), /reconcile_first/);
    await reopened.close();
  });

  test("the effect scope takes its tenant from the harness, local by default", async () => {
    const backend = make();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const registry = createToolRegistry();
    const adapter = new ScriptedModel([]);
    const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
    const plain = createHarness({ registry, model, system: "s" });
    const owned = createHarness({ registry, model, system: "s", tenant: "acme" });
    assert.deepEqual(effectScope(session, plain, "c1"), {
      tenant: "local",
      session: "s1",
      branch: "s1",
      toolCallId: "c1",
    });
    assert.equal(effectScope(session, owned, "c1").tenant, "acme");
    await session.close();
  });
  test("a crash after an applied write, before its result, is resumed without a second request", async () => {
    // The fake payment system dedupes by the key it is sent, as an Idempotency-Key API does.
    const requests = new Map<string, number>();
    const store = memoryEffectStore();
    const refundOn = (target: { current?: Awaited<ReturnType<typeof openSession>> }, harness: { tenant: string }) =>
      defineTool({
        name: "refund",
        description: "Refunds an order.",
        inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
        effect: { kind: "write", businessKey: (input: { orderId: string }) => `refund:${input.orderId}` },
        async execute(input: { orderId: string }, ctx) {
          const outcome = await guardedWrite({
            store,
            scope: effectScope(target.current as never, harness, ctx.callId),
            businessKey: `refund:${input.orderId}`,
            operation: "refund",
            input,
            dedupe: "idempotency_key",
            async run(key) {
              requests.set(key, (requests.get(key) ?? 0) + 1);
              return "ok";
            },
            toOutcome: (_result, key) =>
              writeOutcome({
                kind: "applied",
                operation: "refund",
                effectKey: key,
                retry: "never",
                next: "Tell the user.",
              }),
          });
          return { content: [{ type: "text", text: outcome.kind }], outcome };
        },
      });
    const full = make();
    const session = await openSession({ store: full.store, index: full.index, lock: full.lock, key: KEY });
    const holder = { current: session };
    const tenant = { tenant: "local" };
    const firstRun = setup(refundOn(holder, tenant), [
      call("refund", { orderId: "o1" }),
      { content: [{ type: "text", text: "Refunded." }] },
    ]);
    await runTurn(session, firstRun.harness, { input: "refund o1" });
    await session.close();
    assert.deepEqual([...requests.values()], [1]);
    // The process died after the refund was applied and recorded in the effect store, before the result was logged.
    const crashed = make();
    await crashedLog(full, crashed);
    const resumed = await openSession({ store: crashed.store, index: crashed.index, lock: crashed.lock, key: KEY });
    holder.current = resumed;
    const second = setup(refundOn(holder, tenant), [
      { content: [{ type: "tool_call", callId: "c9", name: "refund", input: { orderId: "o1" } }] },
      { content: [{ type: "text", text: "Already refunded." }] },
    ]);
    await runTurn(resumed, second.harness, { input: "did the refund go through?" });
    assert.equal(requests.size, 1, "one effect key");
    assert.deepEqual([...requests.values()], [1], "one request for it");
    const answered = (await entriesOf(crashed))
      .filter((entry) => entry.type === "tool_result")
      .map((entry) => entry.type === "tool_result" && entry.callId);
    assert.deepEqual(
      answered,
      ["c1", "c9"],
      "the old call is settled as unknown, and the repeated one answers from the store",
    );
    await resumed.close();
  });

  test("a call the registry no longer has is settled as unknown, because it may have been a write", async () => {
    const full = make();
    const first = setup(read, [call("lookup", { id: 1 }), { content: [{ type: "text", text: "Done." }] }]);
    const session = await openSession({ store: full.store, index: full.index, lock: full.lock, key: KEY });
    await runTurn(session, first.harness, { input: "go" });
    await session.close();
    const crashed = make();
    await crashedLog(full, crashed);
    const next = setup(
      write(() => undefined),
      [{ content: [{ type: "text", text: "Resumed." }] }],
    );
    const reopened = await openSession({ store: crashed.store, index: crashed.index, lock: crashed.lock, key: KEY });
    await runTurn(reopened, next.harness, { input: "carry on" });
    const settled = (await entriesOf(crashed)).find((entry) => entry.type === "tool_result");
    assert.match(JSON.stringify(settled?.type === "tool_result" && settled.content), /reconcile_first/);
    await reopened.close();
  });

  test("a message with blocks and no end is ended as aborted, so its calls are settled too", async () => {
    const full = make();
    const first = setup(
      write(() => undefined),
      [call("refund", { orderId: "o1" }), { content: [{ type: "text", text: "Done." }] }],
    );
    const session = await openSession({ store: full.store, index: full.index, lock: full.lock, key: KEY });
    await runTurn(session, first.harness, { input: "refund o1" });
    await session.close();
    const crashed = make();
    await crashedLog(full, crashed, (entry) => entry.type === "message_end");
    const next = setup(
      write(() => undefined),
      [{ content: [{ type: "text", text: "Checking." }] }],
    );
    const reopened = await openSession({ store: crashed.store, index: crashed.index, lock: crashed.lock, key: KEY });
    await runTurn(reopened, next.harness, { input: "carry on" });
    const entries = await entriesOf(crashed);
    const end = entries.find((entry) => entry.type === "message_end");
    assert.ok(end?.type === "message_end" && end.stopReason === "aborted");
    const settled = entries.find((entry) => entry.type === "tool_result");
    assert.match(JSON.stringify(settled?.type === "tool_result" && settled.content), /reconcile_first/);
    await reopened.close();
  });

  test("calls a turn left waiting for an approval are not settled as a crash", async () => {
    const full = make();
    const first = setup(
      write(() => undefined),
      [call("refund", { orderId: "o1" }), { content: [{ type: "text", text: "Done." }] }],
    );
    const session = await openSession({ store: full.store, index: full.index, lock: full.lock, key: KEY });
    await runTurn(session, first.harness, { input: "refund o1" });
    await session.close();
    const paused = make();
    await crashedLog(full, paused);
    const entries = await entriesOf(paused);
    const start = entries.findLast((entry) => entry.type === "turn_start");
    await paused.store.append(KEY, [
      {
        id: "end-paused",
        parentId: entries.at(-1)?.id as string,
        timestamp: "2026-11-22T00:00:00.000Z",
        origin: "harness",
        type: "turn_end",
        runId: start?.type === "turn_start" ? start.runId : "r",
        stopReason: "awaiting_approval",
        steps: 1,
      },
    ]);
    const next = setup(
      write(() => undefined),
      [{ content: [{ type: "text", text: "Never." }] }],
    );
    const reopened = await openSession({ store: paused.store, index: paused.index, lock: paused.lock, key: KEY });
    // The harness leaves the paused call for the approval that resolves it, and doesn't answer it as a crash.
    await runTurn(reopened, next.harness, { input: "carry on" }).catch(() => undefined);
    assert.ok(!(await entriesOf(paused)).some((entry) => entry.type === "tool_result"));
    await reopened.close();
  });

  test("a checkout gives the effect scope a branch of its own, and a re-run inside a turn is not recorded as an abort", async () => {
    const backend = make();
    const { harness } = setup(read, [
      { content: [{ type: "text", text: "a" }] },
      { content: [{ type: "text", text: "b" }] },
    ]);
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    await runTurn(session, harness, { input: "one" });
    const before = effectScope(session, harness, "c1").branch;
    const start = (await session.path()).find((entry) => entry.type === "turn_start");
    await rerunFrom(session, harness, start?.id as string, { input: "two" });
    assert.notEqual(effectScope(session, harness, "c1").branch, before);
    assert.ok(!(await entriesOf(backend)).some((entry) => entry.type === "turn_end" && entry.stopReason === "aborted"));
    await session.close();
  });
});
