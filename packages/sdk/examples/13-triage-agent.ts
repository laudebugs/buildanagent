// A support-triage agent on our SDK, run on a scripted model. It looks the customer up, pauses before it escalates,
// resumes once a person approves, and ends with a typed record. The book's Chapter 7 lists it beside the capstones of
// eight other SDKs.
import { continueRun, defineTool, type Interceptors, outputTool, run } from "@buildanagent/sdk";
import { type ScriptStep, testSigner } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const MAX_STEPS = 8;
const SYSTEM = "You triage support tickets. Look the customer up first. Escalate only what an engineer must see.";
const TICKET = "Every pro customer gets a 500 at checkout. Look the customer up, escalate, then submit the triage.";
const REASON = "Checkout returns 500.";
const text = (value: string) => [{ type: "text" as const, text: value }];
const step = (callId: string, name: string, input: unknown): ScriptStep => ({
  content: [{ type: "tool_call", callId, name, input }],
});

const escalations: string[] = [];
const lookupCustomer = defineTool({
  name: "lookup_customer",
  description: "Look up the customer's plan and open tickets.",
  inputSchema: z.object({}),
  execute: async () => ({ content: text('{"plan":"pro","openTickets":2}') }),
});
const escalate = defineTool({
  name: "escalate",
  description: "Escalate the ticket to the on-call engineer.",
  inputSchema: z.object({ reason: z.string() }),
  effect: { kind: "write" },
  execute: async ({ reason }) => {
    escalations.push(reason);
    return { content: text("escalated") };
  },
});
const Triage = z.object({ category: z.enum(["bug", "billing"]), priority: z.enum(["low", "high"]) });

const script = [
  step("call-1", "lookup_customer", {}),
  step("call-2", "escalate", { reason: REASON }),
  step("call-3", "submit_triage", { category: "bug", priority: "high" }),
];
const { adapter, model } = scripted(script); // book:note script
// #region gate
const gate: Interceptors = {
  beforeToolCall: ({ tool }) =>
    tool === "escalate" ? { decision: "ask", reason: "An engineer is paged." } : { decision: "allow" }, // book:note gate
};
// #endregion
const options = {
  model,
  tools: [lookupCustomer, escalate],
  output: outputTool({ name: "submit_triage", schema: Triage }), // book:note typed
  maxSteps: MAX_STEPS, // book:note cap
  interceptors: gate,
  signer: testSigner(),
};
const paused = await run({ ...options, system: SYSTEM, input: TICKET }).result;
check(paused.stopReason === "awaiting_approval", "the run waits for a person before it escalates");
check(escalations.length === 0, "no escalation before approval"); // book:note side-effect
const [request] = paused.stopReason === "awaiting_approval" ? paused.pending : [];
const resolutions = [{ requestId: request?.id ?? "", decision: "allow" as const }];
const done = await continueRun(paused.context, { ...options, resolutions }).result;
check(escalations.filter((reason) => reason !== "").length === 1, "after approval the escalation runs exactly once");
check(done.stopReason === "done" && done.output?.category === "bug", "the run returns a typed triage record");
check(adapter.calls[0]?.context.system === SYSTEM, "the instructions arrive as the system prompt");
check(adapter.calls.length === 3, "the run made exactly the three model calls the script holds"); // book:note count
adapter.assertComplete();
