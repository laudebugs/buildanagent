/**
 * Failed requests and streams, as `error` terminals (Errors, https://platform.claude.com/docs/en/api/errors, and
 * the Messages API reference's error codes, https://platform.claude.com/docs/en/api/messages/create, both as of
 * November 2026). An error body is `{ "type": "error", "error": { "type", "message" }, "request_id" }`, and some
 * errors add `error.details.error_code`. A stream that already returned 200 reports a later error as an `error`
 * event with the same `error` object and no status of its own.
 *
 * A 429 may carry a `retry-after` header that gives the number of seconds to wait before a retry; the
 * spend-cap 429 never does (Rate limits, response headers, https://platform.claude.com/docs/en/api/rate-limits, as of
 * November 2026). The adapter puts the hint on the error as `retryAfterMs`.
 */
import type { ModelEvent } from "../../spec.js";
import type { ModelRef } from "../../types.js";
import { failureTerminal, isObject, type PartialReply, readFailureResponse, type WireFailure } from "../wire.js";

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

/** Reads a failed HTTP response's error body and its retry-after hint. */
export const failureFromResponse = (response: Response): Promise<WireFailure> =>
  readFailureResponse(response, failureFrom);

/** True for the prefix-check 400, which the adapter answers by retrying with `drop_block`. */
export function isPrefixMismatch(failure: WireFailure): boolean {
  return (failure.status ?? STATUS_OF_TYPE[failure.type ?? ""]) === 400 && failure.message.includes(PREFIX_MISMATCH);
}

/** The `error` terminal for a failure, with any partial content and usage the attempt reached. */
export function failureEvent(
  model: ModelRef,
  failure: WireFailure,
  partial: PartialReply = {},
): Extract<ModelEvent, { type: "error" }> {
  const code = isPrefixMismatch(failure) ? "thinking_prefix_mismatch" : undefined;
  return failureTerminal(model, failure, STATUS_OF_TYPE, partial, code);
}
