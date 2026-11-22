// Capstone: the support-triage agent every reference builds, on createAgent.
//   - a read-only lookup tool and a risky escalate tool
//   - humanInTheLoopMiddleware gates escalate; a person rejects it on resume
//   - a custom middleware audits every tool call
//   - a typed triage record through responseFormat
//   - a checkpointer and thread_id (required for interrupts) and an explicit recursionLimit
// Docs: langchain/agents.mdx, human-in-the-loop.mdx, middleware/custom.mdx, structured-output.mdx
import { Command, MemorySaver } from "@langchain/langgraph";
import { createAgent, createMiddleware, fakeModel, humanInTheLoopMiddleware, tool } from "langchain";
import { z } from "zod";
import { check } from "./lib/check.ts";

const executed: string[] = [];
const lookupCustomer = tool(
  async ({ email }) => {
    executed.push("lookup_customer");
    return JSON.stringify({ email, plan: "pro", openTickets: 2 });
  },
  { name: "lookup_customer", description: "Look up a customer by email", schema: z.object({ email: z.string() }) },
);
const escalate = tool(
  async () => {
    executed.push("escalate");
    return "escalated";
  },
  { name: "escalate", description: "Escalate to on-call", schema: z.object({ reason: z.string() }) },
);
const Triage = z
  .object({
    category: z.enum(["bug", "billing", "question"]),
    priority: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  })
  .meta({ title: "Triage" });

const audit: string[] = [];
const auditMiddleware = createMiddleware({
  name: "Audit",
  wrapToolCall: async (request, handler) => {
    audit.push(request.toolCall.name);
    return handler(request);
  },
});

const model = fakeModel()
  .respondWithTools([{ name: "lookup_customer", args: { email: "user@example.com" }, id: "c1" }])
  .respondWithTools([{ name: "escalate", args: { reason: "checkout 500" }, id: "c2" }])
  .respondWithTools([
    { name: "Triage", args: { category: "bug", priority: "high", summary: "Checkout returns 500." }, id: "c3" },
  ]);
// #region gate
const agent = createAgent({
  model,
  tools: [lookupCustomer, escalate],
  systemPrompt: "Look up the customer, then classify the issue.",
  middleware: [
    humanInTheLoopMiddleware({ interruptOn: { escalate: { allowedDecisions: ["approve", "reject"] } } }), // book:note gate
    auditMiddleware,
  ],
  responseFormat: Triage,
  checkpointer: new MemorySaver(),
});
// #endregion
const config = { configurable: { thread_id: "ticket-42" }, recursionLimit: 12 };

const first: any = await agent.invoke(
  { messages: [{ role: "user", content: "Customer user@example.com says checkout fails with a 500. Triage it." }] },
  config,
);
check(first.__interrupt__?.[0]?.value?.actionRequests?.[0]?.name === "escalate", "the run pauses at escalate");
check(JSON.stringify(executed) === '["lookup_customer"]', "the lookup ran; escalate has not");

const done = await agent.invoke(new Command({ resume: { decisions: [{ type: "reject" }] } }), config);
check(JSON.stringify(executed) === '["lookup_customer"]', "the rejected escalation never runs");
check(
  done.structuredResponse.category === "bug" && done.structuredResponse.priority === "high",
  "the agent returns a typed triage record",
);
check(audit.includes("lookup_customer"), "the audit middleware saw the lookup");
check(model.callCount === 3, "three model calls: lookup, escalate request, triage");
console.log("triage:", JSON.stringify(done.structuredResponse));
