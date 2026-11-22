// A tool and the loop that calls it, on our SDK. defineTool() gives the model a name, a description and a schema, and
// keeps execute() in your process; run() calls the model, runs each tool call and sends the results back until the
// model answers with text or the run makes maxSteps model calls. The book's Chapter 1 lists it beside the AI SDK's
// tool() and generateText.
import { defineTool, run } from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

// #region tool
const calls: unknown[] = [];
const weather = defineTool({
  name: "weather",
  description: "Get the weather for a city",
  inputSchema: z.object({ city: z.string(), unit: z.enum(["C", "F"]).default("C") }),
  async execute(input) {
    calls.push(input);
    const report = { city: input.city, temperature: 21, unit: input.unit };
    return { content: [{ type: "text", text: JSON.stringify(report) }], structured: report };
  },
});
// #endregion
const script = (): ScriptStep[] => [
  { content: [{ type: "tool_call", callId: "call-weather", name: "weather", input: { city: "Lisbon" } }] },
  { content: [{ type: "text", text: "It is 21C in Lisbon." }] },
];

{
  // #region loop
  const { adapter, model } = scripted(script()); // book:note script
  const result = await run({
    model,
    system: "You report the weather.",
    tools: [weather], // book:note tools
    maxSteps: 5, // book:note cap
    input: "Weather in Lisbon?",
  }).result;
  // #endregion
  check(
    JSON.stringify(calls) === JSON.stringify([{ city: "Lisbon", unit: "C" }]),
    "execute() gets the checked input with the schema's default filled in",
  );
  check(result.stopReason === "done" && result.steps === 2, "two model calls: the tool call, then the answer");
  const sent = adapter.calls[1]?.context.messages.find((message) => message.role === "tool");
  check(JSON.stringify(sent).includes('\\"temperature\\":21'), "the tool result goes back to the model");
  const last = result.messages.at(-1);
  check(
    last?.role === "assistant" && last.content[0]?.type === "text" && last.content[0].text === "It is 21C in Lisbon.",
    "the run ends on the model's text answer",
  );
  adapter.assertComplete();
}

// With maxSteps: 1 the tool still runs, but the run stops before the model can read its result.
{
  const ONE_STEP = 1;
  calls.length = 0;
  const { model } = scripted(script().slice(0, 1));
  const result = await run({
    model,
    system: "You report the weather.",
    tools: [weather],
    maxSteps: ONE_STEP,
    input: "Weather in Lisbon?",
  }).result;
  check(result.stopReason === "max_steps" && result.steps === 1, "maxSteps: 1 stops the run after one model call");
  check(calls.length === 1, "maxSteps: 1 still runs the tool the model called");
}
