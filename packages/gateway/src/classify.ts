/**
 * `classifyError()`: sorts a failed request into the four error kinds the gateway and the loop act on (SDK decision 4;
 * agent-SDK guide §2). Adapters call it with the HTTP status and the provider's error code or message.
 */
import type { AssistantMessage } from "./types.ts";

/** How a failed call is handled: retried, compacted, stopped for billing, or stopped. */
export type ErrorKind = NonNullable<AssistantMessage["error"]>["kind"];

/** What an adapter knows about one failed request. A request that never got a response has no `status`. */
export interface FailedRequest {
  status?: number;
  /** The provider's error code or type, for example `"insufficient_quota"`. */
  code?: string;
  message?: string;
}

// Quota and billing errors are final even when the status is 429, because waiting does not refill a budget. Only
// explicit billing codes and phrases count: a rate-limit message that merely mentions "quota" stays retryable.
// Anthropic's `enforced_spend_limit_reached` is a 429 for a monthly tier threshold (Messages API reference, Errors,
// https://platform.claude.com/docs/en/api/messages/create, as of November 2026), so waiting does not clear it either.
const QUOTA =
  /insufficient_quota|exceeded your current quota|credit balance is too low|billing_hard_limit|enforced_spend_limit_reached/i;
// A per-minute "request too large" 429 is a rate limit, not a full context, so only context phrases count here.
const OVERFLOW = /context[ _-]?(length|window)|prompt is too long|maximum context/i;
// Other 5xx statuses, such as 501 and 505, are permanent.
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Returns the error kind for a failed request. A request that got no response is `retryable`, because it failed in
 * transit; a response whose status the gateway doesn't know is `fatal`, so nothing is retried by accident.
 */
export function classifyError(failure: FailedRequest): ErrorKind {
  const text = `${failure.code ?? ""} ${failure.message ?? ""}`;
  if (failure.status === 402 || QUOTA.test(text)) return "quota";
  if (failure.status === 413 || OVERFLOW.test(text)) return "overflow";
  // No status means the request failed in transit (a reset connection or DNS failure), which is safe to retry.
  if (failure.status === undefined) return "retryable";
  if (RETRYABLE_STATUSES.has(failure.status)) return "retryable";
  return "fatal";
}

/**
 * True for the errors a `fetch` throws when a request gets no response, or when its body breaks off: undici names a
 * failed request "fetch failed" and a body cut short "terminated". Any other throw is a bug or a guard, so the
 * gateway never retries it.
 */
export function isTransportFailure(thrown: unknown): boolean {
  return thrown instanceof TypeError && /fetch|network|socket|connect|terminated/i.test(thrown.message);
}
