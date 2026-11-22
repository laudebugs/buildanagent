/**
 * The results the built-in tools return. A refusal or a failed file call is a result the model reads and can act on,
 * not a thrown error, so the model sees one plain sentence instead of the SDK's generic failure text. A thrown error
 * that is not one of those, such as a disposed sandbox, is a fault of the host and propagates.
 */
import type { ToolResult } from "@buildanagent/sdk";
import { isHarnessError } from "../../errors.js";
import type { SandboxDenial } from "../../sandbox/types.js";

/** A result of one text block. */
export function textResult(text: string, details?: unknown): ToolResult {
  return { content: [{ type: "text", text }], ...(details === undefined ? {} : { details }) };
}

/** An error result of one text block. */
export function errorResult(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** The error result for a command the sandbox's policy stopped. */
export function deniedResult(denial: SandboxDenial): ToolResult {
  return errorResult(`The sandbox denied a ${denial.kind.replace("_", " ")} of ${denial.target}: ${denial.reason}.`);
}

// The failures that come from what the model asked for: a path the policy refuses, a missing file, a file the call
// could not read, and a host the egress proxy refuses.
const MODEL_FAILURES: ReadonlySet<string> = new Set([
  "sandbox_denied",
  "sandbox_not_found",
  "sandbox_io_failed",
  "egress_denied",
]);

/** The error result for a failure the model caused, or the error itself, rethrown, for any other. */
export function failureResult(error: unknown): ToolResult {
  if (isHarnessError(error) && MODEL_FAILURES.has(error.code)) {
    const sentence = `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}`;
    // A message that already ends a sentence keeps its own stop, so the model never reads "x..".
    return errorResult(/[.!?]$/.test(sentence) ? sentence : `${sentence}.`);
  }
  throw error;
}
