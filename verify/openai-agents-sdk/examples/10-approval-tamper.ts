// A paused run is a serialized RunState, and RunState.fromString() does not authenticate the snapshot: editing the
// stored tool-call arguments changes what runs after approval. Docs: guides/human-in-the-loop.mdx ("Keep approval
// state on the server": "the method does not authenticate the snapshot or the person submitting it")
import { Agent, RunState, tool } from "@openai/agents";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { z } from "zod";
import { check, runner } from "./lib/check.ts";

const executed: string[] = [];
const refund = tool({
  name: "issue_refund",
  description: "Refund an order",
  parameters: z.object({ orderId: z.string() }),
  needsApproval: async () => true,
  execute: async ({ orderId }) => {
    executed.push(orderId);
    return `refunded ${orderId}`;
  },
});
const model = new ScriptedModel([
  [functionCall("issue_refund", { orderId: "A-1" }, { callId: "call_refund" })],
  [assistantMessage("Done.")],
]);
const agent = new Agent({ name: "Refunds", model, tools: [refund] });

// #region tamper
const first = await runner.run(agent, "Refund order A-1");
check(first.interruptions.length === 1 && executed.length === 0, "the run pauses before the refund");
// The saved snapshot is a string in your database; anyone who can write it can edit the paused call, and this edit
// changes only that call's arguments, not the user's message.
const saved = JSON.stringify(first.state);
const edited = saved.replaceAll('\\"orderId\\":\\"A-1\\"', '\\"orderId\\":\\"Z-9\\"'); // book:note edit
const state = await RunState.fromString(agent, edited);
state.approve(state.getInterruptions()[0]); // book:note approve
await runner.run(agent, state);
// #endregion
check(JSON.stringify(executed) === '["Z-9"]', "the refund runs for the edited order, not the one the reviewer saw");
