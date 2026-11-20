// A function tool with a Zod schema; the real tool pipeline runs between two model turns.
// Docs: guides/tools.mdx "Function tools", guides/testing.mdx "Test a tool workflow"
import { Agent, tool } from "@openai/agents";
import { assistantMessage, functionCall, ScriptedModel } from "@openai/agents/testing";
import { z } from "zod";
import { check, runner } from "./lib/check.ts";

// #region function-tool
const calls: Array<{ city: string }> = [];
const weather = tool({
  name: "get_weather",
  description: "Gets the weather for a city.",
  parameters: z.object({ city: z.string() }), // book:note schema
  execute: async ({ city }) => {
    calls.push({ city }); // book:note execute
    return `${city}: sunny`;
  },
});
// #endregion
// #region run
const model = new ScriptedModel([
  [functionCall("get_weather", { city: "Lisbon" }, { callId: "call_1" })], // book:note script
  [assistantMessage("It is sunny in Lisbon.")],
]);
const agent = new Agent({ name: "Weather", model, tools: [weather] }); // book:note agent
const result = await runner.run(agent, "Weather in Lisbon?"); // book:note run
// #endregion

check(calls.length === 1 && calls[0].city === "Lisbon", "execute() received the parsed arguments");
check(
  model.firstCall?.request.tools.some((t) => t.type === "function" && t.name === "get_weather"),
  "the tool is offered to the model",
);
const lastInput = model.lastCall?.request.input;
check(
  Array.isArray(lastInput) && lastInput.some((i) => i.type === "function_call_result"),
  "the second request carries the tool result",
);
check(result.finalOutput === "It is sunny in Lisbon.", "the final answer follows the tool result");
model.assertComplete();
