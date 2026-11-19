/**
 * HTTP retries before any output (SDK decision 4; agent-SDK guide §2).
 *
 * - Only an `error` terminal of kind `retryable` that arrives before any content is retried. Once a block event has
 *   been streamed, a retry would replay output the caller has already seen, so the failure is final.
 * - The backoff is exponential (2 s, then 4 s by default, as Vercel's AI SDK) and ends early when the signal aborts.
 * - The caller sees one `start`, then one `retry` event per retry, then the last attempt's events. The final message
 *   counts the usage of every attempt, because the provider bills failed attempts too.
 * - A stream that throws is treated like one that ends with an `error` event, so the caller always gets a terminal.
 * - Retry-after hints and a delay cap are left to the adapters, which see the response headers.
 */

import { classifyError } from "./classify.ts";
import type { GatewayEvent, Sleep } from "./runtime-types.ts";
import type { ModelEvent } from "./spec.ts";
import type { AssistantMessage, ModelRef, Usage } from "./types.ts";
import { addUsage, emptyUsage } from "./usage.ts";

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

/** One call's state across its attempts. */
interface CallState {
  readonly ref: ModelRef;
  readonly signal: AbortSignal | undefined;
  started: boolean;
  /** The usage of the failed attempts so far; the final message adds it, because the provider billed them too. */
  carried: Usage;
}

function isBlockEvent(event: ModelEvent): boolean {
  return event.type !== "start" && event.type !== "done" && event.type !== "error";
}

/** The final message, with the failed attempts' usage added to the last attempt's. */
function withCarriedUsage(event: GatewayEvent, call: CallState): GatewayEvent {
  if (event.type !== "done" && event.type !== "error") return event;
  return { ...event, message: { ...event.message, usage: addUsage(call.carried, event.message.usage) } };
}

/** The message for an adapter whose stream threw instead of ending with an `error` event. */
function thrownFailure(thrown: unknown, call: CallState): AssistantMessage {
  const base = {
    role: "assistant" as const,
    content: [],
    model: call.ref,
    usage: emptyUsage(),
    cost: { total: null, basis: "unknown" as const, currency: "USD" as const },
  };
  if (call.signal?.aborted) return { ...base, stopReason: "aborted" };
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return { ...base, stopReason: "error", error: { kind: classifyError({ message }), message } };
}

/** Forwards an attempt's events until it ends or fails retryably before any output. */
async function* forwardEvents(
  events: AsyncIterable<ModelEvent>,
  call: CallState,
  mayRetry: boolean,
  output: { seen: boolean },
): AsyncGenerator<GatewayEvent, AttemptOutcome> {
  for await (const event of events) {
    if (event.type === "start") {
      if (call.started) continue;
      call.started = true;
    }
    if (event.type === "error" && mayRetry && !output.seen && event.message.error?.kind === "retryable") {
      return { retry: true, failure: event.message };
    }
    if (isBlockEvent(event)) output.seen = true;
    yield withCarriedUsage(event, call);
  }
  return { retry: false };
}

/** Runs one attempt, keeping only the first attempt's `start`, and holds back a retryable failure. */
async function* runAttempt(
  events: AsyncIterable<ModelEvent>,
  call: CallState,
  mayRetry: boolean,
): AsyncGenerator<GatewayEvent, AttemptOutcome> {
  const output = { seen: false };
  let failure: AssistantMessage;
  try {
    return yield* forwardEvents(events, call, mayRetry, output);
  } catch (thrown) {
    // A thrown stream is a failure like any other: it ends in an `error` terminal and may be retried.
    failure = thrownFailure(thrown, call);
  }
  if (mayRetry && !output.seen && failure.error?.kind === "retryable") return { retry: true, failure };
  if (!call.started) {
    call.started = true;
    yield { type: "start" };
  }
  yield withCarriedUsage({ type: "error", message: failure }, call);
  return { retry: false };
}

/** The terminal for a call aborted between attempts. It keeps every failed attempt's usage and drops the error. */
function abortedTerminal(failure: AssistantMessage, call: CallState): GatewayEvent {
  const { error: _error, ...rest } = failure;
  return { type: "error", message: { ...rest, stopReason: "aborted", usage: call.carried } };
}

/** Runs `attempt(1)`, then retries per `settings`. `attempt(n)` must start a fresh request each time it is called. */
export async function* withRetries(
  attempt: (n: number) => AsyncIterable<ModelEvent>,
  ref: ModelRef,
  signal: AbortSignal | undefined,
  settings: RetrySettings,
): AsyncGenerator<GatewayEvent> {
  const call: CallState = { ref, signal, started: false, carried: emptyUsage() };
  for (let n = 1; ; n += 1) {
    const outcome = yield* runAttempt(attempt(n), call, n <= settings.retries);
    if (!outcome.retry) return;
    call.carried = addUsage(call.carried, outcome.failure.usage);
    // The stream rule puts `start` first, so a failure that arrived without one still gets it before the retry.
    if (!call.started) {
      call.started = true;
      yield { type: "start" };
    }
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call);
      return;
    }
    const delayMs = settings.initialDelayMs * BACKOFF_FACTOR ** (n - 1);
    yield { type: "retry", attempt: n, delayMs, error: outcome.failure.error?.message ?? "retryable error" };
    await settings.sleep(delayMs, signal);
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call);
      return;
    }
  }
}
