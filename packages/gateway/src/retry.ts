/**
 * HTTP retries before any output (SDK decision 4; agent-SDK guide §2).
 *
 * - Only an `error` terminal of kind `retryable` that arrives before any content is retried. Once a block event has
 *   been streamed, a retry would replay output the caller has already seen, so the failure is final.
 * - The backoff is exponential (2 s, then 4 s by default, as Vercel's AI SDK) and ends early when the signal aborts.
 * - The caller sees one `start`, then one `retry` event per retry, then the last attempt's events.
 */
import type { GatewayEvent, Sleep } from "./runtime-types.ts";
import type { ModelEvent } from "./spec.ts";
import type { AssistantMessage } from "./types.ts";

/** How many times to retry, how long to wait, and how. */
export interface RetrySettings {
  readonly retries: number;
  readonly initialDelayMs: number;
  readonly sleep: Sleep;
}

const BACKOFF_FACTOR = 2;

/** The default `Sleep`: a timer that resolves early, without rejecting, when the signal aborts. */
export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** How one attempt ended: it ran to its end, or it failed before any output and may be retried. */
type AttemptOutcome = { readonly retry: false } | { readonly retry: true; readonly failure: AssistantMessage };

interface StreamState {
  started: boolean;
}

function isBlockEvent(event: ModelEvent): boolean {
  return event.type !== "start" && event.type !== "done" && event.type !== "error";
}

/** Forwards one attempt's events, keeping only the first attempt's `start`, and holds back a retryable failure. */
async function* runAttempt(
  events: AsyncIterable<ModelEvent>,
  state: StreamState,
  mayRetry: boolean,
): AsyncGenerator<GatewayEvent, AttemptOutcome> {
  let output = false;
  for await (const event of events) {
    if (event.type === "start") {
      if (state.started) continue;
      state.started = true;
    }
    if (event.type === "error" && mayRetry && !output && event.message.error?.kind === "retryable") {
      return { retry: true, failure: event.message };
    }
    if (isBlockEvent(event)) output = true;
    yield event;
  }
  return { retry: false };
}

/** The terminal for a call aborted between attempts. It keeps the failed attempt's usage and drops its error. */
function abortedTerminal(failure: AssistantMessage): GatewayEvent {
  const { error: _error, ...rest } = failure;
  return { type: "error", message: { ...rest, stopReason: "aborted" } };
}

/** Runs `attempt(1)`, then retries per `settings`. `attempt(n)` must start a fresh request each time it is called. */
export async function* withRetries(
  attempt: (n: number) => AsyncIterable<ModelEvent>,
  signal: AbortSignal | undefined,
  settings: RetrySettings,
): AsyncGenerator<GatewayEvent> {
  const state: StreamState = { started: false };
  for (let n = 1; ; n += 1) {
    const outcome = yield* runAttempt(attempt(n), state, n <= settings.retries);
    if (!outcome.retry) return;
    // The stream rule puts `start` first, so a failure that arrived without one still gets it before the retry.
    if (!state.started) {
      state.started = true;
      yield { type: "start" };
    }
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure);
      return;
    }
    const delayMs = settings.initialDelayMs * BACKOFF_FACTOR ** (n - 1);
    yield { type: "retry", attempt: n, delayMs, error: outcome.failure.error?.message ?? "retryable error" };
    await settings.sleep(delayMs, signal);
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure);
      return;
    }
  }
}
