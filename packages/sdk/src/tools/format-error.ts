/**
 * The default error text the model reads for a failed tool call. Every message says what failed, shows the
 * arguments the model sent, and tells the model not to answer the failure with invented data, because agents have
 * been seen to "make a mock implementation" when a tool fails (agent-SDK guide §4).
 */
import type { ModelContent } from "@buildanagent/gateway";
import { fillTemplate, SDK_DEFAULTS } from "../defaults.js";
import type { SchemaIssue, ToolFailure } from "./types.js";

const TEXT = SDK_DEFAULTS.toolErrors;

/** The line every default error message ends with. */
export const DO_NOT_SUBSTITUTE = TEXT.doNotSubstitute;

/** The fixed line a redacted error shows the model in place of the thrown message. */
export const REDACTED_MESSAGE = TEXT.redactedMessage;

const MAX_ARGUMENTS_LENGTH = TEXT.maxArgumentsLength;

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
  return `${text.slice(0, end)}${fillTemplate(TEXT.moreCharacters, { count: String(text.length - end) })}`;
}

function issueLine(issue: SchemaIssue): string {
  return `- ${issue.path === "" ? TEXT.wholeInput : issue.path}: ${issue.message}`;
}

function describe(failure: ToolFailure): string {
  const tool = failure.tool;
  switch (failure.kind) {
    case "unknown_tool": {
      const tools = failure.availableTools.length === 0 ? TEXT.noTools : failure.availableTools.join(", ");
      return fillTemplate(TEXT.unknownTool, { tool, tools });
    }
    case "invalid_input":
      return [fillTemplate(TEXT.invalidInput, { tool }), ...failure.issues.map(issueLine)].join("\n");
    case "execution_error":
      return fillTemplate(TEXT.executionError, { tool, message: failure.message });
    case "truncated":
      return fillTemplate(TEXT.truncated, { tool });
    case "not_run":
      return fillTemplate(TEXT.notRun[failure.reason], { tool });
  }
}

/** The default content for a failed tool call: what failed, the received arguments, and the do-not-substitute line. */
export function formatToolError(failure: ToolFailure): ModelContent[] {
  const received = fillTemplate(TEXT.receivedArguments, { arguments: showArguments(failure.input) });
  return [{ type: "text", text: [describe(failure), received, DO_NOT_SUBSTITUTE].join("\n") }];
}
