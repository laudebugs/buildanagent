/**
 * Failed requests and streams, as `error` terminals. openai-node v7.49.0 reads a failed response's body as
 * `{ "error": { "message", "type", "param", "code" } }` and names the statuses 400, 401, 403, 404, 409, 422 and 429,
 * with 500 and above as server errors (`src/core/error.ts`). A stream that already returned 200 reports a later error
 * as a chunk whose `error` field holds the same object, or as an SSE event named `error` (`src/core/streaming.ts`);
 * both are as of November 2026.
 *
 * `classifyError()` reads the `code` before the `type`, so `insufficient_quota` is a `quota` error even at 429 and
 * `context_length_exceeded` an `overflow`. Those two codes come from OpenAI's error-code guide, which could not be
 * fetched for this adapter; the fixtures use them as that guide has long described them.
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
  server_error: 500,
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
