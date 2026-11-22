// Our SDK's side of the transcript recorder (scripts/transcripts/). When test/book-examples.test.ts preloads the
// recorder, this file attaches it to `ScriptedModel`, so each request and answer of every scripted model joins the
// example's transcript; otherwise it does nothing. The recorder only reads the request and the stream's events, so the
// model answers as it would without it.
import type { ContentBlock, Message as GatewayMessage, Model, ModelContext, ModelEvent } from "@buildanagent/gateway";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import {
  enterCaller,
  type Message,
  modelNames,
  type Part,
  record,
  recording,
  toolCallIds,
} from "../../../../scripts/transcripts/events.js";

function blockPart(block: ContentBlock): Part {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "reasoning":
      return { type: "reasoning", text: block.text };
    case "tool_call":
      return { type: "tool-call", id: block.callId, name: block.name, input: block.input };
    case "image":
      return { type: "other", kind: "image", value: { mediaType: block.mediaType, bytes: block.data.length } };
  }
}

/** A tool result's output: the text the model reads, or its blocks when there is more than one text. */
function outputOf(content: readonly ContentBlock[]): unknown {
  const [only] = content;
  return content.length === 1 && only?.type === "text" ? only.text : content.map(blockPart);
}

/** The gateway's context as transcript messages: the system prompt first, then each message in order. */
function messagesOf(context: ModelContext): Message[] {
  // A tool message names only its call, so its tool's name comes from the assistant message that made the call.
  const names = new Map<string, string>();
  const messages: Message[] = context.system
    ? [{ role: "system", parts: [{ type: "text", text: context.system }] }]
    : [];
  for (const message of context.messages as readonly GatewayMessage[]) {
    if (message.role === "tool") {
      messages.push({
        role: "tool",
        parts: [
          {
            type: "tool-result",
            id: message.callId,
            name: names.get(message.callId) ?? "",
            output: outputOf(message.content),
            ...(message.isError ? { error: true as const } : {}),
          },
        ],
      });
      continue;
    }
    for (const block of message.content) if (block.type === "tool_call") names.set(block.callId, block.name);
    messages.push({ role: message.role, parts: message.content.map(blockPart) });
  }
  return messages;
}

const nameOf = modelNames();

/** Records each answer once its stream ends, from the terminal event's message. */
async function* recorded(model: object, events: AsyncIterable<ModelEvent>): AsyncGenerator<ModelEvent> {
  for await (const event of events) {
    if (event.type === "done" || event.type === "error") {
      const message: Message = { role: "assistant", parts: event.message.content.map(blockPart) };
      // The scripted model answers with exactly what its script holds, ids included.
      record({
        kind: "response",
        model: nameOf(model),
        message,
        finish: event.message.stopReason,
        scripted: toolCallIds(message),
      });
    }
    yield event;
  }
}

/** Wraps `ScriptedModel.prototype.stream` so that each call records its request, then its answer. */
function attach(): void {
  const proto = ScriptedModel.prototype;
  const stream = proto.stream;
  proto.stream = function (this: ScriptedModel, ref, context, options) {
    record({
      kind: "request",
      model: nameOf(this),
      messages: messagesOf(context),
      tools: context.tools.map((tool) => tool.name),
    });
    return recorded(this, stream.call(this, ref, context, options));
  };
}

if (recording) attach();

/**
 * The model as a run receives it, lending each run the example line that started it. `run()` is a plain function
 * that starts the loop after it returns, so the recorder cannot wrap it as it wraps a method; it does read
 * `model.ref` while the example's call is still on the stack, and that read marks the line. Without the recorder the
 * model is returned unchanged.
 */
export function lendCallerLine(model: Model): Model {
  if (!recording) return model;
  const { ref } = model;
  return Object.defineProperty({ ...model }, "ref", {
    enumerable: true,
    get() {
      enterCaller();
      return ref;
    },
  });
}
