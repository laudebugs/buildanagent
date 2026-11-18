// Capstone: a support-triage agent on ToolLoopAgent, the same agent every reference builds.
// It looks up the customer's order, classifies the ticket with structured output, and asks a
// human before issuing a refund; an explicit stopWhen caps the loop.
// Docs: agents/building-agents.mdx, agents/tool-approvals.mdx, agents/loop-control.mdx,
// ai-sdk-core/generating-structured-data.mdx
import { isStepCount, type ModelMessage, Output, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { check, scripted, systemText, toolNames } from "./lib/check.ts";

const orders: Record<string, { status: string; amount: number }> = { "A-1": { status: "delivered", amount: 40 } };
const refunds: string[] = [];

const lookupOrder = tool({
  description: "Look up an order by id",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => orders[orderId] ?? { status: "unknown", amount: 0 },
});
const issueRefund = tool({
  description: "Refund an order in full",
  inputSchema: z.object({ orderId: z.string(), reason: z.string() }),
  execute: async ({ orderId }) => {
    refunds.push(orderId);
    return { refunded: orderId };
  },
});
const Triage = z.object({
  category: z.enum(["billing", "shipping", "bug", "other"]),
  action: z.enum(["refunded", "escalated", "answered"]),
  summary: z.string(),
});

const { model, requests } = scripted([
  { tools: [{ name: "lookupOrder", input: { orderId: "A-1" } }] },
  { tools: [{ name: "issueRefund", input: { orderId: "A-1", reason: "charged twice" } }] },
  JSON.stringify({ category: "billing", action: "refunded", summary: "Refunded A-1 after a double charge." }),
]);

const agent = new ToolLoopAgent({
  model,
  instructions: "You triage support tickets. Look up the order before acting. Never refund without approval.",
  tools: { lookupOrder, issueRefund },
  toolApproval: { issueRefund: "user-approval" },
  output: Output.object({ schema: Triage, name: "triage" }),
  stopWhen: isStepCount(8),
});

// Turn 1: the agent looks up the order, then asks to refund it.
const messages: ModelMessage[] = [{ role: "user", content: "I was charged twice for order A-1." }];
const first = await agent.generate({ messages });
check(systemText(requests[0]).startsWith("You triage support tickets."), "instructions are the system message");
check(JSON.stringify(toolNames(requests[0])) === '["issueRefund","lookupOrder"]', "both tools are offered");
const lookup = first.steps[0].staticToolResults.find((r) => r.toolName === "lookupOrder");
check(lookup?.toolName === "lookupOrder" && lookup.output.status === "delivered", "step 1 looks up the order");
const asks = first.content.filter((p) => p.type === "tool-approval-request");
check(asks.length === 1 && asks[0].toolCall.toolName === "issueRefund", "the refund waits for approval");
check(refunds.length === 0, "no refund before approval");

// A human approves; turn 2 runs the refund and returns the structured triage record.
messages.push(...first.responseMessages, {
  role: "tool",
  content: [{ type: "tool-approval-response", approvalId: asks[0].approvalId, approved: true }],
});
const second = await agent.generate({ messages });
check(JSON.stringify(refunds) === '["A-1"]', "after approval the refund runs exactly once");
check(
  second.output.category === "billing" && second.output.action === "refunded",
  "the agent returns a typed triage record",
);
check(requests.length === 3, "three model calls in all: lookup, refund request, final answer");
check(requests[2].responseFormat?.type === "json", "the final call asks for JSON");
console.log(second.output.summary);
