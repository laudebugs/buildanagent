/**
 * Turns the SDK's transcript into the JSON the GenAI conventions describe for content attributes: messages with
 * typed `parts`. The observer reads this when `captureContent` is on, and the harness's log projection reads the same
 * functions, so a span from a live run and a span rebuilt from the log hold content in one format.
 */
import type { ContentBlock, Message, ModelContent } from "@buildanagent/gateway";

type Part = Readonly<Record<string, unknown>>;

function blockPart(block: ContentBlock): Part {
  switch (block.type) {
    case "text":
      return { type: "text", content: block.text };
    case "reasoning":
      return { type: "reasoning", content: block.text };
    case "image":
      // The bytes would swamp a span, so the part keeps the type and drops the data.
      return { type: "blob", modality: "image", mime_type: block.mediaType };
    case "tool_call":
      return { type: "tool_call", id: block.callId, name: block.name, arguments: block.input };
  }
}

/** The parts of a result's content, as the conventions' `gen_ai.tool.call.result` or a tool message holds them. */
export function resultParts(content: readonly ModelContent[]): readonly Part[] {
  return content.map(blockPart);
}

function messageOf(message: Message): { readonly role: string; readonly parts: readonly Part[] } {
  if (message.role === "tool") {
    return {
      role: "tool",
      parts: [{ type: "tool_call_response", id: message.callId, response: resultParts(message.content) }],
    };
  }
  return { role: message.role, parts: message.content.map(blockPart) };
}

/** `gen_ai.input.messages` for a call's messages, as a JSON string. */
export function inputMessagesJson(messages: readonly Message[]): string {
  return JSON.stringify(messages.map(messageOf));
}

/** `gen_ai.output.messages` for the model's answer, as a JSON string. */
export function outputMessagesJson(content: readonly ContentBlock[]): string {
  return JSON.stringify([{ role: "assistant", parts: content.map(blockPart) }]);
}

/** `gen_ai.system_instructions`: the system prompt as one text part. */
export function systemInstructionsJson(system: string): string {
  return JSON.stringify([{ type: "text", content: system }]);
}

/** A tool's arguments or result as a JSON string; a value JSON cannot hold becomes its string form. */
export function jsonValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
