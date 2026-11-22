// A loop that changes the tool list between steps. The beforeModelCall hook runs before every model call and can name
// the tools that one request carries: here the first step offers only search and the second offers none. The book's
// Chapter 9 lists it beside the AI SDK's prepareStep.
import { defineTool, run } from "@buildanagent/sdk";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const search = defineTool({
  name: "search",
  description: "Search the web",
  inputSchema: z.object({ q: z.string() }),
  async execute({ q }) {
    return { content: [{ type: "text", text: `results for ${q}` }] };
  },
});
const calculate = defineTool({
  name: "calculate",
  description: "Evaluate an expression",
  inputSchema: z.object({ expr: z.string() }),
  async execute() {
    return { content: [{ type: "text", text: "42" }] };
  },
});
const { adapter, model } = scripted([
  { content: [{ type: "tool_call", callId: "call-1", name: "search", input: { q: "pi" } }] },
  { content: [{ type: "text", text: "Pi is about 3.14." }] },
]);
const seen: number[] = [];

// #region prepare-step
const result = await run({
  model,
  system: "You answer questions.",
  tools: [search, calculate],
  maxSteps: 5,
  interceptors: {
    beforeModelCall: ({ stepIndex }) => {
      seen.push(stepIndex);
      return stepIndex === 0
        ? { activeTools: ["search"] } // book:note first-step
        : { activeTools: [] }; // book:note second-step
    },
  },
  input: "What is pi?",
}).result;
// #endregion

const toolNames = (call: number) => adapter.calls[call]?.context.tools.map((tool) => tool.name) ?? [];
check(JSON.stringify(seen) === "[0,1]", "beforeModelCall runs before each model call");
check(JSON.stringify(toolNames(0)) === '["search"]', "step 0: only the active tool is offered");
check(toolNames(1).length === 0, "step 1: activeTools [] offers no tools");
check(result.stopReason === "done" && result.steps === 2, "the loop finishes with the model's answer after two calls");
const last = result.messages.at(-1);
check(
  last?.role === "assistant" && last.content[0]?.type === "text" && last.content[0].text === "Pi is about 3.14.",
  "the run ends on the model's text answer",
);
adapter.assertComplete();
