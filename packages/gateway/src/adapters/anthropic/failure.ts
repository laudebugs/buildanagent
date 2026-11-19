/**
 * Failed requests and streams, as `error` terminals (Errors, https://platform.claude.com/docs/en/api/errors, and
 * the Messages API reference's error codes, https://platform.claude.com/docs/en/api/messages/create, both as of
 * November 2026). An error body is `{ "type": "error", "error": { "type", "message" }, "request_id" }`, and some
 * errors add `error.details.error_code`. A stream that already returned 200 reports a later error as an `error`
 * event with the same `error` object and no status of its own.
 */
import { classifyError, type ErrorKind } from "../../classify.ts";
import type { ModelEvent } from "../../spec.ts";
import type { AssistantMessage, ContentBlock, ModelErrorCode, ModelRef, Usage } from "../../types.ts";
import { emptyUsage } from "../../usage.ts";

type Json = Record<string, unknown>;

/** What one failure says about itself. */
export interface WireFailure {
  readonly status?: number;
  readonly type?: string;
  /** `error.details.error_code`, when the error has one. */
  readonly errorCode?: string;
  readonly message: string;
  /** Sets the kind outright, for a failure that no status describes, such as a refusal inside a 200 stream. */
  readonly kind?: ErrorKind;
}

// The HTTP status each error type stands for, so a stream error classifies like the HTTP error it would have been.
const STATUS_OF_TYPE: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  conflict_error: 409,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  timeout_error: 504,
  overloaded_error: 529,
};

// The fix page says to match this error on this sentence alone, because the rest of the message can change (Fix a
// thinking block bound to a different conversation, "Handle the error in code",
// https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/fix-bound-to-a-different-conversation,
// as of November 2026).
const PREFIX_MISMATCH = "The block is bound to a different conversation";

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads an error object, from an HTTP error body or an `error` stream event. */
export function failureFrom(body: unknown, status: number | undefined, fallback: string): WireFailure {
  const error = isObject(body) && isObject(body.error) ? body.error : undefined;
  const details = error && isObject(error.details) ? error.details : undefined;
  return {
    ...(status === undefined ? {} : { status }),
    ...(typeof error?.type === "string" ? { type: error.type } : {}),
    ...(typeof details?.error_code === "string" ? { errorCode: details.error_code } : {}),
    message: typeof error?.message === "string" ? error.message : fallback,
  };
}

/** Reads a failed HTTP response's error body; a body that is not JSON keeps its text as the message. */
export async function failureFromResponse(response: Response): Promise<WireFailure> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return failureFrom(body, response.status, text || `HTTP ${response.status}`);
}

/** True for the prefix-check 400, which the adapter answers by retrying with `drop_block`. */
export function isPrefixMismatch(failure: WireFailure): boolean {
  return (failure.status ?? STATUS_OF_TYPE[failure.type ?? ""]) === 400 && failure.message.includes(PREFIX_MISMATCH);
}

/** The `error` terminal for a failure, with any partial content and usage the attempt reached. */
export function failureEvent(
  model: ModelRef,
  failure: WireFailure,
  partial: { content?: ContentBlock[]; usage?: Usage } = {},
): Extract<ModelEvent, { type: "error" }> {
  const status = failure.status ?? (failure.type ? STATUS_OF_TYPE[failure.type] : undefined);
  const kind =
    failure.kind ??
    classifyError({
      ...(status === undefined ? {} : { status }),
      ...(failure.errorCode || failure.type ? { code: failure.errorCode ?? failure.type } : {}),
      message: failure.message,
    });
  const code: ModelErrorCode | undefined = isPrefixMismatch(failure) ? "thinking_prefix_mismatch" : undefined;
  const label = failure.errorCode ?? failure.type;
  const error: NonNullable<AssistantMessage["error"]> = {
    kind,
    message: label ? `${label}: ${failure.message}` : failure.message,
    ...(failure.status === undefined ? {} : { status: failure.status }),
    ...(code ? { code } : {}),
  };
  return { type: "error", message: terminalMessage(model, partial, "error", error) };
}

/** The `error` terminal of an aborted call, which carries no `error`. */
export function abortedEvent(
  model: ModelRef,
  partial: { content?: ContentBlock[]; usage?: Usage } = {},
): Extract<ModelEvent, { type: "error" }> {
  return { type: "error", message: terminalMessage(model, partial, "aborted") };
}

/** An assistant message with an unknown cost, which `createModel()` prices from the catalog. */
export function terminalMessage(
  model: ModelRef,
  partial: { content?: ContentBlock[]; usage?: Usage },
  stopReason: AssistantMessage["stopReason"],
  error?: NonNullable<AssistantMessage["error"]>,
): AssistantMessage {
  return {
    role: "assistant",
    content: partial.content ?? [],
    model,
    stopReason,
    ...(error ? { error } : {}),
    usage: partial.usage ?? emptyUsage(),
    cost: { total: null, basis: "unknown", currency: "USD" },
  };
}
