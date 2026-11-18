// A tool's execute() gets the schema-parsed input, its result goes back to the model, and the
// loop continues only while stopWhen allows: generateText defaults to one step.
// Docs: ai-sdk-core/tools-and-tool-calling.mdx, agents/loop-control.mdx
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

const calls: unknown[] = [];
const weather = tool({
  description: "Get the weather for a city",
  inputSchema: z.object({ city: z.string(), unit: z.enum(["C", "F"]).default("C") }),
  execute: async (input) => {
    calls.push(input);
    return { city: input.city, temperature: 21, unit: input.unit };
  },
});
const script = () => scripted([{ tools: [{ name: "weather", input: { city: "Lisbon" } }] }, "It is 21C in Lisbon."]);

// Default stopWhen is isStepCount(1): the tool runs, but no second model call follows.
{
  const { model, requests } = script();
  const result = await generateText({ model, tools: { weather }, prompt: "Weather in Lisbon?" });
  check(requests.length === 1, "default: one model call");
  check(result.steps.length === 1 && result.toolResults.length === 1, "default: the tool still executes in that step");
  check(result.text === "", "default: no final text, because the loop stopped after the tool step");
}

// isStepCount(5): the loop continues until the model answers.
{
  calls.length = 0;
  const { model, requests } = script();
  const result = await generateText({
    model,
    tools: { weather },
    stopWhen: isStepCount(5),
    prompt: "Weather in Lisbon?",
  });
  check(
    JSON.stringify(calls) === JSON.stringify([{ city: "Lisbon", unit: "C" }]),
    "execute() gets parsed input with schema defaults applied",
  );
  check(requests.length === 2 && result.steps.length === 2, "two steps: tool call, then answer");
  const toolMessage = requests[1].prompt.find((m) => m.role === "tool");
  check(JSON.stringify(toolMessage).includes('"temperature":21'), "the tool result is sent back to the model");
  check(result.text === "It is 21C in Lisbon.", "the final step's text is the result");
}

// Invalid tool input never reaches execute(); the error goes back to the model as a tool error.
{
  calls.length = 0;
  const { model, requests } = scripted([{ tools: [{ name: "weather", input: { town: "Lisbon" } }] }, "Sorry."]);
  const result = await generateText({ model, tools: { weather }, stopWhen: isStepCount(5), prompt: "Weather?" });
  check(calls.length === 0, "invalid input: execute() is not called");
  check(
    result.steps[0].content.some((p) => p.type === "tool-error"),
    "invalid input: the step records a tool-error",
  );
  check(requests.length === 2, "invalid input: the loop continues so the model can recover");
}
