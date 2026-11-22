// A re-run from an entry starts a new branch of the same log and leaves the branch it left as it was.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, rerunFrom, runTurn } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { BACKENDS, KEY } from "./session-helpers.js";

const lookup = defineTool({
  name: "lookup",
  description: "Looks up a customer.",
  inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
  async execute(input: { id: number }) {
    return { content: [{ type: "text", text: `customer ${input.id}` }] };
  },
});

function setup(steps: ConstructorParameters<typeof ScriptedModel>[0]) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const registry = createToolRegistry();
  registry.register({ name: "lookup", source: "builtin", definition: lookup as never });
  return { adapter, harness: createHarness({ registry, model, system: "You triage tickets." }) };
}

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a re-run from an entry leaves the original branch's entries unchanged and sends the rebuilt context", async () => {
    const backend = make();
    const { adapter, harness } = setup([
      { content: [{ type: "text", text: "First answer." }] },
      { content: [{ type: "text", text: "Second answer." }] },
    ]);
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const first = await runTurn(session, harness, { input: "Question one." });
    const before = [];
    for await (const entry of backend.store.load(KEY)) before.push(entry);
    // Branch from the end of the first turn: the context is the first turn's.
    const branched = await rerunFrom(session, harness, first.lastEntryId, { input: "A different question." });
    assert.equal(branched.stopReason, "done");
    const after = [];
    for await (const entry of backend.store.load(KEY)) after.push(entry);
    assert.deepEqual(after.slice(0, before.length), before, "every earlier entry is unchanged");
    assert.ok(after.length > before.length);
    assert.equal(after[before.length]?.type, "checkout");
    const roles = adapter.calls[1]?.context.messages.map((message) => message.role);
    assert.deepEqual(roles, ["user", "assistant", "user"]);
    await session.close();
  });

  test("a re-run from an earlier entry drops what followed it from the new branch's context", async () => {
    const backend = make();
    const { adapter, harness } = setup([
      { content: [{ type: "text", text: "A1" }] },
      { content: [{ type: "text", text: "A2" }] },
      { content: [{ type: "text", text: "A3" }] },
    ]);
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const one = await runTurn(session, harness, { input: "Q1" });
    await runTurn(session, harness, { input: "Q2" });
    await rerunFrom(session, harness, one.lastEntryId, { input: "Q3" });
    const sent = adapter.calls[2]?.context.messages.map((message) =>
      message.role === "user" ? message.content[0] : message.role,
    );
    assert.deepEqual(sent, [{ type: "text", text: "Q1" }, "assistant", { type: "text", text: "Q3" }]);
    await session.close();
  });

  test("a re-run from an entry that leaves a tool call without its result is refused", async () => {
    const backend = make();
    const { harness } = setup([
      { content: [{ type: "tool_call", callId: "c1", name: "lookup", input: { id: 1 } }] },
      { content: [{ type: "text", text: "Done." }] },
      { content: [{ type: "text", text: "Never." }] },
    ]);
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    await runTurn(session, harness, { input: "go" });
    const path = await session.path();
    const ended = path.find((entry) => entry.type === "message_end");
    await assert.rejects(
      () => rerunFrom(session, harness, ended?.id as string, { input: "again" }),
      (error) => isHarnessError(error) && error.code === "invalid_turn_options",
    );
    await session.close();
  });
});
