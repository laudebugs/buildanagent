/**
 * The messages of a call's input at content level `attributes`. Their parts come from `@buildanagent/sdk/otel`, the
 * module the live observer writes with, so a span rebuilt from the log and a span from a live run read alike.
 */
import type { ModelContent } from "@buildanagent/gateway";
import { type ContentPart, resultParts } from "@buildanagent/sdk/otel";

/** A message as the conventions' `input.messages` hold it. */
export interface MessageJson {
  readonly role: string;
  readonly parts: ContentPart[];
}

/** The message a tool result adds to the conversation. */
export const toolMessage = (callId: string, content: readonly ModelContent[]): MessageJson => ({
  role: "tool",
  parts: [{ type: "tool_call_response", id: callId, response: resultParts(content) }],
});
