/**
 * `toAiToolResult()`: a write outcome as an `ai` tool result. In `ai` 7.0.162 a tool's `toModelOutput` returns one of
 * the `ToolResultOutput` variants of `@ai-sdk/provider-utils` 5.0.74, and the `error-json` variant is the one that
 * sets the provider's error flag, so every kind but `applied` uses it. The import is type-only, so this subpath loads
 * without `ai` installed.
 */
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { WriteOutcome } from "../outcome.js";
import { renderOutcome } from "../render.js";

/**
 * Turns a write outcome into the result the model reads, for use as a tool's `toModelOutput`. The value holds the
 * rendered sentences as `message` beside the outcome's fields. It is an `error-json` result for every kind except
 * `applied`, which is a `json` result.
 *
 * @example
 * ```ts
 * const refund = tool({
 *   inputSchema,
 *   execute: async (input) => issueRefund(input), // returns a WriteOutcome
 *   toModelOutput: ({ output }) => toAiToolResult(output),
 * });
 * ```
 */
export function toAiToolResult(outcome: WriteOutcome): ToolResultOutput {
  const { text, payload, isError } = renderOutcome(outcome);
  return { type: isError ? "error-json" : "json", value: { message: text, ...payload } };
}
