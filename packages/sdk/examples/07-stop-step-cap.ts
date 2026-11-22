// A run capped with maxSteps, on our SDK. The scripted model keeps asking for a tool and never answers, so only the cap
// can end the run. run() ends it with a max_steps result and a warning event instead of returning quietly or throwing.
// The book's Chapter 4 lists it beside the AI SDK, LangChain and Claude Agent SDK caps.
import { defineTool, run } from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { z } from "zod";
import { check, scripted } from "./lib/check.js";

const ping = defineTool({
  name: "ping",
  description: "Check that the service is up",
  inputSchema: z.object({}),
  async execute() {
    return { content: [{ type: "text", text: "pong" }] };
  },
});
/** `count` responses that each call ping, so the model never writes an answer. */
const forever = (count: number): ScriptStep[] =>
  Array.from({ length: count }, (_, index) => ({
    content: [{ type: "tool_call", callId: `call-${index + 1}`, name: "ping", input: {} }],
  }));

{
  // #region step-cap
  const STEP_CAP = 3;
  const { adapter, model } = scripted(forever(STEP_CAP)); // book:note script
  const started = run({
    model,
    system: "Keep pinging.",
    tools: [ping],
    maxSteps: STEP_CAP, // book:note cap
    input: "Loop.",
  });
  const warnings: string[] = [];
  for await (const event of started) {
    if (event.type === "warning") warnings.push(event.code); // book:note warning
  }
  const result = await started.result;
  check(result.stopReason === "max_steps", "the cap ends the run max_steps, not done"); // book:note result
  // #endregion
  check(result.steps === 3 && adapter.calls.length === 3, "maxSteps: 3 lets exactly three requests reach the model");
  check(warnings.length === 1 && warnings[0] === "max_steps", "the cap emits one warning event, coded max_steps");
  check(result.messages.at(-1)?.role === "tool", "the last response's tool call still ran, so it has a result");
  adapter.assertComplete();
}

// Without maxSteps the default cap is 20 model calls.
{
  const DEFAULT_STEP_CAP = 20;
  const { adapter, model } = scripted(forever(DEFAULT_STEP_CAP));
  const result = await run({ model, system: "Keep pinging.", tools: [ping], input: "Loop." }).result;
  check(
    result.stopReason === "max_steps" && result.steps === DEFAULT_STEP_CAP,
    "default: the run stops after 20 model calls",
  );
  adapter.assertComplete();
}
