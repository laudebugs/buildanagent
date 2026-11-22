// A handoff: the triage agent transfers the conversation to a specialist, which answers.
// Docs: guides/handoffs.mdx, guides/agents.mdx "Handoffs"
import { Agent } from "@openai/agents";
import { assistantMessage, functionCall, modelResponder, ScriptedModel } from "@openai/agents/testing";
import { check, runner } from "./lib/check.ts";

let offered: string[] = [];
const model = new ScriptedModel([
  // Triage: call the handoff tool the SDK generated for the billing agent.
  modelResponder(({ request }) => {
    offered = request.handoffs.map((h) => h.toolName);
    return [functionCall(request.handoffs[0].toolName, {}, { callId: "call_handoff" })];
  }),
  // Billing agent answers.
  [assistantMessage("Billing here: your refund is on its way.")],
]);
// #region handoff
const billing = new Agent({ name: "Billing agent", handoffDescription: "Handles refunds and invoices", model });
const triage = new Agent({ name: "Triage agent", instructions: "Route the user.", handoffs: [billing], model }); // book:note handoffs
const result = await runner.run(triage, "Where is my refund?"); // book:note run
// #endregion

// handoffs.mdx says "Refund Agent" becomes `transfer_to_refund_agent`; 0.22.0 keeps the case and
// only replaces spaces (`transfer_to_Refund_Agent`). See docs/reference/openai-agents-sdk/fact-check.md.
check(
  offered.length === 1 && offered[0] === "transfer_to_Billing_agent",
  "a handoff is a tool named transfer_to_<agent name, case kept>",
);
check(result.lastAgent?.name === "Billing agent", "lastAgent is the specialist after the handoff");
check(result.finalOutput === "Billing here: your refund is on its way.", "the specialist's answer is the final output");
model.assertComplete();
