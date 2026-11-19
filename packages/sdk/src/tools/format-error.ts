/**
 * The default error text the model reads for a failed tool call. Every message says what failed, shows the
 * arguments the model sent, and tells the model not to answer the failure with invented data, because agents have
 * been seen to "make a mock implementation" when a tool fails (agent-SDK guide §4).
 */
import type { ModelContent } from "@buildanagent/gateway";
import type { SchemaIssue, ToolFailure } from "./types.js";

/** The line every default error message ends with. */
export const DO_NOT_SUBSTITUTE =
  "Do not substitute a mock, a placeholder or invented data for this tool's result. Fix the call, try another " +
  "approach, or tell the user what failed.";

/** The fixed line a redacted error shows the model in place of the thrown message. */
export const REDACTED_MESSAGE = "its error message is hidden.";

// Received arguments are shown up to this many characters, so one huge argument can't flood the context.
const MAX_ARGUMENTS_LENGTH = 2000;

// `String()` can itself throw, on an object with no prototype, so the last resort is the object tag.
function plainString(input: unknown): string {
  try {
    return String(input);
  } catch {
    return Object.prototype.toString.call(input);
  }
}

function showArguments(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? plainString(input);
  } catch {
    // Input from a test double or a tool bridge may hold a cycle or a bigint, which JSON can't encode.
    text = plainString(input);
  }
  if (text.length <= MAX_ARGUMENTS_LENGTH) return text;
  // Cut before a surrogate pair rather than through it, so the text stays valid UTF-16.
  const high = text.charCodeAt(MAX_ARGUMENTS_LENGTH - 1);
  const end = high >= 0xd800 && high <= 0xdbff ? MAX_ARGUMENTS_LENGTH - 1 : MAX_ARGUMENTS_LENGTH;
  return `${text.slice(0, end)}… (${text.length - end} more characters)`;
}

function issueLine(issue: SchemaIssue): string {
  return `- ${issue.path === "" ? "(the whole input)" : issue.path}: ${issue.message}`;
}

function describe(failure: ToolFailure): string {
  switch (failure.kind) {
    case "unknown_tool": {
      const tools = failure.availableTools.length === 0 ? "none" : failure.availableTools.join(", ");
      return `There is no tool named "${failure.tool}". The available tools are: ${tools}.`;
    }
    case "invalid_input":
      return [`The arguments for tool "${failure.tool}" are invalid:`, ...failure.issues.map(issueLine)].join("\n");
    case "execution_error":
      return `Tool "${failure.tool}" failed: ${failure.message}`;
    case "truncated":
      return (
        `Tool "${failure.tool}" was not run, because the response was cut off at the output limit before the ` +
        "call's arguments were complete. Re-issue the call with complete arguments, in a shorter response."
      );
    case "not_run":
      return failure.reason === "run_aborted"
        ? `Tool "${failure.tool}" was not run, because the run was cancelled.`
        : `Tool "${failure.tool}" was not run, because the response ended with an error before it was complete. ` +
            "Re-issue the call if it is still needed.";
  }
}

/** The default content for a failed tool call: what failed, the received arguments, and the do-not-substitute line. */
export function formatToolError(failure: ToolFailure): ModelContent[] {
  const text = [describe(failure), `Received arguments: ${showArguments(failure.input)}`, DO_NOT_SUBSTITUTE].join("\n");
  return [{ type: "text", text }];
}
