// The session runner: one SDK run becomes log entries, with the user entry written before the first model call.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type Session, type SessionStore } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { BACKENDS, type Backend, KEY } from "./session-helpers.js";

const scripted = (steps: ConstructorParameters<typeof ScriptedModel>[0], id = "scripted-model") => {
  const adapter = new ScriptedModel(steps);
  return { adapter, model: createModel({ adapter, id, retries: 0 }) as Model };
};

/** A tool that reports what it was given and the host context it saw. */
function lookup(delayMs = 0) {
  return defineTool({
    name: "lookup",
    description: "Looks up a customer.",
    inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    async execute(input: { id: number }, ctx) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { content: [{ type: "text", text: `customer ${input.id} for ${JSON.stringify(ctx.app ?? null)}` }] };
    },
  });
}

function harnessOf(model: Model, extra: object = {}) {
  const registry = createToolRegistry();
  registry.register({ name: "lookup", source: "builtin", definition: lookup() as never });
  registry.register({
    name: "lookup_slow",
    source: "builtin",
    definition: { ...lookup(30), name: "lookup_slow" } as never,
  });
  return { registry, harness: createHarness({ registry, model, system: "You triage tickets.", ...extra }) };
}

async function open(backend: Backend, key = KEY): Promise<Session> {
  return openSession({ store: backend.store, index: backend.index, lock: backend.lock, key });
}

async function entriesOf(store: SessionStore, key = KEY) {
  const found = [];
  for await (const entry of store.load(key)) found.push(entry);
  return found;
}

const shape = (entries: readonly { type: string; origin: string }[]) =>
  entries.map((entry) => `${entry.type}:${entry.origin}`);

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a scripted two-step run with one tool call writes the entries the events call for, in order", async () => {
    const backend = make();
    const { model } = scripted([
      {
        content: [
          { type: "text", text: "Looking." },
          { type: "tool_call", callId: "c1", name: "lookup", input: { id: 7 } },
        ],
      },
      { content: [{ type: "text", text: "Done." }] },
    ]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    const result = await runTurn(session, harness, { input: "Triage 7." });
    assert.equal(result.stopReason, "done");
    const entries = await entriesOf(backend.store);
    // Each line: the entry, and the SDK event or step that produced it.
    assert.deepEqual(shape(entries), [
      "session_header:harness", // written before the run: a new session's first turn
      "env_stamp:harness", // written with the header
      "loadout:harness", // the first turn's tools and model
      "message_block:user", // the input, written before the run starts
      "turn_start:harness", // run_start
      "message_block:model", // model_call_end, step 1: the text block
      "message_block:model", // model_call_end, step 1: the tool_call block
      "message_end:model", // model_call_end, step 1
      "usage:harness", // model_call_end, step 1
      "tool_result:tool", // tool_call_end
      "message_block:model", // model_call_end, step 2: the text block
      "message_end:model", // model_call_end, step 2
      "usage:harness", // model_call_end, step 2
      "turn_end:harness", // run_end
    ]);
    const header = entries[0];
    assert.ok(
      header?.type === "session_header" &&
        header.sdkVersion.length > 0 &&
        header.defaultsHash.length > 0 &&
        header.capabilities.length > 0,
    );
    const input = entries[3];
    assert.ok(input?.type === "message_block" && input.role === "user" && input.delivery === "input");
    const start = entries[4];
    assert.ok(start?.type === "turn_start" && start.system === "You triage tickets." && start.mode === "run");
    const toolResult = entries[9];
    assert.ok(
      toolResult?.type === "tool_result" &&
        toolResult.callId === "c1" &&
        toolResult.tool === "lookup" &&
        toolResult.trust === "trusted" &&
        !toolResult.isError,
    );
    const end = entries.at(-1);
    assert.ok(end?.type === "turn_end" && end.stopReason === "done" && end.steps === 2);
    assert.equal(result.lastEntryId, end?.id);
    assert.equal(result.sessionKey, "s1");
    // Every entry follows the one before it, so the log is one chain.
    assert.deepEqual(
      entries.map((entry) => entry.parentId),
      [null, ...entries.slice(0, -1).map((entry) => entry.id)],
    );
    await session.close();
  });

  test("a turn that is aborted before its first model call leaves the user entry in the file", async () => {
    const backend = make();
    const { model, adapter } = scripted([{ content: [{ type: "text", text: "never" }] }]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    const controller = new AbortController();
    controller.abort();
    const result = await runTurn(session, harness, { input: "Hello.", signal: controller.signal });
    assert.equal(result.stopReason, "aborted");
    assert.equal(adapter.calls.length, 0);
    const entries = await entriesOf(backend.store);
    const user = entries.find((entry) => entry.type === "message_block");
    assert.ok(user?.type === "message_block" && user.block.type === "text" && user.block.text === "Hello.");
    assert.ok(!entries.some((entry) => entry.origin === "model"), "no model entry was written");
    await session.close();
  });

  test("two parallel tool results are each written with their own call id", async () => {
    const backend = make();
    const { model } = scripted([
      {
        content: [
          { type: "tool_call", callId: "slow", name: "lookup_slow", input: { id: 1 } },
          { type: "tool_call", callId: "fast", name: "lookup", input: { id: 2 } },
        ],
      },
      { content: [{ type: "text", text: "Both." }] },
    ]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    await runTurn(session, harness, { input: "Both." });
    const results = (await entriesOf(backend.store)).filter((entry) => entry.type === "tool_result");
    const byCall = (id: string) => results.find((entry) => entry.type === "tool_result" && entry.callId === id);
    assert.equal(results.length, 2);
    assert.ok(byCall("fast")?.type === "tool_result" && byCall("fast")?.tool === "lookup");
    assert.ok(byCall("slow")?.type === "tool_result" && byCall("slow")?.tool === "lookup_slow");
    const fast = byCall("fast");
    const slow = byCall("slow");
    assert.ok(
      fast?.type === "tool_result" && fast.content[0]?.type === "text" && fast.content[0].text.startsWith("customer 2"),
    );
    assert.ok(
      slow?.type === "tool_result" && slow.content[0]?.type === "text" && slow.content[0].text.startsWith("customer 1"),
    );
    await session.close();
  });

  test("input blocks carry origin user, or operator when inputOrigin says so", async () => {
    const backend = make();
    const { model } = scripted([
      { content: [{ type: "text", text: "a" }] },
      { content: [{ type: "text", text: "b" }] },
    ]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    await runTurn(session, harness, { input: "from a person" });
    await runTurn(session, harness, {
      input: [
        { type: "text", text: "scheduled" },
        { type: "text", text: "second block" },
      ],
      inputOrigin: "operator",
    });
    const inputs = (await entriesOf(backend.store)).filter(
      (entry) => entry.type === "message_block" && entry.role === "user",
    );
    assert.deepEqual(
      inputs.map((entry) => entry.origin),
      ["user", "operator", "operator"],
    );
    await session.close();
  });
  test("two turns with different system, tools and maxSteps reach the model as asked, and an unknown tool name throws", async () => {
    const backend = make();
    const { model, adapter } = scripted([
      { content: [{ type: "text", text: "a" }] },
      { content: [{ type: "text", text: "b" }] },
    ]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    await runTurn(session, harness, { input: "one", tools: ["lookup"] });
    await runTurn(session, harness, { input: "two", system: "Be brief.", tools: ["lookup_slow"], maxSteps: 3 });
    assert.deepEqual(
      adapter.calls.map((call) => call.context.system),
      ["You triage tickets.", "Be brief."],
    );
    assert.deepEqual(
      adapter.calls.map((call) => call.context.tools.map((tool) => tool.name)),
      [["lookup"], ["lookup_slow"]],
    );
    await assert.rejects(
      () => runTurn(session, harness, { input: "three", tools: ["nope"] }),
      (error) => isHarnessError(error) && error.code === "invalid_turn_options",
    );
    await session.close();
  });

  test("a model change is recorded as a loadout entry on the turn that sets it", async () => {
    const backend = make();
    const first = scripted([{ content: [{ type: "text", text: "a" }] }]);
    const second = scripted([{ content: [{ type: "text", text: "b" }] }], "other-model");
    const { harness } = harnessOf(first.model);
    const session = await open(backend);
    await runTurn(session, harness, { input: "one" });
    await runTurn(session, harness, { input: "two", model: second.model });
    const loadouts = (await entriesOf(backend.store)).filter((entry) => entry.type === "loadout");
    assert.equal(loadouts.length, 2, "one at the start, one for the change");
    assert.equal(second.adapter.calls.length, 1);
    await session.close();
  });

  test("a hook that swaps the model inside a turn is refused", async () => {
    const backend = make();
    const first = scripted([{ content: [{ type: "text", text: "a" }] }]);
    const other = scripted([{ content: [{ type: "text", text: "b" }] }], "other-model");
    const { harness } = harnessOf(first.model, { interceptors: { beforeModelCall: () => ({ model: other.model }) } });
    const session = await open(backend);
    const outcome = await runTurn(session, harness, { input: "one" }).then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    assert.equal(other.adapter.calls.length, 0, "the swapped model was never called");
    assert.ok("error" in outcome ? isHarnessError(outcome.error) : outcome.result.stopReason === "error");
    await session.close();
  });

  test("two concurrent turns each see only their own host context as ctx.app", async () => {
    const backend = make();
    const call = (id: string) => ({
      content: [{ type: "tool_call" as const, callId: id, name: "lookup", input: { id: 1 } }],
    });
    const a = scripted([call("a1"), { content: [{ type: "text", text: "." }] }]);
    const b = scripted([call("b1"), { content: [{ type: "text", text: "." }] }]);
    const harnessA = harnessOf(a.model).harness;
    const harnessB = harnessOf(b.model).harness;
    const [sa, sb] = await Promise.all([
      open(backend, { userId: "ada", sessionId: "sa" }),
      open(backend, { userId: "ada", sessionId: "sb" }),
    ]);
    await Promise.all([
      runTurn(sa, harnessA, { input: "x", hostContext: { who: "A" } }),
      runTurn(sb, harnessB, { input: "x", hostContext: { who: "B" } }),
    ]);
    const text = async (key: typeof KEY) =>
      JSON.stringify((await entriesOf(backend.store, key)).filter((entry) => entry.type === "tool_result"));
    const ta = await text({ userId: "ada", sessionId: "sa" });
    const tb = await text({ userId: "ada", sessionId: "sb" });
    assert.ok(ta.includes('{\\"who\\":\\"A\\"}') && !ta.includes("B"));
    assert.ok(tb.includes('{\\"who\\":\\"B\\"}') && !tb.includes('"A"'));
    await sa.close();
    await sb.close();
  });

  test("a failed entry write aborts the run and the turn rethrows it", async () => {
    const backend = make();
    const failing: SessionStore = {
      ...backend.store,
      load: (key, options) => backend.store.load(key, options),
      list: (userId) => backend.store.list(userId),
      delete: (key) => backend.store.delete(key),
      append: (key, entries, options) => {
        if (entries.some((entry) => entry.type === "usage")) return Promise.reject(new Error("disk full"));
        return backend.store.append(key, entries, options);
      },
    };
    const { model } = scripted([{ content: [{ type: "text", text: "a" }] }]);
    const { harness } = harnessOf(model);
    const session = await openSession({ store: failing, index: backend.index, lock: backend.lock, key: KEY });
    await assert.rejects(() => runTurn(session, harness, { input: "one" }), /disk full/);
    await session.close();
  });

  test("a child session takes a turn of its own, and its header names the parent and the spawning call", async () => {
    const backend = make();
    const { model } = scripted([{ content: [{ type: "text", text: "child" }] }]);
    const { harness } = harnessOf(model);
    const parent = await open(backend);
    await runTurn(parent, harness, { input: "parent" }).catch(() => undefined);
    const child = await parent.child({ spawningCallId: "call-9" });
    await runTurn(child, harness, { input: "child work" });
    const childKey = { userId: KEY.userId, sessionId: child.file() };
    const first = (await entriesOf(backend.store, childKey))[0];
    assert.ok(
      first?.type === "session_header" && first.spawn?.spawningCallId === "call-9" && first.parent?.session === "s1",
    );
    await child.close();
    await parent.close();
  });
  test("a steer applied during a turn is written as a user block with delivery steer", async () => {
    const backend = make();
    const { model } = scripted([
      { content: [{ type: "tool_call", callId: "c1", name: "lookup_slow", input: { id: 1 } }] },
      { content: [{ type: "text", text: "ok" }] },
    ]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    await runTurn(session, harness, { input: "go", onRun: (started) => started.steer("also check 2") });
    const steer = (await entriesOf(backend.store)).find(
      (entry) => entry.type === "message_block" && entry.delivery === "steer",
    );
    assert.ok(
      steer?.type === "message_block" &&
        steer.role === "user" &&
        steer.block.type === "text" &&
        steer.block.text === "also check 2",
    );
    await session.close();
  });
  test("a permission decision follows the message that made the call and precedes its result", async () => {
    const backend = make();
    const { model } = scripted([
      {
        content: [
          { type: "text", text: "Looking." },
          { type: "tool_call", callId: "c1", name: "lookup", input: { id: 7 } },
        ],
      },
      { content: [{ type: "text", text: "Done." }] },
    ]);
    const registry = createToolRegistry();
    registry.register({ name: "lookup", source: "builtin", definition: lookup() as never });
    const pipeline = createPermissionPipeline(
      { mode: "default", interactive: true, policyVersion: "p1", allow: [{ tool: "lookup" }] },
      registry,
    );
    const harness = createHarness({ registry, model, system: "s", pipeline });
    const session = await open(backend);
    await runTurn(session, harness, { input: "go" });
    const shape2 = (await entriesOf(backend.store)).map((entry) => entry.type);
    const decision = shape2.indexOf("permission_decision");
    assert.ok(decision > shape2.indexOf("message_end"), "after the message that made the call");
    assert.ok(decision < shape2.indexOf("tool_result"), "before the call's result");
    await session.close();
  });

  test("a result from a tool the registry doesn't know is recorded as untrusted", async () => {
    const backend = make();
    const { model } = scripted([{ content: [{ type: "tool_call", callId: "c1", name: "answer", input: { id: 1 } }] }]);
    const { harness } = harnessOf(model);
    const session = await open(backend);
    const output = defineTool({
      name: "answer",
      description: "The turn's answer.",
      inputSchema: { type: "object", properties: { id: { type: "number" } } },
      async execute() {
        return { content: [{ type: "text", text: "x" }] };
      },
    });
    await runTurn(session, harness, { input: "go", output: output as never });
    const result = (await entriesOf(backend.store)).find((entry) => entry.type === "tool_result");
    assert.ok(result?.type === "tool_result" && result.trust === "untrusted");
    await session.close();
  });

  test("a child's first turn writes its env_stamp, and a hook that returns the same model by another object is allowed", async () => {
    const backend = make();
    const { model, adapter } = scripted([
      { content: [{ type: "text", text: "p" }] },
      { content: [{ type: "text", text: "c" }] },
    ]);
    const twin = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
    const { harness } = harnessOf(model, { interceptors: { beforeModelCall: () => ({ model: twin }) } });
    const parent = await open(backend);
    await runTurn(parent, harness, { input: "parent" });
    const child = await parent.child({ stepId: "step-1" });
    const result = await runTurn(child, harness, { input: "work" });
    assert.equal(result.stopReason, "done");
    const types = (await entriesOf(backend.store, { userId: KEY.userId, sessionId: child.file() })).map(
      (entry) => entry.type,
    );
    assert.deepEqual(types.slice(0, 3), ["session_header", "env_stamp", "loadout"]);
    const listed = [];
    for await (const summary of backend.store.list(KEY.userId)) listed.push(summary);
    assert.deepEqual(listed.find((summary) => summary.sessionId === child.file())?.spawn, { stepId: "step-1" });
    await child.close();
    await parent.close();
  });
});
