/**
 * One attempt of one model call, with `onPayload` and the request dump wired in (agent-SDK guide §2: practitioners
 * ask to see the full request of any step).
 *
 * The gateway hands the adapter its own `onPayload`, which runs the caller's hook and then dumps the body it returns,
 * so the dump shows what was actually sent. An adapter calls `onPayload` once per HTTP request, so an attempt that
 * sends two requests, such as the Anthropic adapter's retry with `drop_block`, is dumped twice, both times with the
 * attempt's number. An adapter with no wire body never calls `onPayload`; its dump, with `body: undefined`, goes out
 * before its first event that is neither `start` nor `warning` instead. An adapter may yield a `start` and a
 * `warning` before it sends, as the Anthropic adapter does with its sampling warnings, so skipping them keeps one
 * dump per HTTP request, with the body. Either way every attempt is dumped before any of its content reaches the
 * caller.
 */
import type { DumpedOptions, ModelCallOptions, RequestDump } from "./runtime-types.js";
import type { ModelAdapter, ModelEvent, StreamOptions } from "./spec.js";
import type { ModelCaps, ModelContext, ModelRef } from "./types.js";

/** One model call's request, which every attempt of the call sends again. */
export interface AttemptRequest {
  readonly adapter: ModelAdapter;
  readonly ref: ModelRef;
  readonly context: ModelContext;
  readonly options: ModelCallOptions;
  /** The model's resolved caps, which every attempt hands the adapter as `options.caps`. */
  readonly caps: ModelCaps;
  readonly onRequest: ((dump: RequestDump) => void) | undefined;
}

function dumpedOptions(options: ModelCallOptions): DumpedOptions {
  // An untyped caller may still pass `caps`; the dump leaves it out, like the adapter, which gets the resolved caps.
  const { signal: _signal, onPayload: _onPayload, caps: _caps, ...rest } = options as StreamOptions;
  return rest;
}

async function* dumpBeforeFirstEvent(events: AsyncIterable<ModelEvent>, ensureDumped: () => void) {
  try {
    for await (const event of events) {
      // `start` and `warning` may come before the adapter builds and sends its body; content never does.
      if (event.type !== "start" && event.type !== "warning") ensureDumped();
      yield event;
    }
  } finally {
    // An attempt that throws before its first event still leaves a record of what it was asked to send.
    ensureDumped();
  }
}

/** A copy of the dump, or the dump itself when part of it can't be cloned, such as a function in `providerOptions`. */
function copyOf(dump: RequestDump): RequestDump {
  try {
    return structuredClone(dump);
  } catch {
    return dump;
  }
}

/** Starts attempt `n` of the request. Each call sends a fresh request to the adapter. */
export function startAttempt(request: AttemptRequest, n: number): AsyncIterable<ModelEvent> {
  const { adapter, ref, context, options, caps, onRequest } = request;
  let dumped = false;
  const dump = (body: unknown): void => {
    dumped = true;
    // A copy, so a caller that changes the context after the call can't rewrite what an earlier attempt sent.
    if (onRequest) onRequest(copyOf({ attempt: n, model: ref, context, options: dumpedOptions(options), body }));
  };
  const callerHook = options.onPayload;
  const onPayload = (body: unknown): unknown => {
    const replaced = callerHook ? callerHook(body) : undefined;
    const sent = replaced === undefined ? body : replaced;
    dump(sent);
    return sent;
  };
  const events = adapter.stream(ref, context, { ...options, caps, onPayload });
  return dumpBeforeFirstEvent(events, () => {
    if (!dumped) dump(undefined);
  });
}
