// Runs the order-tools example: both tools are in the registry, the request offers one, and the tool runs.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { openSession } from "@buildanagent/harness/session";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { askAboutStatus, type OrderStore, orderRegistry } from "../../examples/order-tools.js";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const store: OrderStore = {
  status: async (id) => (id === "A-1" ? "shipped" : undefined),
  history: async () => ["A-1", "A-2"],
};

test("the registry holds both tools, and a turn's tools list sends one", async () => {
  assert.deepEqual(
    orderRegistry(store)
      .list()
      .map((tool) => tool.canonicalName),
    ["order_status", "order_history"],
  );
  const adapter = new ScriptedModel([
    { usage: {}, content: [{ type: "tool_call", callId: "c1", name: "order_status", input: { orderId: "A-1" } }] },
    { usage: {}, content: [{ type: "text", text: "Order A-1 has shipped." }] },
  ]);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const session = await openSession({ ...memoryBackend(), key: KEY });
  const result = await askAboutStatus(session, model, store, "Where is order A-1?");
  await session.close();
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
  assert.deepEqual(
    adapter.calls[0]?.context.tools.map((tool) => tool.name),
    ["order_status"],
  );
  const toolMessage = adapter.calls[1]?.context.messages.at(-1);
  assert.ok(JSON.stringify(toolMessage).includes("shipped"));
});
