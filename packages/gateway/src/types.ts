/**
 * The provider-neutral transcript the gateway, the adapters, the test model and the loop share
 * (SDK plan §3.2; SDK decisions 2 and 3; D3, D4).
 */

/** A provider-issued token that is valid only for the model that produced it, such as a reasoning signature. */
export interface OpaqueToken {
  api: string;
  provider: string;
  model: string;
  value: string;
}

/** One block of message content. */
export type ContentBlock =
  | { type: "text"; text: string }
  /** Valid only for the model that made it; `transformMessages()` drops or converts it for other models. */
  | { type: "reasoning"; text: string; signature?: OpaqueToken }
  | { type: "image"; mediaType: string; data: string }
  | { type: "tool_call"; callId: string; name: string; input: unknown };

/** What a tool result may carry. */
export type ModelContent = Extract<ContentBlock, { type: "text" | "image" }>;

/** Identifies one model behind one wire protocol and one vendor. */
export interface ModelRef {
  /** Wire protocol, for example `"anthropic-messages"`. */
  api: string;
  /** Vendor and price-catalog entry. */
  provider: string;
  id: string;
}

/**
 * Token counts for one model response. There is deliberately no field named `input`: providers disagree on
 * whether "input" includes cached tokens, so the uncached part says so in its name and `totalInput()` sums the parts.
 */
export interface Usage {
  uncachedInput: number;
  cacheRead: number;
  /**
   * Cache writes at the short and the long lifetime. The keys name Anthropic's 5-minute and 1-hour writes; the
   * OpenAI-compatible adapter counts its 30-minute writes under `"5m"`.
   */
  cacheWrite: { "5m": number; "1h": number };
  output: number;
  /** The part of `output` spent on reasoning. */
  reasoning: number;
  /** The provider's usage object, unchanged. */
  raw: unknown;
  /**
   * `true` when the provider did not report this response's usage, such as a stream that ended without its usage
   * chunk. The counts are then incomplete, often all zero, and the gateway prices the response as unknown instead of
   * as free. Left out, the counts are what the provider reported, zeros included.
   */
  unreported?: true;
}

/** The price of one response. `total` is `null` when the price is unknown, never a guessed zero. */
export interface Cost {
  total: number | null;
  basis: "provider" | "catalog" | "unknown";
  currency: "USD";
  catalogAsOf?: string;
}

/**
 * A failure an adapter can name in provider-neutral terms. `"thinking_prefix_mismatch"`: the provider rejected a
 * reasoning block because the transcript before it changed after the block was written.
 */
export type ModelErrorCode = "thinking_prefix_mismatch";

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  model: ModelRef;
  stopReason: "stop" | "length" | "tool_calls" | "error" | "aborted";
  error?: {
    kind: "retryable" | "overflow" | "quota" | "fatal";
    message: string;
    status?: number;
    /** A provider-neutral name for a failure the caller may want to handle on its own, when the adapter knows one. */
    code?: ModelErrorCode;
    /**
     * How long the provider asked the caller to wait before retrying, in milliseconds, read from the error
     * response's `retry-after-ms` or `retry-after` header. Left out when the response sent neither or sent a value
     * that isn't a valid delay. `createModel()` waits at least this long before it retries. A hint over 60 seconds
     * gets no retry: the call ends with this error, so the caller can wait and call again.
     */
    retryAfterMs?: number;
  };
  /** The tokens of every attempt the call made, failed attempts included, because the provider bills them all. */
  usage: Usage;
  /**
   * The usage of the attempt that produced this message alone. `createModel()` sets it when a call was retried, so
   * `usage` sums several requests; it is absent when `usage` is one request's.
   */
  lastAttemptUsage?: Usage;
  cost: Cost;
}

export type Message =
  | { role: "user"; content: ContentBlock[] }
  | AssistantMessage
  | { role: "tool"; callId: string; content: ModelContent[]; isError: boolean };

/**
 * A tool as one model call sends it: a name, a description and a JSON Schema for the input. The SDK's
 * `defineTool()` lowers its Standard Schema or JSON Schema input to this shape.
 */
export interface WireTool {
  name: string;
  description: string;
  /** A JSON Schema object describing the tool's input. */
  inputSchema: Record<string, unknown>;
}

/** What one model call sends. */
export interface ModelContext {
  system: string;
  messages: Message[];
  tools: WireTool[];
}

/** The context window and output limit that context trimming and the budget need; filled from the price catalog. */
export interface ModelCaps {
  /** The most input tokens one request can send, which is below the full window when the provider caps input. */
  contextWindow: number;
  maxOutputTokens: number;
  images: boolean;
  reasoning: boolean;
}
