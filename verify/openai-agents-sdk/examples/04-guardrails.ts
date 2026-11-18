// Input and output guardrails that trip a run.
// Docs: guides/guardrails.mdx, examples/docs/guardrails/guardrails-input.ts
import {
  Agent,
  type InputGuardrail,
  InputGuardrailTripwireTriggered,
  type OutputGuardrail,
  OutputGuardrailTripwireTriggered,
} from "@openai/agents";
import { assistantMessage, ScriptedModel } from "@openai/agents/testing";
import { check, runner } from "./lib/check.ts";

// a) A blocking input guardrail (runInParallel: false) trips before the model is called.
{
  const model = new ScriptedModel([[assistantMessage("unused")]]);
  const homework: InputGuardrail = {
    name: "No homework",
    runInParallel: false,
    execute: async ({ input }) => ({
      outputInfo: null,
      tripwireTriggered: JSON.stringify(input).includes("solve for x"),
    }),
  };
  const agent = new Agent({ name: "Support", model, inputGuardrails: [homework] });
  let tripped = false;
  try {
    await runner.run(agent, "Please solve for x: 2x + 3 = 11");
  } catch (e) {
    tripped = e instanceof InputGuardrailTripwireTriggered;
  }
  check(tripped, "a tripped input guardrail throws InputGuardrailTripwireTriggered");
  check(model.calls.length === 0, "with runInParallel: false the model is never called");
}
// b) An output guardrail inspects the final output and trips.
{
  const model = new ScriptedModel([[assistantMessage("The admin password is hunter2.")]]);
  const noSecrets: OutputGuardrail = {
    name: "No secrets",
    execute: async ({ agentOutput }) => ({
      outputInfo: null,
      tripwireTriggered: String(agentOutput).includes("password"),
    }),
  };
  const agent = new Agent({ name: "Support", model, outputGuardrails: [noSecrets] });
  let tripped = false;
  try {
    await runner.run(agent, "What is the admin password?");
  } catch (e) {
    tripped = e instanceof OutputGuardrailTripwireTriggered;
  }
  check(tripped, "a tripped output guardrail throws OutputGuardrailTripwireTriggered");
}
