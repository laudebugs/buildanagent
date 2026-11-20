// ToolLoopAgent loops until a stop condition holds. Without stopWhen it stops after 20 steps and
// logs a warning; hasToolCall stops after a named tool runs; conditions in an array are ORed.
// Docs: agents/loop-control.mdx, reference/ai-sdk-core/tool-loop-agent.mdx, has-tool-call.mdx
import { hasToolCall, isStepCount, ToolLoopAgent, tool } from "ai";
import { z } from "zod";
import { check, scripted } from "./lib/check.ts";

const ping = tool({ inputSchema: z.object({}), execute: async () => "pong" });
const forever = () => scripted(() => ({ tools: [{ name: "ping", input: {} }] }));

const warnings: string[] = [];
(globalThis as any).AI_SDK_LOG_WARNINGS = (o: { warnings: { message?: string }[] }) =>
  warnings.push(...o.warnings.map((w) => w.message ?? ""));

{
  const { model, requests } = forever();
  const result = await new ToolLoopAgent({ model, tools: { ping } }).generate({ prompt: "Loop." });
  check(result.steps.length === 20 && requests.length === 20, "default: the agent stops after 20 steps");
  check(
    warnings.some((w) => w.includes("default stopWhen condition, isStepCount(20)")),
    "default: hitting the cap logs a warning",
  );
}
{
  warnings.length = 0;
  const { model } = forever();
  // #region step-cap
  const result = await new ToolLoopAgent({ model, tools: { ping }, stopWhen: isStepCount(3) }).generate({
    prompt: "Loop.",
  });
  // #endregion
  check(result.steps.length === 3, "isStepCount(3) stops after 3 steps");
  check(warnings.length === 0, "an explicit stopWhen logs no warning");
}
{
  const finalAnswer = tool({ inputSchema: z.object({ answer: z.string() }), execute: async ({ answer }) => answer });
  const { model } = scripted([
    { tools: [{ name: "ping", input: {} }] },
    { tools: [{ name: "finalAnswer", input: { answer: "42" } }] },
    "never reached",
  ]);
  // #region stop-when
  const agent = new ToolLoopAgent({
    model,
    tools: { ping, finalAnswer }, // book:note done-tool
    stopWhen: [hasToolCall("finalAnswer"), isStepCount(10)], // book:note either
  });
  const result = await agent.generate({ prompt: "Answer." });
  // #endregion
  check(result.steps.length === 2, "hasToolCall('finalAnswer') stops right after that tool's step");
  check(result.staticToolResults.at(-1)?.output === "42", "the final tool result is on the result");
}
