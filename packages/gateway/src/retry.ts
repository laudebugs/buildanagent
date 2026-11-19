/**
 * HTTP retries before any output (SDK decision 4; agent-SDK guide §2).
 *
 * - Only an `error` terminal of kind `retryable` that arrives before any content is retried. Once a block event has
 *   been streamed, a retry would replay output the caller has already seen, so the failure is final.
 * - The backoff is exponential (2 s, then 4 s by default, as Vercel's AI SDK) and ends early when the signal aborts.
 * - The caller sees one `start`, then one `retry` event per retry, then the last attempt's events. The final message
 *   counts the usage of every attempt, because the provider bills failed attempts too.
 * - A stream that throws is treated like one that ends with an `error` event, so the caller always gets a terminal.
 * - Each wait is capped at 60 s. The provider's retry-after hint isn't used yet: adapters see the response headers,
 *   and no event carries a hint to the gateway.
 */

import { classifyError } from "./classify.ts";
import type { GatewayEvent, Sleep } from "./runtime-types.ts";
import type { ModelEvent } from "./spec.ts";
import type { AssistantMessage, Cost, ModelRef, Usage } from "./types.ts";
import { addUsage, emptyUsage } from "./usage.ts";

/** How many times to retry, how long to wait, and how. */
export interface RetrySettings {
  readonly retries: number;
  readonly initialDelayMs: number;
  readonly sleep: Sleep;
}

const BACKOFF_FACTOR = 2;
const MAX_RETRY_DELAY_MS = 60_000;
// A known zero, so adding the first attempt's cost keeps its basis.
const ZERO_COST: Cost = { total: 0, basis: "provider", currency: "USD" };

/** Adds two costs; the total is unknown if either is, and the basis is the second's. */
function addCost(a: Cost, b: Cost): Cost {
  const total = a.total === null || b.total === null ? null : a.total + b.total;
  return { ...b, total };
}

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
  /** The cost of the failed attempts so far, added the same way. */
  carriedCost: Cost;
}

function isBlockEvent(event: ModelEvent): boolean {
  return event.type !== "start" && event.type !== "done" && event.type !== "error";
}

/** The final message, with the failed attempts' usage added to the last attempt's. */
function withCarriedUsage(event: GatewayEvent, call: CallState): GatewayEvent {
  if (event.type !== "done" && event.type !== "error") return event;
  const { message } = event;
  return {
    ...event,
    message: {
      ...message,
      usage: addUsage(call.carried, message.usage),
      cost: addCost(call.carriedCost, message.cost),
    },
  };
}

/** True for the errors `fetch` throws when a request never gets a response. */
function isTransportFailure(thrown: unknown): boolean {
  return thrown instanceof TypeError && /fetch|network|socket|connect/i.test(thrown.message);
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
  const name = thrown instanceof Error ? thrown.name : "Error";
  const message = `${name}: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
  // Only a failed fetch is a transport failure worth retrying; any other throw is a bug or a guard, so it is final.
  const kind = isTransportFailure(thrown) ? classifyError({ message }) : "fatal";
  return { ...base, stopReason: "error", error: { kind, message } };
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
  return { type: "error", message: { ...rest, stopReason: "aborted", usage: call.carried, cost: call.carriedCost } };
}

/** Runs `attempt(1)`, then retries per `settings`. `attempt(n)` must start a fresh request each time it is called. */
export async function* withRetries(
  attempt: (n: number) => AsyncIterable<ModelEvent>,
  ref: ModelRef,
  signal: AbortSignal | undefined,
  settings: RetrySettings,
): AsyncGenerator<GatewayEvent> {
  const call: CallState = { ref, signal, started: false, carried: emptyUsage(), carriedCost: ZERO_COST };
  for (let n = 1; ; n += 1) {
    const outcome = yield* runAttempt(attempt(n), call, n <= settings.retries);
    if (!outcome.retry) return;
    call.carried = addUsage(call.carried, outcome.failure.usage);
    call.carriedCost = addCost(call.carriedCost, outcome.failure.cost);
    // The stream rule puts `start` first, so a failure that arrived without one still gets it before the retry.
    if (!call.started) {
      call.started = true;
      yield { type: "start" };
    }
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call);
      return;
    }
    // The cap keeps a long retry count from waiting hours, or overflowing setTimeout's 32-bit delay.
    const delayMs = Math.min(settings.initialDelayMs * BACKOFF_FACTOR ** (n - 1), MAX_RETRY_DELAY_MS);
    yield { type: "retry", attempt: n, delayMs, error: outcome.failure.error?.message ?? "retryable error" };
    await settings.sleep(delayMs, signal);
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call);
      return;
    }
  }
}
