// The smallest agent: one Agent, one run, read finalOutput.
// Docs: guides/agents.mdx "Basic configuration", guides/running-agents.mdx, guides/testing.mdx
import { Agent } from "@openai/agents";
import { assistantMessage, ScriptedModel } from "@openai/agents/testing";
import { check, runner } from "./lib/check.ts";

const model = new ScriptedModel([[assistantMessage("Hello from the agent.")]]);
const agent = new Agent({ name: "Greeter", instructions: "Greet the user in one sentence.", model });
const result = await runner.run(agent, "Say hello.");

check(result.finalOutput === "Hello from the agent.", "finalOutput holds the final text");
check(result.lastAgent?.name === "Greeter", "lastAgent is the agent that answered");
check(model.calls.length === 1, "one model call for a text-only answer");
check(
  model.firstCall?.request.systemInstructions === "Greet the user in one sentence.",
  "instructions reach the model as system instructions",
);
model.assertComplete();
check(true, "assertComplete() passes when every scripted step was consumed");
