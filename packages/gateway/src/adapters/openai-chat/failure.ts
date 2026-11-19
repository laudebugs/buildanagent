/**
 * Failed requests and streams, as `error` terminals. A failed response's body is
 * `{ "error": { "message", "type", "param", "code" } }`, as openai-node v7.49.0 reads it (`src/core/error.ts`). A
 * stream that already returned 200 reports a later error as a chunk whose `error` field holds the same object, or as
 * an SSE event named `error` (`src/core/streaming.ts`); both as of November 2026.
 *
 * OpenAI's error-code guide (https://developers.openai.com/api/docs/guides/error-codes, as of November 2026) sends
 * billing, spend and usage limits as 429s whose `code` names the cause (`credit_balance_exhausted`,
 * `organization_spend_limit_exceeded` and so on) and whose `type` can be `insufficient_quota`, and says retrying them
 * won't restore access. `classifyError()` reads the code and the type, so those are `quota` errors even at 429, while
 * a 429 `rate_limit_error` such as `slow_down` stays retryable. `context_length_exceeded`, which the fixtures use for
 * an over-long prompt, is not on that page, so its wording is unverified; the classifier also matches the phrase
 * "maximum context".
 */
import type { ModelEvent } from "../../spec.js";
import type { ModelRef } from "../../types.js";
import { failureTerminal, isObject, type PartialReply, readErrorBody, type WireFailure } from "../wire.js";

// The HTTP status each error type stands for, so a stream error, which has no status, classifies like the HTTP error
// it would have been. A type not listed here classifies as a failure in transit, which is retryable.
const STATUS_OF_TYPE: Readonly<Record<string, number>> = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  insufficient_quota: 429,
  rate_limit_error: 429,
  server_error: 500,
  service_unavailable_error: 503,
};

/** Reads an error object, from an HTTP error body or an error chunk in a stream. */
export function failureFrom(body: unknown, status: number | undefined, fallback: string): WireFailure {
  const error = isObject(body) && isObject(body.error) ? body.error : undefined;
  return {
    ...(status === undefined ? {} : { status }),
    ...(typeof error?.type === "string" && error.type !== "" ? { type: error.type } : {}),
    ...(typeof error?.code === "string" && error.code !== "" ? { errorCode: error.code } : {}),
    message: typeof error?.message === "string" && error.message !== "" ? error.message : fallback,
  };
}

/** Reads a failed HTTP response's error body; a body that is not JSON keeps its text as the message. */
export async function failureFromResponse(response: Response): Promise<WireFailure> {
  const { body, text } = await readErrorBody(response);
  return failureFrom(body, response.status, text || `HTTP ${response.status}`);
}

/** The `error` terminal for a failure, with any partial content and usage the attempt reached. */
export function failureEvent(
  model: ModelRef,
  failure: WireFailure,
  partial: PartialReply = {},
): Extract<ModelEvent, { type: "error" }> {
  return failureTerminal(model, failure, STATUS_OF_TYPE, partial);
}
