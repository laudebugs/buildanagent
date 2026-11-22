// The OpenAI Agents SDK's side of the transcript recorder (scripts/transcripts/). When the runner preloads the
// recorder, this file wraps @openai/agents/testing's ScriptedModel, so each request and answer of every scripted model
// joins the example's transcript; otherwise it does nothing. The wrapper only reads the request and the answer, so
// the model returns what it would without it.
import { type ModelRequest, type ModelResponse, Usage as SdkUsage, type StreamEvent } from "@openai/agents";
import { ScriptedModel } from "@openai/agents/testing";
import {
  answerFacts,
  type Message,
  modelNames,
  type Part,
  parsed,
  record,
  recording,
  reportedUsage,
  toolCallIds,
  type Usage,
} from "../../../../scripts/transcripts/events.ts";

type Item = Record<string, unknown> & { type?: string; role?: string };

/** The text of a message's content, which is a string or a list of text parts. */
function contentParts(content: unknown): Part[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.map((part: Item) =>
    typeof part.text === "string" && (part.type === "input_text" || part.type === "output_text")
      ? { type: "text", text: part.text }
      : { type: "other", kind: String(part.type), value: part },
  );
}

/** A function result's output: the SDK sends `{ type: "text", text }` or a plain string. */
const outputOf = (output: unknown): unknown =>
  output && typeof output === "object" && "text" in output ? (output as { text: unknown }).text : output;

/** One input or output item as a transcript message. */
function message(item: Item): Message {
  if (item.type === "function_call") {
    return {
      role: "assistant",
      parts: [{ type: "tool-call", id: String(item.callId), name: String(item.name), input: parsed(item.arguments) }],
    };
  }
  if (item.type === "function_call_result") {
    return {
      role: "tool",
      parts: [{ type: "tool-result", id: String(item.callId), name: String(item.name), output: outputOf(item.output) }],
    };
  }
  if (item.type === "reasoning") {
    return { role: "assistant", parts: [{ type: "reasoning", text: contentParts(item.content).map(textOf).join("") }] };
  }
  if (item.role === "user" || item.role === "system" || item.role === "assistant") {
    return { role: item.role, parts: contentParts(item.content) };
  }
  const { providerData: _data, ...value } = item;
  return { role: "assistant", parts: [{ type: "other", kind: String(item.type), value }] };
}

const textOf = (part: Part): string => ("text" in part ? part.text : "");

function messagesOf(request: ModelRequest): Message[] {
  const system: Message[] = request.systemInstructions
    ? [{ role: "system", parts: [{ type: "text", text: request.systemInstructions }] }]
    : [];
  const input = typeof request.input === "string" ? [{ role: "user", content: request.input }] : request.input;
  return [...system, ...(input as Item[]).map(message)];
}

/** The tools a request offers, by name: function tools, hosted tools and handoffs. */
const toolsOf = (request: ModelRequest): string[] => [
  ...request.tools.map((tool) => String((tool as { name?: unknown }).name ?? tool.type)),
  ...request.handoffs.map((handoff) => handoff.toolName),
];

const nameOf = modelNames();

function recordRequest(model: object, request: ModelRequest): void {
  record({ kind: "request", model: nameOf(model), messages: messagesOf(request), tools: toolsOf(request) });
}

/** One count from the SDK's token details, which it keeps as a list of `{ name: count }` records. */
function detail(details: readonly object[], name: string): number | undefined {
  for (const entry of details) {
    const count = (entry as Record<string, unknown>)[name];
    if (typeof count === "number") return count;
  }
  return undefined;
}

/**
 * A scripted answer's usage in the transcript's classes. ScriptedModel gives an answer scripted as a bare list of items
 * an all-zero usage, which no script chose, so a usage without a single token is left out. The SDK's input count
 * includes the cached tokens, so the uncached part is what is left once the cached tokens it reports are taken out
 * (events.ts, `Usage`); its output count includes the reasoning tokens, and it reports no cache writes.
 */
export function usageOf(value: unknown): Usage | undefined {
  if (value === undefined) return undefined;
  const usage = value instanceof SdkUsage ? value : new SdkUsage(value as ConstructorParameters<typeof SdkUsage>[0]);
  if (usage.inputTokens === 0 && usage.outputTokens === 0 && usage.totalTokens === 0) return undefined;
  const cacheRead = detail(usage.inputTokensDetails, "cached_tokens");
  return reportedUsage({
    uncachedInput: usage.inputTokens - (cacheRead ?? 0),
    cacheRead,
    output: usage.outputTokens,
    reasoning: detail(usage.outputTokensDetails, "reasoning_tokens"),
  });
}

function recordResponse(model: object, output: readonly unknown[], usage: unknown): void {
  const messages = (output as Item[]).map(message);
  const finish = messages.some((m) => m.parts.some((part) => part.type === "tool-call")) ? "tool-calls" : "stop";
  const answer: Message = { role: "assistant", parts: messages.flatMap((m) => m.parts) };
  // ScriptedModel answers with exactly the items and usage its script holds, call ids included. Its answer names no
  // model, so the transcript records no model id.
  record({
    kind: "response",
    model: nameOf(model),
    message: answer,
    finish,
    ...answerFacts(usageOf(usage), undefined),
    scripted: toolCallIds(answer),
  });
}

/** Wraps ScriptedModel's two entry points; a renamed one fails here instead of recording nothing. */
function attach(): void {
  const proto = ScriptedModel.prototype;
  const getResponse = proto.getResponse;
  const getStreamedResponse = proto.getStreamedResponse;
  if (typeof getResponse !== "function" || typeof getStreamedResponse !== "function") {
    throw new Error("transcript recorder: ScriptedModel no longer has getResponse and getStreamedResponse");
  }
  proto.getResponse = async function (this: ScriptedModel, request: ModelRequest): Promise<ModelResponse> {
    recordRequest(this, request);
    const response = await getResponse.call(this, request);
    recordResponse(this, response.output, response.usage);
    return response;
  };
  proto.getStreamedResponse = function (this: ScriptedModel, request: ModelRequest): AsyncIterable<StreamEvent> {
    recordRequest(this, request);
    const events = getStreamedResponse.call(this, request);
    const model = this;
    return (async function* () {
      for await (const event of events) {
        if (event.type === "response_done") recordResponse(model, event.response.output, event.response.usage);
        yield event;
      }
    })();
  };
}

if (recording) attach();
