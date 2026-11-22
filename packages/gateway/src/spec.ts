/** The single-method model spec every provider adapter implements (SDK plan §3.2; SDK decision 1). */
import type { AssistantMessage, ContentBlock, ModelCaps, ModelContext, ModelRef } from "./types.js";

/**
 * The events one model call streams. Exactly one terminal event, `done` or `error`, ends every stream. A `raw` event
 * comes only when the caller set `includeRaw`; a `switch` over `type` that must stay exhaustive needs a `raw` case.
 */
export type ModelEvent =
  | { type: "start" }
  | { type: "text_start" | "reasoning_start" | "tool_input_start"; index: number }
  | { type: "text_delta" | "reasoning_delta" | "tool_input_delta"; index: number; delta: string }
  | { type: "text_end" | "reasoning_end" | "tool_input_end"; index: number; block: ContentBlock }
  /**
   * Something the caller should know that does not stop the call, such as an option the provider would reject and
   * the adapter dropped. `code` names the case in snake_case; `message` explains it. A warning is not output, so a
   * call can still be retried after one.
   */
  | { type: "warning"; code: string; message: string }
  /**
   * One event of the provider's own stream, sent only when the call set `includeRaw`. `event` is the provider's
   * shape, outside the gateway's versioning: an adapter passes it on as it read it and never changes it. The two
   * wire adapters send one per server-sent event, as `{ event, data }`: the SSE event name (`"message"` when the
   * event named none) and its `data:` lines joined by newlines, unparsed, so OpenAI's `data: [DONE]` arrives as the
   * string `"[DONE]"`. It comes before the normalized events that server-sent event produced. A raw event is not
   * output, so a call can still be retried after one; the `retry` event marks the failed attempt's raw events
   * superseded. It holds the model's output and any provider metadata the normalized events drop, so keep it out
   * of logs you would keep content out of.
   */
  | { type: "raw"; event: unknown }
  | { type: "done"; message: AssistantMessage }
  /** The message's `stopReason` is `"error"` or `"aborted"`; it carries any partial content and usage. */
  | { type: "error"; message: AssistantMessage };

/** The per-call options of `ModelAdapter.stream()`: an abort signal, output and sampling limits, and the raw-event switch. */
export interface StreamOptions {
  signal?: AbortSignal;
  maxOutputTokens?: number;
  temperature?: number;
  /** One portable caching policy that each adapter maps to its provider's controls. */
  cacheRetention?: "none" | "short" | "long";
  /** Escape hatch only. */
  providerOptions?: Record<string, unknown>;
  /**
   * The model's caps. `createModel()` sets them on every call to the caps it resolved, from its catalog or the
   * adapter's `defaultCaps`, after middleware has run, so a `Model`'s options (`ModelCallOptions`) leave them out and
   * any `caps` a caller or middleware passes anyway is replaced. An adapter called directly without them uses its
   * `defaultCaps`.
   */
  caps?: ModelCaps;
  /**
   * Inspect or replace the request body before it is sent. Return the body to send, or `undefined` to send it
   * unchanged. An adapter calls it once per HTTP request, just before sending, so an adapter that sends a second
   * request within one attempt calls it twice.
   */
  onPayload?(body: unknown): unknown;
  /**
   * Also stream the provider's own events, each as a `raw` event before the normalized events it produced. Default
   * off, and with it off the stream is exactly as it would be without the option. An HTTP error response, which has
   * no event stream, gets no raw event: its status and message are in the `error` terminal.
   */
  includeRaw?: boolean;
}

/**
 * What a provider adapter implements: its identity and one method, `stream()`, which sends a request and returns the
 * events of the answer. The stream follows the gateway's stream rule, and `createModel()` binds an adapter to a model id.
 */
export interface ModelAdapter {
  readonly specificationVersion: "v1";
  /** Wire protocol, for example `"anthropic-messages"`. */
  readonly api: string;
  /** Vendor and catalog entry. */
  readonly provider: string;
  /** Caps for a model the catalog does not list. Without them, `createModel()` needs a catalog entry. */
  readonly defaultCaps?: ModelCaps;
  /** Sends one request for `model` and streams the answer's events, from `start` to exactly one terminal event. */
  stream(model: ModelRef, context: ModelContext, options: StreamOptions): AsyncIterable<ModelEvent>;
}
