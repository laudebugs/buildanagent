import type { AssistantMessage, ContentBlock, ModelEvent } from "@agent-speak/gateway";
import { emptyUsage } from "@agent-speak/gateway";

export function message(
  stopReason: AssistantMessage["stopReason"],
  content: ContentBlock[] = [],
  extra: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content,
    model: { api: "test", provider: "test", id: "test-model" },
    stopReason,
    usage: emptyUsage(),
    cost: { total: null, basis: "unknown", currency: "USD" },
    ...extra,
  };
}

export async function* streamOf(events: ModelEvent[]): AsyncIterable<ModelEvent> {
  for (const event of events) yield event;
}

/** A valid stream: one text block and one tool call, ending in `tool_calls`. */
export function validEvents(): ModelEvent[] {
  const text: ContentBlock = { type: "text", text: "Hi" };
  const call: ContentBlock = { type: "tool_call", callId: "c1", name: "read", input: { path: "a" } };
  return [
    { type: "start" },
    { type: "text_start", index: 0 },
    { type: "text_delta", index: 0, delta: "H" },
    { type: "text_delta", index: 0, delta: "i" },
    { type: "text_end", index: 0, block: text },
    { type: "tool_input_start", index: 1 },
    { type: "tool_input_delta", index: 1, delta: '{"path":"a"}' },
    { type: "tool_input_end", index: 1, block: call },
    { type: "done", message: message("tool_calls", [text, call]) },
  ];
}
