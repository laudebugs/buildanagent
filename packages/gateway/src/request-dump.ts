/**
 * One attempt of one model call, with `onPayload` and the request dump wired in (agent-SDK guide §2: practitioners
 * ask to see the full request of any step).
 *
 * The gateway hands the adapter its own `onPayload`, which runs the caller's hook and then dumps the body it returns,
 * so the dump shows what was actually sent. An adapter with no wire body never calls `onPayload`; its dump, with
 * `body: undefined`, goes out before its first event after `start` instead, so an adapter that yields `start` before
 * it builds its body is still dumped with the body. Either way each attempt is dumped once, before any of its content
 * reaches the caller.
 */
import type { DumpedOptions, RequestDump } from "./runtime-types.ts";
import type { ModelAdapter, ModelEvent, StreamOptions } from "./spec.ts";
import type { ModelContext, ModelRef } from "./types.ts";

/** One model call's request, which every attempt of the call sends again. */
export interface AttemptRequest {
  readonly adapter: ModelAdapter;
  readonly ref: ModelRef;
  readonly context: ModelContext;
  readonly options: StreamOptions;
  readonly onRequest: ((dump: RequestDump) => void) | undefined;
}

function dumpedOptions(options: StreamOptions): DumpedOptions {
  const { signal: _signal, onPayload: _onPayload, ...rest } = options;
  return rest;
}

async function* dumpBeforeFirstEvent(events: AsyncIterable<ModelEvent>, ensureDumped: () => void) {
  for await (const event of events) {
    if (event.type !== "start") ensureDumped();
    yield event;
  }
  ensureDumped();
}

/** Starts attempt `n` of the request. Each call sends a fresh request to the adapter. */
export function startAttempt(request: AttemptRequest, n: number): AsyncIterable<ModelEvent> {
  const { adapter, ref, context, options, onRequest } = request;
  let dumped = false;
  const dump = (body: unknown): void => {
    if (dumped) return;
    dumped = true;
    // A copy, so a caller that changes the context after the call can't rewrite what an earlier attempt sent.
    if (onRequest)
      onRequest(structuredClone({ attempt: n, model: ref, context, options: dumpedOptions(options), body }));
  };
  const callerHook = options.onPayload;
  const onPayload = (body: unknown): unknown => {
    const replaced = callerHook ? callerHook(body) : undefined;
    const sent = replaced === undefined ? body : replaced;
    dump(sent);
    return sent;
  };
  const events = adapter.stream(ref, context, { ...options, onPayload });
  return dumpBeforeFirstEvent(events, () => {
    if (!dumped) dump(undefined);
  });
}
