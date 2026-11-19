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

// Quota and billing errors are final even when the status is 429, because waiting does not refill a budget.
const QUOTA = /insufficient_quota|quota|billing|credit balance|payment/i;
const OVERFLOW = /context[ _-]?(length|window)|prompt is too long|maximum context|request too large/i;
const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/** Returns the error kind for a failed request. Unknown failures are `fatal`, so nothing is retried by accident. */
export function classifyError(failure: FailedRequest): ErrorKind {
  const text = `${failure.code ?? ""} ${failure.message ?? ""}`;
  if (failure.status === 402 || QUOTA.test(text)) return "quota";
  if (failure.status === 413 || OVERFLOW.test(text)) return "overflow";
  // No status means the request failed in transit (a reset connection or DNS failure), which is safe to retry.
  if (failure.status === undefined) return "retryable";
  if (RETRYABLE_STATUSES.has(failure.status) || failure.status >= 500) return "retryable";
  return "fatal";
}
