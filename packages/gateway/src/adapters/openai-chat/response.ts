/**
 * Turns a Chat Completions stream into `ModelEvent`s, from `ChatCompletionChunk` and the stream reader in
 * openai-node v7.49.0 (`src/resources/chat/completions/completions.ts`, `src/core/streaming.ts`, as of November 2026).
 * Each server-sent event's data is one chunk; `data: [DONE]` ends the stream. A chunk's `choices[0].delta` carries
 * text in `content`, a refusal in `refusal`, and tool calls in `tool_calls`, each entry keyed by its `index`, with
 * the `id` and `function.name` in its first entry and `function.arguments` streamed in pieces. `finish_reason` arrives
 * on the last chunk with a choice. With `stream_options.include_usage`, one more chunk, with empty `choices`, carries
 * the `usage` of the whole request before `[DONE]`.
 *
 * OpenAI's models stream no reasoning text, only a count of reasoning tokens. Several compatible servers stream it as
 * `delta.reasoning_content` or `delta.reasoning`, which becomes an unsigned reasoning block.
 */
import type { ToolNameMap } from "../../names.js";
import type { ModelEvent } from "../../spec.js";
import type { ServerSentEvent } from "../../sse.js";
import type { AssistantMessage, ContentBlock, ModelRef, Usage } from "../../types.js";
import { stripAddedNulls } from "../strict-schema.js";
import { isObject, type Json, parseToolInput, type StreamReader, str, terminalMessage } from "../wire.js";
import { failureEvent, failureFrom } from "./failure.js";
import type { RequestPlan } from "./request.js";
import { openaiUsage } from "./usage.js";

type BlockKind = "text" | "reasoning" | "tool_input";

interface OpenBlock {
  readonly kind: BlockKind;
  text: string;
  callId?: string;
  name?: string;
}

// Each wire finish reason as the gateway's. `content_filter` is handled apart, as a failure.
const STOP_REASONS: Readonly<Record<string, AssistantMessage["stopReason"]>> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_calls",
  function_call: "tool_calls",
};

/**
 * An error chunk as the `{ error: { message, ... } }` body `failureFrom()` reads. A compatible server may send the
 * error object bare, or only its message as a string.
 */
function errorBody(chunk: unknown): Json {
  if (isObject(chunk) && isObject(chunk.error)) return chunk;
  if (isObject(chunk) && typeof chunk.error === "string") return { error: { message: chunk.error } };
  if (typeof chunk === "string") return { error: { message: chunk } };
  return isObject(chunk) ? { error: chunk } : {};
}

/** An error event's data: JSON when it parses, else its text, which some compatible servers send bare. */
function parseErrorData(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

/** One stream's state: the blocks so far, the usage and the finish reason. */
export class ChunkAssembler implements StreamReader {
  readonly #model: ModelRef;
  readonly #names: ToolNameMap;
  readonly #strictSchemas: ReadonlyMap<string, Json>;
  readonly #open = new Map<number, OpenBlock>();
  readonly #closed = new Map<number, ContentBlock>();
  // The block index of each wire tool-call index, and of the open text and reasoning blocks.
  readonly #tools = new Map<number, number>();
  #text: number | undefined;
  #reasoning: number | undefined;
  #nextIndex = 0;
  #usage: unknown = null;
  #finish = "";
  #refusal = "";

  constructor(model: ModelRef, plan: Pick<RequestPlan, "names" | "strictSchemas">) {
    this.#model = model;
    this.#names = plan.names;
    this.#strictSchemas = plan.strictSchemas;
  }

  /** The events one server-sent event produces. The last one is the terminal when the stream has ended. */
  handle(sse: ServerSentEvent): ModelEvent[] {
    if (sse.data.trim() === "[DONE]") return this.#terminal();
    const chunk: unknown = sse.event === "error" ? parseErrorData(sse.data) : JSON.parse(sse.data);
    if (sse.event === "error" || (isObject(chunk) && (isObject(chunk.error) || typeof chunk.error === "string"))) {
      return [failureEvent(this.#model, failureFrom(errorBody(chunk), undefined, "stream error"), this.partial())];
    }
    if (!isObject(chunk)) return [];
    if (isObject(chunk.usage)) this.#usage = chunk.usage;
    const choices = Array.isArray(chunk.choices) ? chunk.choices.filter(isObject) : [];
    // The adapter never asks for more than one choice, so it reads the first.
    const choice = choices.find((entry) => entry.index === 0) ?? choices[0];
    if (choice === undefined) return [];
    if (typeof choice.finish_reason === "string") this.#finish = choice.finish_reason;
    return isObject(choice.delta) ? this.#delta(choice.delta) : [];
  }

  /**
   * A stream that closed without `[DONE]`. One that already sent its finish reason ends as it would have, because
   * some compatible servers never send `[DONE]`; any other is a retryable failure.
   */
  ended(): ModelEvent[] {
    if (this.#finish !== "") return this.#terminal();
    return [failureEvent(this.#model, { message: "the stream ended before [DONE]" }, this.partial())];
  }

  /** The content and usage so far, open blocks included, for an `error` terminal. */
  partial(): { content: ContentBlock[]; usage: Usage } {
    const open = [...this.#open].map(([index, block]) => [index, this.#finishBlock(block)] as const);
    const content = [...this.#closed, ...open].sort(([a], [b]) => a - b).map(([, block]) => block);
    return { content, usage: openaiUsage(this.#usage) };
  }

  #delta(delta: Json): ModelEvent[] {
    const events: ModelEvent[] = [];
    const reasoning = str(delta.reasoning_content) || str(delta.reasoning);
    if (reasoning !== "") events.push(...this.#appendProse("reasoning", reasoning));
    const content = str(delta.content);
    if (content !== "") events.push(...this.#appendProse("text", content));
    this.#refusal += str(delta.refusal);
    const calls = Array.isArray(delta.tool_calls) ? delta.tool_calls.filter(isObject) : [];
    for (const call of calls) events.push(...this.#appendToolCall(call));
    return events;
  }

  /** Adds text or reasoning to its open block, opening one first and closing the other kind. */
  #appendProse(kind: "text" | "reasoning", text: string): ModelEvent[] {
    const events = this.#closeIndex(kind === "text" ? this.#reasoning : this.#text);
    let index = kind === "text" ? this.#text : this.#reasoning;
    if (index === undefined) {
      index = this.#openBlock({ kind, text: "" });
      if (kind === "text") this.#text = index;
      else this.#reasoning = index;
      events.push({ type: `${kind}_start`, index });
    }
    const open = this.#open.get(index);
    if (open) open.text += text;
    events.push({ type: `${kind}_delta`, index, delta: text });
    return events;
  }

  #appendToolCall(call: Json): ModelEvent[] {
    const wireIndex = typeof call.index === "number" ? call.index : 0;
    const fn = isObject(call.function) ? call.function : {};
    const id = str(call.id);
    const events: ModelEvent[] = [];
    let index = this.#tools.get(wireIndex);
    // A server that leaves out `index` sends each call whole under its own id, so a new id starts a new call.
    const current = index === undefined ? undefined : this.#open.get(index);
    if (id !== "" && current?.callId && current.callId !== id) index = undefined;
    if (index === undefined) {
      events.push(...this.#closeIndex(this.#text), ...this.#closeIndex(this.#reasoning));
      index = this.#openBlock({ kind: "tool_input", text: "", callId: id, name: str(fn.name) });
      this.#tools.set(wireIndex, index);
      events.push({ type: "tool_input_start", index });
    }
    const open = this.#open.get(index);
    if (open === undefined) return events;
    // The first entry carries the id and name; a server that repeats them in later entries adds nothing.
    if (!open.callId) open.callId = id;
    if (!open.name) open.name = str(fn.name);
    const args = str(fn.arguments);
    if (args === "") return events;
    open.text += args;
    events.push({ type: "tool_input_delta", index, delta: args });
    return events;
  }

  #openBlock(block: OpenBlock): number {
    const index = this.#nextIndex;
    this.#nextIndex += 1;
    this.#open.set(index, block);
    return index;
  }

  #closeIndex(index: number | undefined): ModelEvent[] {
    if (index === undefined) return [];
    const open = this.#open.get(index);
    if (index === this.#text) this.#text = undefined;
    if (index === this.#reasoning) this.#reasoning = undefined;
    if (open === undefined) return [];
    this.#open.delete(index);
    const block = this.#finishBlock(open);
    this.#closed.set(index, block);
    return [{ type: `${open.kind}_end`, index, block }];
  }

  #finishBlock(open: OpenBlock): ContentBlock {
    if (open.kind === "text") return { type: "text", text: open.text };
    if (open.kind === "reasoning") return { type: "reasoning", text: open.text };
    const wire = open.name ?? "";
    const name = this.#names.restore(wire) ?? wire;
    const input = parseToolInput(open.text);
    const schema = this.#strictSchemas.get(name);
    // A call cut off by the output limit keeps its partial JSON text as it arrived.
    const stripped = schema === undefined || typeof input === "string" ? input : stripAddedNulls(input, schema);
    return { type: "tool_call", callId: open.callId ?? "", name, input: stripped };
  }

  #terminal(): ModelEvent[] {
    const closing = [...this.#open.keys()].sort((a, b) => a - b).flatMap((index) => this.#closeIndex(index));
    const { content, usage } = this.partial();
    if (this.#finish === "content_filter" || this.#refusal !== "") {
      const message =
        this.#refusal !== ""
          ? `refusal: ${this.#refusal}`
          : "content_filter: the provider's content filter omitted all or part of the reply";
      return [...closing, failureEvent(this.#model, { message, kind: "fatal" }, { content, usage })];
    }
    const hasCalls = content.some((block) => block.type === "tool_call");
    const mapped = STOP_REASONS[this.#finish] ?? "stop";
    // Some compatible servers end a reply that calls tools with "stop"; the calls still need their results.
    const stopReason = mapped === "stop" && hasCalls ? "tool_calls" : mapped;
    return [...closing, { type: "done", message: terminalMessage(this.#model, { content, usage }, stopReason) }];
  }
}
