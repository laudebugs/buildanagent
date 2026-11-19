/** The single-method model spec every provider adapter implements (SDK plan §3.2; SDK decision 1). */
import type { AssistantMessage, ContentBlock, ModelCaps, ModelContext, ModelRef } from "./types.ts";

/** The events one model call streams. Exactly one terminal event, `done` or `error`, ends every stream. */
export type ModelEvent =
  | { type: "start" }
  | { type: "text_start" | "reasoning_start" | "tool_input_start"; index: number }
  | { type: "text_delta" | "reasoning_delta" | "tool_input_delta"; index: number; delta: string }
  | { type: "text_end" | "reasoning_end" | "tool_input_end"; index: number; block: ContentBlock }
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
   * Inspect or replace the request body before it is sent. Return the body to send, or `undefined` to send it
   * unchanged. An adapter calls it once per HTTP request, just before sending.
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
