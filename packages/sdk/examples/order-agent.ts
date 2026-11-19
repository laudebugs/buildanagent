// An agent that answers questions about orders. It runs the loop with the lookup_order tool, prints the answer as it
// streams, and reports why the run stopped when it did not finish.
import type { Model } from "@buildanagent/gateway";
import { run } from "@buildanagent/sdk";
import { type FindOrder, lookupOrderTool } from "./lookup-order-tool.js";

const SYSTEM_PROMPT = "You answer questions about orders. Look an order up before you describe it.";
const MAX_STEPS = 5;

/** Answers `question`, writing the answer's text to `write` as it streams. Returns the final answer, or why not. */
export async function answerOrderQuestion(
  model: Model,
  findOrder: FindOrder,
  question: string,
  write: (text: string) => void,
): Promise<string> {
  const started = run({
    model,
    system: SYSTEM_PROMPT,
    input: question,
    tools: [lookupOrderTool(findOrder)],
    maxSteps: MAX_STEPS,
  });
  for await (const event of started) {
    if (event.type === "text_delta") write(event.delta);
  }
  const result = await started.result;
  switch (result.stopReason) {
    case "done":
      return "answered";
    case "error":
      return `the model call failed: ${result.error.message}`;
    default:
      return `the run stopped early: ${result.stopReason}`;
  }
}
