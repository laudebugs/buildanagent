/** The single-method model spec every provider adapter implements (SDK plan §3.2; SDK decision 1). */
import type { AssistantMessage, ContentBlock, ModelCaps, ModelContext, ModelRef } from "./types.js";

/** The events one model call streams. Exactly one terminal event, `done` or `error`, ends every stream. */
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
  | { type: "done"; message: AssistantMessage }
  /** The message's `stopReason` is `"error"` or `"aborted"`; it carries any partial content and usage. */
  | { type: "error"; message: AssistantMessage };

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
}

export interface ModelAdapter {
  readonly specificationVersion: "v1";
  /** Wire protocol, for example `"anthropic-messages"`. */
  readonly api: string;
  /** Vendor and catalog entry. */
  readonly provider: string;
  /** Caps for a model the catalog does not list. Without them, `createModel()` needs a catalog entry. */
  readonly defaultCaps?: ModelCaps;
  stream(model: ModelRef, context: ModelContext, options: StreamOptions): AsyncIterable<ModelEvent>;
}
