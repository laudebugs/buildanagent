/** Gateway runtime types (SDK plan §3.2; SDK decisions 4, 13). */
import type { PriceCatalog } from "./catalog.ts";
import type { ModelAdapter, ModelEvent, StreamOptions } from "./spec.ts";
import type { AssistantMessage, Cost, ModelCaps, ModelContext, ModelRef, Usage } from "./types.ts";

/** How an adapter sends HTTP. Defaults to `globalThis.fetch`. */
export type Transport = (request: Request) => Promise<Response>;

/**
 * What an adapter factory takes. The key is always passed in: the gateway never reads one from the environment and
 * never falls back to another credential.
 */
export interface ProviderConfig {
  /** The provider API key. An empty or missing key fails before any request is sent. */
  apiKey: string;
  /** Overrides the provider's default endpoint, for a proxy or a mock server. */
  baseURL?: string;
  /** Sends the HTTP requests. Defaults to `globalThis.fetch`. */
  transport?: Transport;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
}

/**
 * The events `Model.stream()` yields: the adapter's events plus one `retry` event before each retry. Retry events come
 * after `start` and before any content, because the gateway never retries once output has been streamed.
 */
export type GatewayEvent =
  | ModelEvent
  | {
      type: "retry";
      /** 1 for the first retry, 2 for the second, and so on. */
      attempt: number;
      /** How long the gateway waits before the next attempt. */
      delayMs: number;
      /** The failed attempt's error message. */
      error: string;
    };

/** The stream options a request dump records: everything except the abort signal and the payload hook. */
export type DumpedOptions = Omit<StreamOptions, "signal" | "onPayload">;

/** The full request of one attempt, as `onRequest` receives it. */
export interface RequestDump {
  /** 1 for the first attempt, 2 for the first retry, and so on. */
  readonly attempt: number;
  readonly model: ModelRef;
  readonly context: ModelContext;
  readonly options: DumpedOptions;
  /** The wire body after `onPayload`, or `undefined` for an adapter that sends no wire body, such as a test model. */
  readonly body: unknown;
}

/** The request a middleware may rewrite: the context and the stream options. */
export interface MiddlewareParams {
  context: ModelContext;
  options: StreamOptions;
}

/**
 * Shared behaviour around every model call. In `createModel({ middleware: [a, b] })`, `a` is outermost: `a`'s
 * `transformParams` runs before `b`'s, and `a`'s `wrapStream` wraps `b`'s. Both run once per call, outside the
 * retries, so `next()` yields any `retry` events.
 */
export interface ModelMiddleware {
  /** Rewrites the request before it is sent. */
  transformParams?(params: MiddlewareParams): MiddlewareParams | Promise<MiddlewareParams>;
  /** Wraps the event stream; call `next()` to run the inner middleware and the model. */
  wrapStream?(e: {
    next: () => AsyncIterable<GatewayEvent>;
    context: ModelContext;
    options: StreamOptions;
  }): AsyncIterable<GatewayEvent>;
}

/** Waits `ms` milliseconds, or less if `signal` aborts first. It must resolve, not reject, on abort. */
export type Sleep = (ms: number, signal: AbortSignal | undefined) => Promise<void>;

/** What `createModel()` takes. The adapter is an object: a bare model id string is a type error. */
export interface CreateModelOptions {
  adapter: ModelAdapter;
  /** The provider's model id. */
  id: string;
  /** HTTP retries before any output. Default 2. Only `retryable` errors are retried. */
  retries?: number;
  /** Delay before the first retry in milliseconds. Default 2000; each later retry waits twice as long. */
  initialRetryDelayMs?: number;
  /** First is outermost. */
  middleware?: readonly ModelMiddleware[];
  /**
   * Where `caps` and prices come from. Defaults to the catalog that ships with the gateway; a catalog you pass
   * replaces it. A model missing from it gets the adapter's default caps and an unknown price. It is checked like
   * `parseCatalog()`, so a malformed catalog throws a `GatewayError` with code `invalid_catalog`.
   */
  catalog?: PriceCatalog;
  /** Receives the full request before each attempt is sent. */
  onRequest?(dump: RequestDump): void;
  /** Waits between retries. Defaults to an abortable timer; tests pass a fake to skip the wait. */
  sleep?: Sleep;
}

/** A model bound to one adapter and id, with the gateway's retries, middleware and request dump around it. */
export interface Model {
  readonly ref: ModelRef;
  /** The context window and output limit, from the catalog or the adapter's defaults. */
  readonly caps: ModelCaps;
  /** Streams one call. A failed call ends with an `error` event; only a middleware that throws makes this throw. */
  stream(context: ModelContext, options?: StreamOptions): AsyncIterable<GatewayEvent>;
  /** Reads `stream()` to its end and returns the final message, including a failed call's message. */
  complete(context: ModelContext, options?: StreamOptions): Promise<AssistantMessage>;
  /**
   * Prices one request's usage with the model's catalog entry, choosing the rate tier by that request's input. A
   * model the catalog lacks gets `{ total: null, basis: "unknown" }`. To re-price a retried call, price each request
   * apart, such as `message.lastAttemptUsage ?? message.usage` for the last one: its summed `usage` could select the
   * wrong tier. You rarely need to, because `message.cost` already covers every attempt, priced this way unless the
   * provider reported a billed total.
   */
  price(usage: Usage): Cost;
}
