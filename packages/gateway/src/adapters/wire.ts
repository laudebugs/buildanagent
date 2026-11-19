/**
 * What every wire adapter shares: sending one HTTP request through the caller's transport, reading a server-sent
 * event stream to its terminal, and turning a failed request, a broken stream or an abort into an `error` terminal.
 * A failed model call never throws; only a guard's error or a `GatewayError` does.
 *
 * Usage: an attempt that ends without a usage report has `unreported` usage, so `createModel()` prices it as unknown.
 * The one exception is an HTTP error response, which counts as zero tokens: the provider answered with an error
 * instead of a reply, and its body reports no usage to read.
 */
import { classifyError, type ErrorKind, isTransportFailure } from "../classify.js";
import { isGatewayError } from "../errors.js";
import { assertModelRequestAllowed, ModelRequestsDisabledError } from "../request-policy.js";
import type { Transport } from "../runtime-types.js";
import type { ModelEvent, StreamOptions } from "../spec.js";
import { readServerSentEvents, type ServerSentEvent } from "../sse.js";
import type { AssistantMessage, ContentBlock, ModelErrorCode, ModelRef, Usage } from "../types.js";
import { emptyUsage, unreportedUsage } from "../usage.js";

/** A JSON object as the adapters read it off the wire. */
export type Json = Record<string, unknown>;

/** The content and usage an attempt reached before it ended. */
export interface PartialReply {
  readonly content?: ContentBlock[];
  readonly usage?: Usage;
}

/** What one failure says about itself. */
export interface WireFailure {
  readonly status?: number;
  /** The provider's error type, such as `"invalid_request_error"`. */
  readonly type?: string;
  /** The provider's finer error code, when the error has one, such as `"insufficient_quota"`. */
  readonly errorCode?: string;
  readonly message: string;
  /** Sets the kind outright, for a failure that no status describes, such as a refusal inside a 200 stream. */
  readonly kind?: ErrorKind;
  /** How long the response's `retry-after-ms` or `retry-after` header asked the caller to wait, in milliseconds. */
  readonly retryAfterMs?: number;
}

/** True for a JSON object, not an array or `null`. */
export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value when it is a string, or `""`. */
export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A token count: a finite positive number, or 0. */
export function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** A tool call's input: the parsed JSON, or the partial JSON text when the output limit cut it off. */
export function parseToolInput(text: string, empty: unknown = {}): unknown {
  if (text === "") return empty;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * An assistant message with an unknown cost, which `createModel()` prices from the catalog. Without `partial.usage`,
 * the provider reported no usage, so the message's usage is `unreported`.
 */
export function terminalMessage(
  model: ModelRef,
  partial: PartialReply,
  stopReason: AssistantMessage["stopReason"],
  error?: NonNullable<AssistantMessage["error"]>,
): AssistantMessage {
  return {
    role: "assistant",
    content: partial.content ?? [],
    model,
    stopReason,
    ...(error ? { error } : {}),
    usage: partial.usage ?? unreportedUsage(),
    cost: { total: null, basis: "unknown", currency: "USD" },
  };
}

/** The `error` terminal of an aborted call, which carries no `error`. */
export function abortedEvent(model: ModelRef, partial: PartialReply = {}): Extract<ModelEvent, { type: "error" }> {
  return { type: "error", message: terminalMessage(model, partial, "aborted") };
}

/**
 * The `error` terminal for a failure. A failure with no HTTP status, such as an error event inside a 200 stream,
 * classifies like the status its type stands for in `statusOfType`. The message starts with the error code or type.
 * A failure with a status is an HTTP error response, so without `partial.usage` it reports zero tokens.
 */
export function failureTerminal(
  model: ModelRef,
  failure: WireFailure,
  statusOfType: Readonly<Record<string, number>>,
  partial: PartialReply = {},
  code?: ModelErrorCode,
): Extract<ModelEvent, { type: "error" }> {
  const status = failure.status ?? (failure.type ? statusOfType[failure.type] : undefined);
  const label = failure.errorCode ?? failure.type;
  // Both go to the classifier: a billing error's code names its cause while its type says `insufficient_quota`.
  const codes = [failure.errorCode, failure.type].filter((part) => part !== undefined && part !== "").join(" ");
  const kind =
    failure.kind ??
    classifyError({
      ...(status === undefined ? {} : { status }),
      ...(codes ? { code: codes } : {}),
      message: failure.message,
    });
  const error: NonNullable<AssistantMessage["error"]> = {
    kind,
    message: label ? `${label}: ${failure.message}` : failure.message,
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(code ? { code } : {}),
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
  };
  const reply = failure.status === undefined || partial.usage ? partial : { ...partial, usage: emptyUsage() };
  return { type: "error", message: terminalMessage(model, reply, "error", error) };
}

/** The `error` terminal for a throw: retryable only for a transport failure, and `fatal` for a bug or bad data. */
export function thrownTerminal(model: ModelRef, thrown: unknown, partial: PartialReply = {}) {
  const message = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
  return failureTerminal(model, { message, ...(isTransportFailure(thrown) ? {} : { kind: "fatal" }) }, {}, partial);
}

// A delay in seconds, as `retry-after` sends it, or in milliseconds, as `retry-after-ms` does: a non-negative decimal.
const DELAY = /^\d+(\.\d+)?$/;

// The three HTTP-date forms of RFC 9110, section 5.6.7: IMF-fixdate, the obsolete RFC 850 form, and asctime, which
// has no zone and means GMT. `Date.parse` alone would also take text such as "-5" or "5, 10" as a date.
const GMT_DATE = /^[A-Z][a-z]{2,8}, (\d{2} [A-Z][a-z]{2} \d{4}|\d{2}-[A-Z][a-z]{2}-\d{2}) \d{2}:\d{2}:\d{2} GMT$/;
const ASCTIME_DATE = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;

/** The time an HTTP-date names, in milliseconds since the epoch, or `NaN` for any other text. */
function httpDate(value: string | null): number {
  if (value === null) return Number.NaN;
  const text = value.trim();
  if (GMT_DATE.test(text)) return Date.parse(text);
  return ASCTIME_DATE.test(text) ? Date.parse(`${text} GMT`) : Number.NaN;
}

/**
 * How long a failed response asks the caller to wait before retrying, in milliseconds, or `undefined` when it gives
 * no valid delay. `retry-after-ms` wins over `retry-after`, as in the official TypeScript SDKs (openai-node v7.49.0
 * and anthropic-sdk-typescript v0.129.0, `src/client.ts`, as of November 2026). `retry-after` holds seconds, as
 * Anthropic's and OpenAI's rate-limit pages say (https://platform.claude.com/docs/en/api/rate-limits and
 * https://developers.openai.com/api/docs/guides/rate-limits, as of November 2026), or an HTTP date (RFC 9110,
 * section 10.2.3). A date counts from the response's own `date` header, so the delay depends on no local clock, and
 * a response without one gives no delay. Any other value, such as a negative number or the comma-joined values of a
 * repeated header, gives no delay.
 */
export function retryAfterMs(headers: Headers): number | undefined {
  const millis = headers.get("retry-after-ms")?.trim();
  if (millis !== undefined && DELAY.test(millis)) return Number(millis);
  const value = headers.get("retry-after")?.trim();
  if (value === undefined || value === "") return undefined;
  if (DELAY.test(value)) return Number(value) * 1000;
  const until = httpDate(value);
  const sent = httpDate(headers.get("date"));
  if (Number.isNaN(until) || Number.isNaN(sent)) return undefined;
  return Math.max(0, until - sent);
}

/** A failed response's body, parsed as JSON when it is JSON, and its text. */
export async function readErrorBody(response: Response): Promise<{ body: unknown; text: string }> {
  const text = await response.text().catch(() => "");
  try {
    return { body: JSON.parse(text), text };
  } catch {
    return { body: undefined, text };
  }
}

/** The body `onPayload` asks for, or the adapter's own when it returns `undefined`. */
export function payloadOf(body: unknown, options: StreamOptions): unknown {
  const replaced = options.onPayload ? options.onPayload(body) : undefined;
  return replaced === undefined ? body : replaced;
}

/**
 * Sends one HTTP request. A transport that throws becomes an `error` terminal unless the throw is a guard's; only a
 * transport failure, by the rule the retries use, may be retried, and any other throw is `fatal`.
 */
export async function* sendRequest(
  transport: Transport,
  request: Request,
  model: ModelRef,
  signal: AbortSignal | undefined,
): AsyncGenerator<ModelEvent, Response | undefined> {
  assertModelRequestAllowed(transport);
  try {
    return await transport(request);
  } catch (thrown) {
    if (isGatewayError(thrown) || thrown instanceof ModelRequestsDisabledError) throw thrown;
    yield signal?.aborted ? abortedEvent(model) : thrownTerminal(model, thrown);
    return undefined;
  }
}

/** How one protocol reads its event stream. */
export interface StreamReader {
  /** The events one server-sent event produces. The stream is over once one of them is the terminal. */
  handle(event: ServerSentEvent): ModelEvent[];
  /** The content and usage so far, for an `error` terminal. */
  partial(): PartialReply;
  /** The events for a stream that closed before its terminal, ending in a terminal. */
  ended(): ModelEvent[];
}

/** Feeds each server-sent event to the reader; returns true once it has yielded the terminal. */
async function* pump(body: ReadableStream<Uint8Array>, reader: StreamReader): AsyncGenerator<ModelEvent, boolean> {
  for await (const sse of readServerSentEvents(body)) {
    for (const event of reader.handle(sse)) {
      yield event;
      if (event.type === "done" || event.type === "error") return true;
    }
  }
  return false;
}

/** Reads a 200 stream to its terminal. A stream that breaks or ends early ends in an `error` terminal. */
export async function* readEventStream(
  response: Response,
  model: ModelRef,
  reader: StreamReader,
  signal: AbortSignal | undefined,
): AsyncGenerator<ModelEvent> {
  if (response.body === null) {
    yield failureTerminal(model, { message: "the response has no body" }, {});
    return;
  }
  try {
    if (yield* pump(response.body, reader)) return;
  } catch (thrown) {
    // A broken connection may work on a retry; malformed event data, a SyntaxError, will not parse on one either.
    yield signal?.aborted ? abortedEvent(model, reader.partial()) : thrownTerminal(model, thrown, reader.partial());
    return;
  }
  yield* reader.ended();
}
