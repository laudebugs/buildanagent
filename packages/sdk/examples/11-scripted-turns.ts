// A scripted model on our SDK: one answer per model call, played back in order, with a frozen copy of each request
// kept in `calls` so a test can check what the run sent. The book's Chapter 7 lists it beside the mock models of
// four other SDKs.
import { createModel } from "@buildanagent/gateway";
import { defineTool, run } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check } from "./lib/check.js";

const lookupOrder = defineTool({
  name: "lookup_order",
  description: "Look up an order by id",
  inputSchema: z.object({ orderId: z.string() }),
  async execute({ orderId }) {
    return { content: [{ type: "text", text: `${orderId}: shipped` }] };
  },
});

// #region turns
const adapter = new ScriptedModel([
  { content: [{ type: "tool_call", callId: "call-1", name: "lookup_order", input: { orderId: "A-1" } }] }, // book:note first-turn
  { content: [{ type: "text", text: "Order A-1 has shipped." }] }, // book:note second-turn
]);
const model = createModel({ adapter, id: "scripted-model" });
const result = await run({ model, system: "You answer order questions.", tools: [lookupOrder], input: "Where is A-1?" })
  .result;
check(result.stopReason === "done" && result.steps === 2, "the run made one call per scripted turn"); // book:note records
const second = adapter.calls[1]?.context.messages.at(-1);
check(
  second?.role === "tool" && JSON.stringify(second).includes("A-1: shipped"),
  "the second request carries the tool result",
);
adapter.assertComplete(); // book:note complete
// #endregion
