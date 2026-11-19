/**
 * Turns the Messages API's stream events into `ModelEvent`s (Streaming messages,
 * https://platform.claude.com/docs/en/build-with-claude/streaming, as of November 2026). A stream runs
 * `message_start`, then each content block as `content_block_start`, its `content_block_delta`s and
 * `content_block_stop`, then one or more `message_delta`s with cumulative usage, then `message_stop`. `ping` events
 * and event types the adapter does not know are skipped, as the versioning policy asks.
 *
 * Text blocks become text, `thinking` and `redacted_thinking` blocks become reasoning with an Anthropic signature,
 * and `tool_use` blocks become tool calls. Server-tool blocks carry nothing this transcript can replay, so they are
 * skipped.
 */
import type { ToolNameMap } from "../../names.js";
import type { ModelEvent } from "../../spec.js";
import type { ServerSentEvent } from "../../sse.js";
import type { AssistantMessage, ContentBlock, ModelRef, Usage } from "../../types.js";
import { isObject, type Json, parseToolInput, type StreamReader, str, terminalMessage } from "../wire.js";
import { failureEvent, failureFrom } from "./failure.js";
import { REDACTED_THINKING_PREFIX } from "./request.js";
import { anthropicUsage, mergeUsage } from "./usage.js";

type Warning = Extract<ModelEvent, { type: "warning" }>;

interface OpenBlock {
  readonly kind: "text" | "reasoning" | "tool_input";
  text: string;
  signature?: string;
  redacted?: string;
  callId?: string;
  name?: string;
  startInput?: unknown;
}

// Each wire stop reason as the gateway's. `refusal` is handled apart, as a failure.
const STOP_REASONS: Readonly<Record<string, AssistantMessage["stopReason"]>> = {
  end_turn: "stop",
  stop_sequence: "stop",
  pause_turn: "stop",
  tool_use: "tool_calls",
  max_tokens: "length",
  model_context_window_exceeded: "length",
};

/** One stream's state: the blocks so far, the usage and the stop reason. */
export class MessageAssembler implements StreamReader {
  readonly #model: ModelRef;
  readonly #names: ToolNameMap;
  readonly #cacheTtl: "5m" | "1h";
  readonly #open = new Map<number, OpenBlock>();
  readonly #closed = new Map<number, ContentBlock>();
  readonly #transformations = new Set<string>();
  #usage: Json = {};
  #stopReason = "";
  #stopDetails: unknown;

  constructor(model: ModelRef, names: ToolNameMap, cacheTtl: "5m" | "1h") {
    this.#model = model;
    this.#names = names;
    this.#cacheTtl = cacheTtl;
  }

  /** The events one server-sent event produces. The last one is the terminal when the stream has ended. */
  handle(sse: ServerSentEvent): ModelEvent[] {
    const data: unknown = JSON.parse(sse.data);
    if (!isObject(data)) return [];
    return this.#dispatch(typeof data.type === "string" ? data.type : sse.event, data);
  }

  /** No status and no terminal: the connection closed early, which a retry may fix. */
  ended(): ModelEvent[] {
    return [failureEvent(this.#model, { message: "the stream ended before message_stop" }, this.partial())];
  }

  #dispatch(type: string, data: Json): ModelEvent[] {
    switch (type) {
      case "message_start":
        return this.#messageStart(data);
      case "content_block_start":
        return this.#blockStart(data);
      case "content_block_delta":
        return this.#blockDelta(data);
      case "content_block_stop":
        return this.#blockStop(data);
      case "message_delta":
        return this.#messageDelta(data);
      case "message_stop":
        return this.#messageStop();
      case "error":
        return [failureEvent(this.#model, failureFrom(data, undefined, "stream error"), this.partial())];
      default:
        return [];
    }
  }

  /** The content and usage so far, open blocks included, for an `error` terminal. */
  partial(): { content: ContentBlock[]; usage: Usage } {
    const open = [...this.#open].map(([index, block]) => [index, this.#finish(block)] as const);
    const content = [...this.#closed, ...open].sort(([a], [b]) => a - b).map(([, block]) => block);
    return { content, usage: this.usage() };
  }

  usage(): Usage {
    return anthropicUsage(this.#usage, this.#cacheTtl);
  }

  #messageStart(data: Json): ModelEvent[] {
    const message = isObject(data.message) ? data.message : {};
    this.#usage = mergeUsage({}, message.usage);
    return this.#transformationWarnings(message.input_transformations);
  }

  // Under the thinking-binding beta, `message_start` carries `input_transformations`, and the final `message_delta`
  // carries it again after a mid-stream fallback (Streaming, "Event types"). Each entry is warned about once.
  #transformationWarnings(entries: unknown): Warning[] {
    if (!Array.isArray(entries)) return [];
    return entries.flatMap((entry): Warning[] => {
      if (!isObject(entry) || entry.type !== "thinking_mismatch_allowed") return [];
      const key = `${str(entry.path)}|${str(entry.reason)}`;
      if (this.#transformations.has(key)) return [];
      this.#transformations.add(key);
      return [
        {
          type: "warning",
          code: "thinking_mismatch_allowed",
          message: `${str(entry.path)}: a thinking block failed the prefix check (${str(entry.reason)}) and reached the model`,
        },
      ];
    });
  }

  #blockStart(data: Json): ModelEvent[] {
    const index = typeof data.index === "number" ? data.index : -1;
    const block = isObject(data.content_block) ? data.content_block : {};
    const open = this.#openBlock(block);
    if (open === undefined || index < 0 || this.#open.has(index) || this.#closed.has(index)) return [];
    this.#open.set(index, open);
    const startEvent: ModelEvent = { type: `${open.kind}_start`, index };
    // A redacted block arrives whole, with no deltas, so it ends where it starts.
    return open.redacted === undefined ? [startEvent] : [startEvent, ...this.#close(index)];
  }

  #openBlock(block: Json): OpenBlock | undefined {
    switch (block.type) {
      case "text":
        return { kind: "text", text: str(block.text) };
      case "thinking":
        return { kind: "reasoning", text: str(block.thinking), signature: str(block.signature) };
      case "redacted_thinking":
        return { kind: "reasoning", text: "", redacted: str(block.data) };
      case "tool_use":
        return { kind: "tool_input", text: "", callId: str(block.id), name: str(block.name), startInput: block.input };
      default:
        return undefined;
    }
  }

  #blockDelta(data: Json): ModelEvent[] {
    const index = typeof data.index === "number" ? data.index : -1;
    const open = this.#open.get(index);
    const delta = isObject(data.delta) ? data.delta : {};
    if (open === undefined) return [];
    if (delta.type === "signature_delta") {
      open.signature = (open.signature ?? "") + str(delta.signature);
      return [];
    }
    const text = str(
      delta.type === "thinking_delta"
        ? delta.thinking
        : delta.type === "input_json_delta"
          ? delta.partial_json
          : delta.text,
    );
    const fits =
      (open.kind === "text" && delta.type === "text_delta") ||
      (open.kind === "reasoning" && delta.type === "thinking_delta") ||
      (open.kind === "tool_input" && delta.type === "input_json_delta");
    // An empty delta adds nothing; a citations delta or another kind of delta has no place in this transcript.
    if (!fits || text === "") return [];
    open.text += text;
    return [{ type: `${open.kind}_delta`, index, delta: text }];
  }

  #blockStop(data: Json): ModelEvent[] {
    return typeof data.index === "number" ? this.#close(data.index) : [];
  }

  #close(index: number): ModelEvent[] {
    const open = this.#open.get(index);
    if (open === undefined) return [];
    this.#open.delete(index);
    const block = this.#finish(open);
    this.#closed.set(index, block);
    return [{ type: `${open.kind}_end`, index, block }];
  }

  #finish(open: OpenBlock): ContentBlock {
    if (open.kind === "text") return { type: "text", text: open.text };
    if (open.kind === "tool_input") {
      const wire = open.name ?? "";
      return {
        type: "tool_call",
        callId: open.callId ?? "",
        name: this.#names.restore(wire) ?? wire,
        input: parseToolInput(open.text, open.startInput ?? {}),
      };
    }
    const value = open.redacted === undefined ? open.signature : `${REDACTED_THINKING_PREFIX}${open.redacted}`;
    const { api, provider, id } = this.#model;
    return value
      ? { type: "reasoning", text: open.text, signature: { api, provider, model: id, value } }
      : { type: "reasoning", text: open.text };
  }

  #messageDelta(data: Json): ModelEvent[] {
    const delta = isObject(data.delta) ? data.delta : {};
    if (typeof delta.stop_reason === "string") this.#stopReason = delta.stop_reason;
    if (delta.stop_details !== undefined) this.#stopDetails = delta.stop_details;
    this.#usage = mergeUsage(this.#usage, data.usage);
    return this.#transformationWarnings(data.input_transformations ?? delta.input_transformations);
  }

  #messageStop(): ModelEvent[] {
    // The output limit can end a stream with a block still open; the block ends here with what arrived.
    const closing = [...this.#open.keys()].sort((a, b) => a - b).flatMap((index) => this.#close(index));
    return [...closing, ...this.#terminal()];
  }

  #terminal(): ModelEvent[] {
    const { content, usage } = this.partial();
    if (this.#stopReason === "refusal") {
      const details = isObject(this.#stopDetails) ? this.#stopDetails : {};
      const category = str(details.category) || "no category";
      const message = `refusal (${category}): ${str(details.explanation) || "the model declined the request"}`;
      // No `type`: failureEvent prefixes the type to the message, which already starts with "refusal".
      return [failureEvent(this.#model, { message, kind: "fatal" }, { content, usage })];
    }
    const stopReason = STOP_REASONS[this.#stopReason] ?? "stop";
    const warnings: Warning[] =
      this.#stopReason === "pause_turn"
        ? [
            {
              type: "warning",
              code: "pause_turn",
              message:
                "The provider paused a long-running server-tool turn. This adapter dropped the turn's server-tool " +
                "blocks, so it cannot resume the paused turn; the reply holds only the content before the pause.",
            },
          ]
        : [];
    return [...warnings, { type: "done", message: terminalMessage(this.#model, { content, usage }, stopReason) }];
  }
}
