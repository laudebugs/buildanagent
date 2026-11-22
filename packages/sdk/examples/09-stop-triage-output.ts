// A typed answer on our SDK. The schema becomes an output tool: the model's answer is a call to it. An answer that
// fails the schema goes back to the model as an error result, spends one of maxSteps, and the model can call again.
// The book's Chapter 4 lists it beside the AI SDK's Output.object.
import { outputTool, run } from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const answerWith = (callId: string, input: unknown): ScriptStep => ({
  content: [{ type: "tool_call", callId, name: "triage", input }],
});

// #region triage
const triage = outputTool({
  name: "triage",
  description: "Ticket triage", // book:note output
  schema: z.object({ category: z.enum(["billing", "bug", "other"]), urgent: z.boolean() }),
});
const { adapter, model } = scripted([
  answerWith("call-1", { category: "refund" }), // book:note refund
  answerWith("call-2", { category: "billing", urgent: true }),
]);
const result = await run({
  model,
  system: "Triage the ticket.",
  output: triage,
  maxSteps: 3,
  input: "I was charged twice!",
}).result;
const out: { category: "billing" | "bug" | "other"; urgent: boolean } | undefined =
  result.stopReason === "done" ? result.output : undefined; // book:note typed
// #endregion
check(out?.category === "billing" && out.urgent, "result.output is the checked, typed object");
check(result.steps === 2, "the answer that failed the schema spent one of the model calls");
const sent = adapter.calls[1]?.context.messages.find((message) => message.role === "tool");
check(sent?.role === "tool" && sent.isError === true, "the second request carries the failed call as an error result");
check(JSON.stringify(sent).includes("/category"), "the error result names the field that failed");
check(
  JSON.stringify(adapter.calls[0]?.context.tools[0]?.inputSchema).includes('"urgent"'),
  "the request carries the schema as the output tool's input schema",
);
// @ts-expect-error: only a done result carries output, so this line fails to compile until stopReason is checked.
void result.output;
adapter.assertComplete();

// With one step, the failed answer is the last call the run may make, so the run ends max_steps with no output.
{
  const { model } = scripted([answerWith("call-1", { category: "refund" })]);
  const result = await run({ model, system: "Triage the ticket.", output: triage, maxSteps: 1, input: "?" }).result;
  check(result.stopReason === "max_steps", "a failed answer on the last allowed call ends the run max_steps");
}

// A model that answers in text skips the schema: the run ends done, and result.output is undefined.
{
  const { model } = scripted([{ content: [{ type: "text", text: "Billing, and urgent." }] }]);
  const result = await run({ model, system: "Triage the ticket.", output: triage, input: "?" }).result;
  check(result.stopReason === "done" && result.output === undefined, "a text answer ends done with no output");
}
