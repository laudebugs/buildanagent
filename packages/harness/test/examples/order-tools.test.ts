// Runs the order-tools example, one behaviour in each test.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { openSession } from "@buildanagent/harness/session";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { askAboutStatus, type OrderStore, orderRegistry } from "../../examples/order-tools.js";
import { KEY, memoryBackend, say } from "../session/session-helpers.js";

const store: OrderStore = {
  status: async (id) => (id === "A-1" ? "shipped" : undefined),
  history: async () => ["A-1", "A-2"],
};

async function askWithOneTool() {
  const adapter = new ScriptedModel([
    { usage: {}, content: [{ type: "tool_call", callId: "c1", name: "order_status", input: { orderId: "A-1" } }] },
    say("Order A-1 has shipped."),
  ]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const session = await openSession({ ...memoryBackend(), key: KEY });
  const result = await askAboutStatus(session, model, store, "Where is order A-1?");
  await session.close();
  return { adapter, result };
}

test("the registry holds both tools", () => {
  assert.deepEqual(
    orderRegistry(store)
      .list()
      .map((tool) => tool.canonicalName),
    ["order_status", "order_history"],
  );
});

test("the turn's tools list sends one of the two tools", async () => {
  const { adapter } = await askWithOneTool();
  assert.deepEqual(
    adapter.calls[0]?.context.tools.map((tool) => tool.name),
    ["order_status"],
  );
});

test("the offered tool runs and its result reaches the model", async () => {
  const { adapter, result } = await askWithOneTool();
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
  assert.ok(JSON.stringify(adapter.calls[1]?.context.messages.at(-1)).includes("shipped"));
});
