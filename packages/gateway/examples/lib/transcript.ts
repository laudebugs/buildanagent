// Our gateway's side of the transcript recorder (scripts/transcripts/). When scripts/transcripts/book-examples.ts
// preloads the recorder, `recordedAdapter()` wraps the scripted model's adapter, so each request and answer joins the
// example's transcript; otherwise the adapter comes back unchanged. The recorder only reads the context and the
// stream's events, so the model answers as it would without it. packages/sdk/examples/lib/transcript.ts maps the same
// transcript types for the SDK's scripted model; the two cannot share a file, because the gateway does not depend on
// the SDK.
import type {
  ContentBlock,
  Message as GatewayMessage,
  Model,
  ModelAdapter,
  ModelCallOptions,
  ModelContext,
  ModelEvent,
} from "@buildanagent/gateway";
import {
  answerFacts,
  enterCaller,
  type Message,
  modelNames,
  type Part,
  record,
  recording,
  reportedUsage,
} from "../../../../scripts/transcripts/events.js";

/** The model id the examples' scripted() helper gives a model that names none, which names no real model. */
export const SCRIPTED_MODEL_ID = "scripted-model";

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
      const part: Part = {
        type: "tool-result",
        id: message.callId,
        name: names.get(message.callId) ?? "",
        output: outputOf(message.content),
        ...(message.isError ? { error: true as const } : {}),
      };
      messages.push({ role: "tool", parts: [part] });
      continue;
    }
    for (const block of message.content) if (block.type === "tool_call") names.set(block.callId, block.name);
    messages.push({ role: message.role, parts: message.content.map(blockPart) });
  }
  return messages;
}

const nameOf = modelNames();

/** The token counts a script reports, in Anthropic's classes: a class left out is not reported. */
export interface ScriptedUsage {
  uncachedInput?: number;
  cacheRead?: number;
  /** Tokens written to the 5-minute cache. */
  cacheWrite?: number;
  output?: number;
}

/** What a script reports: the same classes for every answer, or a choice made per terminal event. */
export type UsageSource =
  | ScriptedUsage
  | ((event: Extract<ModelEvent, { type: "done" | "error" }>) => ScriptedUsage | undefined);

/** The usage classes the script reported, which the transcript records; the gateway splits cache writes by lifetime. */
function usageOf(event: Extract<ModelEvent, { type: "done" | "error" }>, source: UsageSource | undefined) {
  const script = typeof source === "function" ? source(event) : source;
  const { usage } = event.message;
  if (usage.unreported || script === undefined) return undefined;
  const counts = {
    uncachedInput: usage.uncachedInput,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite["5m"] + usage.cacheWrite["1h"],
    output: usage.output,
  };
  const set = new Set(Object.keys(script));
  return reportedUsage(Object.fromEntries(Object.entries(counts).filter(([key]) => set.has(key))));
}

/** Records the answer once its stream ends, from the terminal event's message. */
async function* recorded(
  adapter: object,
  events: AsyncIterable<ModelEvent>,
  script: UsageSource | undefined,
): AsyncGenerator<ModelEvent> {
  for await (const event of events) {
    if (event.type === "done" || event.type === "error") {
      const message: Message = { role: "assistant", parts: event.message.content.map(blockPart) };
      const { id } = event.message.model;
      record({
        kind: "response",
        model: nameOf(adapter),
        message,
        finish: event.message.stopReason,
        ...answerFacts(usageOf(event, script), id === SCRIPTED_MODEL_ID ? undefined : id),
      });
    }
    yield event;
  }
}

/**
 * The adapter with a recorder around its `stream()`. `usage` is what the example's script reported, because the
 * gateway fills every count a stream leaves out with a zero, and a zero would read as a measurement.
 */
export function recordedAdapter(adapter: ModelAdapter, usage: UsageSource | undefined): ModelAdapter {
  if (!recording) return adapter;
  const wrapped: ModelAdapter = {
    specificationVersion: adapter.specificationVersion,
    api: adapter.api,
    provider: adapter.provider,
    ...(adapter.defaultCaps === undefined ? {} : { defaultCaps: adapter.defaultCaps }),
    stream(model, context, options) {
      record({
        kind: "request",
        model: nameOf(wrapped),
        messages: messagesOf(context),
        tools: context.tools.map((tool) => tool.name),
      });
      return recorded(wrapped, adapter.stream(model, context, options), usage);
    },
  };
  return wrapped;
}

/**
 * The model with each call's example line lent to the events it causes. `stream()` and `complete()` are methods the
 * recorder cannot wrap as it wraps a prototype's, and the gateway runs the adapter after the first `await`, outside
 * the example's stack, so each call marks the line while the example is still on the stack. Without the recorder the
 * model is returned unchanged.
 */
export function lendCallerLine(model: Model): Model {
  if (!recording) return model;
  // Object.create keeps every member of the model, including any the gateway adds later, and overrides the two calls.
  return Object.assign(Object.create(model) as Model, {
    stream(context: ModelContext, options?: ModelCallOptions) {
      enterCaller();
      return model.stream(context, options);
    },
    complete(context: ModelContext, options?: ModelCallOptions) {
      enterCaller();
      return model.complete(context, options);
    },
  });
}
