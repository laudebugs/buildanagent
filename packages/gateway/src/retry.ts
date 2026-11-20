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
 * - A warning an earlier attempt already streamed, with the same code and message, is not streamed again, because a
 *   retry sends the same request and an adapter warns about it each time.
 * - A failure's `error.retryAfterMs`, which an adapter reads from the provider's retry-after header, sets the least
 *   wait: the gateway waits for the longer of the backoff and the hint. Each wait is capped at 60 s.
 * - A hint longer than that cap ends the call with the failure, hint kept, and no `retry` event. OpenAI's rate-limit
 *   guide says to stop rather than retry sooner when a server delay exceeds the client's maximum
 *   (https://developers.openai.com/api/docs/guides/rate-limits, as of November 2026).
 */

import { classifyError, isTransportFailure } from "./classify.js";
import { addCost, foldCost } from "./cost.js";
import type { GatewayEvent, Sleep } from "./runtime-types.js";
import type { ModelEvent } from "./spec.js";
import type { AssistantMessage, Cost, ModelRef, Usage } from "./types.js";
import { addUsage, emptyUsage, unreportedUsage } from "./usage.js";

/** How many times to retry, how long to wait, and how. */
export interface RetrySettings {
  readonly retries: number;
  readonly initialDelayMs: number;
  readonly sleep: Sleep;
  /** Prices one attempt's usage; a provider-billed total skips it. */
  readonly price: (usage: Usage) => Cost;
}

const BACKOFF_FACTOR = 2;

/** The longest wait before one retry, in milliseconds. A provider hint over it ends the call instead of waiting. */
export const MAX_RETRY_DELAY_MS = 60_000;

/** The wait before the first retry when a caller sets none, in milliseconds; each later retry waits twice as long. */
export const DEFAULT_INITIAL_RETRY_DELAY_MS = 2000;
const UNKNOWN_COST: Cost = { total: null, basis: "unknown", currency: "USD" };

/** Adds a carried cost to an attempt's; `undefined` means no attempt is carried yet. */
function addCarriedCost(a: Cost | undefined, b: Cost): Cost {
  return a === undefined ? b : addCost(a, b);
}

/**
 * The gateway's default `Sleep`: a timer that resolves early, without rejecting, when the signal aborts. A caller that
 * retries above the model, as the SDK's loop does, uses it to wait the same way.
 */
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
  /** The code and message of each warning the earlier attempts streamed. */
  readonly warned: Set<string>;
}

/** One attempt's progress: whether content has reached the caller, and the warnings it streamed. */
interface AttemptProgress {
  seen: boolean;
  readonly warned: Set<string>;
}

/** True for a warning an earlier attempt streamed; any other warning is recorded as this attempt's. */
function isRepeatedWarning(event: ModelEvent, call: CallState, output: AttemptProgress): boolean {
  if (event.type !== "warning") return false;
  const key = JSON.stringify([event.code, event.message]);
  if (call.warned.has(key)) return true;
  output.warned.add(key);
  return false;
}

function isBlockEvent(event: ModelEvent): boolean {
  return event.type !== "start" && event.type !== "warning" && event.type !== "done" && event.type !== "error";
}

/** The final message: this attempt's usage and `cost`, with the failed attempts' usage and cost added. */
function withCarried(message: AssistantMessage, call: CallState, cost: Cost): AssistantMessage {
  const summed = {
    ...message,
    usage: addUsage(call.carried, message.usage),
    cost: addCarriedCost(call.carriedCost, cost),
  };
  // The projection needs one request's size, which a sum over several attempts overstates.
  return call.carriedCost === undefined ? summed : { ...summed, lastAttemptUsage: message.usage };
}

/** A terminal event with the failed attempts added; any other event unchanged. The adapter's usage is priced here. */
function withCarriedUsage(event: GatewayEvent, call: CallState): GatewayEvent {
  if (event.type !== "done" && event.type !== "error") return event;
  return { ...event, message: withCarried(event.message, call, foldCost(event.message, call.price)) };
}

/**
 * The message for an adapter whose stream threw instead of ending with an `error` event. Nothing reported its usage,
 * so the usage is `unreported` and the cost unknown, not zero: the request may have reached the provider and been
 * billed.
 */
function thrownFailure(thrown: unknown, call: CallState): AssistantMessage {
  const base = {
    role: "assistant" as const,
    content: [],
    model: call.ref,
    usage: unreportedUsage(),
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
  output: AttemptProgress,
): AsyncGenerator<GatewayEvent, AttemptOutcome> {
  for await (const event of events) {
    if (event.type === "start") {
      if (call.started) continue;
      call.started = true;
    }
    if (isRepeatedWarning(event, call, output)) continue;
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
  const output: AttemptProgress = { seen: false, warned: new Set() };
  let failure: AssistantMessage;
  try {
    return yield* forwardEvents(events, call, mayRetry, output);
  } catch (thrown) {
    // A thrown stream is a failure like any other: it ends in an `error` terminal and may be retried.
    failure = thrownFailure(thrown, call);
  } finally {
    for (const key of output.warned) call.warned.add(key);
  }
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

/**
 * The terminal for a retryable failure whose hint asks for longer than the cap. Like `abortedTerminal`, it keeps every
 * failed attempt's usage, but it keeps the error too, `retryAfterMs` included, so the caller can wait and call again.
 */
function deferredTerminal(failure: AssistantMessage, call: CallState, cost: Cost, retried: boolean): GatewayEvent {
  const message = { ...failure, usage: call.carried, cost };
  return { type: "error", message: retried ? { ...message, lastAttemptUsage: failure.usage } : message };
}

/**
 * The wait a failed call's provider asked for, in milliseconds: `error.retryAfterMs`, or 0 when there is none. A NaN
 * hint from a hand-written adapter is no hint. A hint over `MAX_RETRY_DELAY_MS` means the call should not be retried.
 */
export function retryHintMs(failure: AssistantMessage): number {
  const hintMs = failure.error?.retryAfterMs;
  return hintMs === undefined || Number.isNaN(hintMs) ? 0 : hintMs;
}

/**
 * The wait before retry `n`, counted from 1, in milliseconds: the exponential backoff from `initialDelayMs`, or the
 * provider's hint (`retryHintMs()`) when it asks for longer, capped at `MAX_RETRY_DELAY_MS`. The cap keeps a long
 * retry count from waiting hours, or overflowing setTimeout's 32-bit delay; a hint over the cap never gets here,
 * because such a failure is not retried.
 */
export function retryDelay(initialDelayMs: number, n: number, hintMs: number): number {
  // A power past 2 ** 1023 is Infinity, and 0 times Infinity is NaN, so a long run of retries with no initial delay
  // would wait NaN; 2 ** 64 already puts any whole-millisecond delay over the cap.
  const backoff = initialDelayMs * BACKOFF_FACTOR ** Math.min(n - 1, 64);
  return Math.min(Math.max(backoff, hintMs), MAX_RETRY_DELAY_MS);
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
    warned: new Set(),
  };
  for (let n = 1; ; n += 1) {
    const outcome = yield* runAttempt(attempt(n), call, n <= settings.retries);
    if (!outcome.retry) return;
    call.carried = addUsage(call.carried, outcome.failure.usage);
    const carriedCost = addCarriedCost(call.carriedCost, outcome.cost);
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
    const hintMs = retryHintMs(outcome.failure);
    // Waiting less than the provider asked would only fail again, so a hint over the cap ends the call.
    if (hintMs > MAX_RETRY_DELAY_MS) {
      yield deferredTerminal(outcome.failure, call, carriedCost, n > 1);
      return;
    }
    const delayMs = retryDelay(settings.initialDelayMs, n, hintMs);
    yield { type: "retry", attempt: n, delayMs, error: outcome.failure.error?.message ?? "retryable error" };
    await settings.sleep(delayMs, signal);
    if (signal?.aborted) {
      yield abortedTerminal(outcome.failure, call, carriedCost, n > 1);
      return;
    }
  }
}
