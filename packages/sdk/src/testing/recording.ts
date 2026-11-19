/**
 * `recordPairs()`: records each call a model makes as a pair of normalised request and response, stamped with the
 * versions it was recorded against and an expiry (agent-SDK guide §8: record and replay at the normalised boundary).
 * A pair holds the gateway's transcript types, never wire bytes, so it survives changes to an adapter's wire format,
 * and it holds no credential: every property named like a credential header or an API key is left out.
 */
import {
  complete,
  type GatewayEvent,
  type Model,
  type ModelCallOptions,
  type ModelCaps,
  type ModelContext,
  type ModelEvent,
} from "@buildanagent/gateway";
import { stripCredentials } from "@buildanagent/gateway/testing";
import { SdkError, type SdkErrorCode } from "../errors.js";
import { SDK_VERSION } from "../version.js";
import type { Clock } from "./determinism.js";
import { type RecordedRequest, recordedOptions, type StreamScript } from "./scripted-model.js";

/** What a recording was made against, and until when it may be replayed. Every pair of one recording shares it. */
export interface RecordingStamp {
  /** The `@buildanagent/sdk` version that recorded it. */
  readonly sdkVersion: string;
  /** The model's wire protocol, such as `"anthropic-messages"`. */
  readonly api: string;
  /** The model's vendor, such as `"anthropic"`. */
  readonly provider: string;
  /** The provider's model id. */
  readonly model: string;
  /** The provider's API version, or whatever names the server build the recording was made against. */
  readonly providerVersion: string;
  /** The model's caps when it was recorded, which the replay model reports. */
  readonly caps: ModelCaps;
  /** When the recording was made, in ISO 8601. */
  readonly recordedAt: string;
  /** The time from which `replayPairs()` refuses the recording, in ISO 8601. */
  readonly expiresAt: string;
}

/** One model call: the normalised request it sent and the normalised events it streamed. */
export interface RecordedPair {
  readonly stamp: RecordingStamp;
  readonly request: RecordedRequest;
  /** The call's events, from `start` to its terminal, as the gateway streamed them, minus `retry` events. */
  readonly response: StreamScript;
}

/** What `recordPairs()` takes besides the model. */
export interface RecordOptions {
  /** The provider's API version, or another name for the server build you record against. Required. */
  readonly providerVersion: string;
  /** When the recording expires, in ISO 8601. Required, and later than `recordedAt`. */
  readonly expiresAt: string;
  /** Gives `recordedAt`. Defaults to the system time. */
  readonly clock?: Clock;
}

/** A model that records its calls, and the pairs recorded so far. */
export interface Recorder {
  /** Pass this model to `run()` in place of the one you recorded. */
  readonly model: Model;
  /** The pairs of every call that has reached its terminal, in the order the calls started. */
  pairs(): RecordedPair[];
}

/** The codes a `RecordingError` carries. */
export type RecordingErrorCode = Extract<
  SdkErrorCode,
  "invalid_recording" | "recording_expired" | "recording_mismatch"
>;

/**
 * Thrown by `recordPairs()` and `replayPairs()`. `invalid_recording`: the options or pairs are malformed, such as a
 * missing stamp or an expiry that isn't a time. `recording_expired`: the replay time is at or past the stamp's
 * `expiresAt`. `recording_mismatch`: the pairs disagree on their stamp, the stamp differs from what the replay
 * expects, or a call sent a request other than the recorded one. It is an `SdkError`, so `isSdkError()` recognises it.
 */
export class RecordingError extends SdkError {
  override readonly name = "RecordingError";
  declare readonly code: RecordingErrorCode;

  constructor(code: RecordingErrorCode, message: string) {
    super(code, message);
  }
}

const NORMALISED_EVENTS: ReadonlySet<string> = new Set<ModelEvent["type"]>([
  "start",
  "text_start",
  "text_delta",
  "text_end",
  "reasoning_start",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_input_delta",
  "tool_input_end",
  "warning",
  "done",
  "error",
]);

/**
 * True for an event a pair stores: the model spec's own events. `retry` events, which the gateway adds, and any
 * provider event outside the spec stay out, because a replay can't reproduce them.
 */
function isNormalised(event: GatewayEvent): event is ModelEvent {
  return NORMALISED_EVENTS.has(event.type);
}

/** A JSON-safe copy with credentials left out: exactly what a fixture file written from it would hold. */
export function storable<T>(value: T): T {
  return JSON.parse(JSON.stringify(stripCredentials(value))) as T;
}

/** The normalised form of one request, as a pair stores it and a replay compares it. */
export function normalisedRequest(
  model: Model["ref"],
  context: ModelContext,
  options: ModelCallOptions,
): RecordedRequest {
  return storable({ model, context, options: recordedOptions(options) });
}

function timeOf(value: unknown, name: string): number {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) throw new RecordingError("invalid_recording", `${name} must be an ISO 8601 time`);
  return time;
}

function stampOf(model: Model, options: RecordOptions): RecordingStamp {
  if (typeof options?.providerVersion !== "string" || options.providerVersion.trim() === "") {
    throw new RecordingError("invalid_recording", "recordPairs() needs a providerVersion");
  }
  const recordedAt = options.clock?.now() ?? new Date().toISOString();
  if (timeOf(options.expiresAt, "expiresAt") <= timeOf(recordedAt, "recordedAt")) {
    throw new RecordingError("invalid_recording", "recordPairs(): expiresAt must be later than the recording time");
  }
  const { api, provider, id } = model.ref;
  const { providerVersion, expiresAt } = options;
  return {
    sdkVersion: SDK_VERSION,
    api,
    provider,
    model: id,
    providerVersion,
    caps: model.caps,
    recordedAt,
    expiresAt,
  };
}

/**
 * Wraps `model` so that each call it makes is recorded as a `RecordedPair`, and returns the wrapper with the pairs so
 * far. Write `pairs()` to a fixture file as JSON, and replay it with `replayPairs()`. Each pair holds the request the
 * call sent (model, context and options) and every event it streamed except `retry` events, with every property
 * named like a credential header or an API key left out at any depth, so a fixture never holds a key. A call that
 * never reached its terminal, such as one whose reader stopped early, is not recorded.
 *
 * Throws a `RecordingError` with code `invalid_recording` for a blank `providerVersion`, or an `expiresAt` that isn't
 * an ISO 8601 time later than the recording time.
 */
export function recordPairs(model: Model, options: RecordOptions): Recorder {
  const stamp = stampOf(model, options);
  const slots: (RecordedPair | undefined)[] = [];
  async function* stream(context: ModelContext, callOptions: ModelCallOptions = {}): AsyncGenerator<GatewayEvent> {
    const slot = slots.push(undefined) - 1;
    const request = normalisedRequest(model.ref, context, callOptions);
    const events: ModelEvent[] = [];
    let ended = false;
    for await (const event of model.stream(context, callOptions)) {
      if (isNormalised(event)) events.push(event);
      ended ||= event.type === "done" || event.type === "error";
      yield event;
    }
    if (ended) slots[slot] = { stamp, request, response: { events: storable(events) } };
  }
  const recorded: Model = {
    ref: model.ref,
    caps: model.caps,
    stream,
    complete: (context, callOptions) => complete(stream(context, callOptions)),
    price: (usage) => model.price(usage),
  };
  return { model: recorded, pairs: () => slots.filter((pair): pair is RecordedPair => pair !== undefined) };
}
