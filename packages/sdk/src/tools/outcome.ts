/**
 * Write outcomes in tool results. The outcome's sentence and fields go first in the content the model reads, and
 * any kind except `applied` sets `isError`. The outcome travels in the result body as well as in the error flag,
 * because some adapters drop the flag (close-sdk-gaps SG3).
 */
import type { ModelContent } from "@buildanagent/gateway";
import { SdkError } from "../errors.js";
import { isSafetyError } from "../vendor/agent-safety/errors.js";
import type { WriteOutcome } from "../vendor/agent-safety/outcome.js";
import { type RenderedOutcome, renderOutcome } from "../vendor/agent-safety/render.js";
import type { ToolResult } from "./types.js";

function render(tool: string, outcome: WriteOutcome): RenderedOutcome {
  try {
    // The outcome is checked again here, so one built by hand or revived from JSON follows the same rules.
    return renderOutcome(outcome);
  } catch (cause) {
    const reason = isSafetyError(cause) ? cause.message : String(cause);
    throw new SdkError("invalid_tool_result", `tool "${tool}" returned an invalid write outcome: ${reason}`, { cause });
  }
}

/**
 * Puts a result's write outcome in front of the content the model reads, and sets `isError` for every kind except
 * `applied`. A result without an outcome comes back unchanged. Throws an `SdkError`, code `invalid_tool_result`,
 * when the outcome breaks a rule.
 */
export function withOutcome<S>(tool: string, result: ToolResult<S>): ToolResult<S> {
  if (result.outcome === undefined) return result;
  const rendered = render(tool, result.outcome);
  const content: ModelContent[] = [
    { type: "text", text: rendered.text },
    { type: "text", text: JSON.stringify({ outcome: rendered.payload }) },
    ...result.content,
  ];
  return { ...result, content, isError: result.isError === true || rendered.isError };
}
