// prepareStep runs before every step and can change the step's settings: here it narrows
// activeTools and forces a tool on step 0, then lets the model answer.
// Docs: agents/loop-control.mdx ("Prepare Step"), ai-sdk-core/tools-and-tool-calling.mdx
import { generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { check, scripted, toolNames } from "./lib/check.ts";

const search = tool({ inputSchema: z.object({ q: z.string() }), execute: async ({ q }) => `results for ${q}` });
const calculate = tool({ inputSchema: z.object({ expr: z.string() }), execute: async () => "42" });
const { model, requests } = scripted([{ tools: [{ name: "search", input: { q: "pi" } }] }, "Pi is about 3.14."]);
const seen: number[] = [];

// #region prepare-step
const result = await generateText({
  model,
  tools: { search, calculate },
  stopWhen: isStepCount(5),
  prepareStep: ({ stepNumber, steps }) => {
    seen.push(stepNumber);
    check(steps.length === stepNumber, `prepareStep(${stepNumber}) sees the ${stepNumber} earlier step(s)`);
    return stepNumber === 0
      ? { activeTools: ["search"], toolChoice: { type: "tool", toolName: "search" } } // book:note first-step
      : { activeTools: [] }; // book:note second-step
  },
  prompt: "What is pi?",
});
// #endregion

check(JSON.stringify(seen) === "[0,1]", "prepareStep runs before each step");
check(JSON.stringify(toolNames(requests[0])) === '["search"]', "step 0: only the active tool is offered");
check(requests[0].toolChoice?.type === "tool", "step 0: toolChoice forces the tool");
check(toolNames(requests[1]).length === 0, "step 1: activeTools [] offers no tools");
check(result.text === "Pi is about 3.14.", "the loop finishes with the model's answer");
