/**
 * HTTP retries before any output (SDK decision 4; agent-SDK guide §2).
 *
 * - Only an `error` terminal of kind `retryable` that arrives before any content is retried. Once a block event has
 *   been streamed, a retry would replay output the caller has already seen, so the failure is final.
 * - The backoff is exponential (2 s, then 4 s by default, as Vercel's AI SDK) and ends early when the signal aborts.
 * - The caller sees one `start`, then one `retry` event per retry, then the last attempt's events. The final message
 *   counts the usage and cost of every attempt, because the provider bills failed attempts too. Each attempt is
 *   priced on its own before the sum, because a tiered rate depends on that request's input alone (D4).
 * - A stream that throws is treated like one that ends with an `error` event, so the caller always gets a terminal.
 * - Each wait is capped at 60 s. The provider's retry-after hint isn't used yet: adapters see the response headers,
 *   and no event carries a hint to the gateway.
 */

import { classifyError } from "./classify.ts";
import { foldCost } from "./cost.ts";
import type { GatewayEvent, Sleep } from "./runtime-types.ts";
import type { ModelEvent } from "./spec.ts";
import type { AssistantMessage, Cost, ModelRef, Usage } from "./types.ts";
import { addUsage, emptyUsage } from "./usage.ts";

/** How many times to retry, how long to wait, and how. */
export interface RetrySettings {
  readonly retries: number;
  readonly initialDelayMs: number;
  readonly sleep: Sleep;
  /** Prices one attempt's usage; a provider-billed total skips it. */
  readonly price: (usage: Usage) => Cost;
}

const BACKOFF_FACTOR = 2;
const MAX_RETRY_DELAY_MS = 60_000;
const UNKNOWN_COST: Cost = { total: null, basis: "unknown", currency: "USD" };

/**
 * Adds a carried cost to an attempt's. The sum is unknown if either part is, a catalog estimate if either part is one,
 * and a provider bill only when both parts are. `undefined` means no attempt is carried yet.
 */
function addCost(a: Cost | undefined, b: Cost): Cost {
  if (a === undefined) return b;
  if (a.total === null || b.total === null || a.basis === "unknown" || b.basis === "unknown") {
    return { ...UNKNOWN_COST };
  }
  const total = a.total + b.total;
  if (a.basis === "provider" && b.basis === "provider") return { total, basis: "provider", currency: "USD" };
  const catalogAsOf = b.catalogAsOf ?? a.catalogAsOf;
  return { total, basis: "catalog", currency: "USD", ...(catalogAsOf === undefined ? {} : { catalogAsOf }) };
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

/**
 * How one attempt ended: it ran to its end, or it failed before any output and may be retried. A retryable failure
 * carries its own cost, already priced.
 */
type AttemptOutcome =
  | { readonly retry: false }
  | { readonly retry: true; readonly failure: AssistantMessage; readonly cost: Cost };

/** One call's state across its attempts. */
interface CallState {
  readonly ref: ModelRef;
  readonly signal: AbortSignal | undefined;
  readonly price: (usage: Usage) => Cost;
  started: boolean;
  /** The usage of the failed attempts so far; the final message adds it, because the provider billed them too. */
  carried: Usage;
  /** The cost of the failed attempts so far, added the same way; `undefined` until an attempt has failed. */
  carriedCost: Cost | undefined;
}

function isBlockEvent(event: ModelEvent): boolean {
  return event.type !== "start" && event.type !== "warning" && event.type !== "done" && event.type !== "error";
}

/** The final message: this attempt's usage and `cost`, with the failed attempts' usage and cost added. */
function withCarried(message: AssistantMessage, call: CallState, cost: Cost): AssistantMessage {
  const summed = { ...message, usage: addUsage(call.carried, message.usage), cost: addCost(call.carriedCost, cost) };
  // The projection needs one request's size, which a sum over several attempts overstates.
  return call.carriedCost === undefined ? summed : { ...summed, lastAttemptUsage: message.usage };
}

/** A terminal event with the failed attempts added; any other event unchanged. The adapter's usage is priced here. */
function withCarriedUsage(event: GatewayEvent, call: CallState): GatewayEvent {
  if (event.type !== "done" && event.type !== "error") return event;
  return { ...event, message: withCarried(event.message, call, foldCost(event.message, call.price)) };
}

/** True for the errors `fetch` throws when a request never gets a response. */
function isTransportFailure(thrown: unknown): boolean {
  return thrown instanceof TypeError && /fetch|network|socket|connect/i.test(thrown.message);
}

/**
 * The message for an adapter whose stream threw instead of ending with an `error` event. Its usage is zero, because
 * nothing reported any, but its cost is unknown, not zero: the request may have reached the provider and been billed.
 */
function thrownFailure(thrown: unknown, call: CallState): AssistantMessage {
  const base = {
    role: "assistant" as const,
    content: [],
    model: call.ref,
    usage: emptyUsage(),
    cost: { ...UNKNOWN_COST },
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
      return { retry: true, failure: event.message, cost: foldCost(event.message, call.price) };
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
  // The failure's unknown cost is final: pricing its zero usage would claim a known zero.
  if (mayRetry && !output.seen && failure.error?.kind === "retryable") {
    return { retry: true, failure, cost: failure.cost };
  }
  if (!call.started) {
    call.started = true;
    yield { type: "start" };
  }
  yield { type: "error", message: withCarried(failure, call, failure.cost) };
  return { retry: false };
}

/**
 * The terminal for a call aborted between attempts. It keeps every failed attempt's usage and drops the error.
 * `call.carried` already includes `failure`, so `lastAttemptUsage` is set only when `retried` says earlier attempts
 * were carried too, as `withCarried` does.
 */
function abortedTerminal(failure: AssistantMessage, call: CallState, cost: Cost, retried: boolean): GatewayEvent {
  const { error: _error, ...rest } = failure;
  const message = { ...rest, stopReason: "aborted" as const, usage: call.carried, cost };
  return { type: "error", message: retried ? { ...message, lastAttemptUsage: failure.usage } : message };
}

/** Runs `attempt(1)`, then retries per `settings`. `attempt(n)` must start a fresh request each time it is called. */
export async function* withRetries(
  attempt: (n: number) => AsyncIterable<ModelEvent>,
  ref: ModelRef,
  signal: AbortSignal | undefined,
  settings: RetrySettings,
): AsyncGenerator<GatewayEvent> {
  const call: CallState = {
    ref,
    signal,
    price: settings.price,
    started: false,
    carried: emptyUsage(),
    carriedCost: undefined,
  };
  for (let n = 1; ; n += 1) {
    const outcome = yield* runAttempt(attempt(n), call, n <= settings.retries);
    if (!outcome.retry) return;
    call.carried = addUsage(call.carried, outcome.failure.usage);
    const carriedCost = addCost(call.carriedCost, outcome.cost);
    call.carriedCost = carriedCost;
    // The stream rule puts `start` first, so a failure that arrived without one still gets it before the retry.
    if (!call.started) {
      call.started = true;
      yield { type: "start" };
    }
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call, carriedCost, n > 1);
      return;
    }
    // The cap keeps a long retry count from waiting hours, or overflowing setTimeout's 32-bit delay.
    const delayMs = Math.min(settings.initialDelayMs * BACKOFF_FACTOR ** (n - 1), MAX_RETRY_DELAY_MS);
    yield { type: "retry", attempt: n, delayMs, error: outcome.failure.error?.message ?? "retryable error" };
    await settings.sleep(delayMs, signal);
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call, carriedCost, n > 1);
      return;
    }
  }
}
