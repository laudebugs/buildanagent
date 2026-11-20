/**
 * `replayPairs()`: plays a recording back through a `ScriptedModel`, after checking its stamp and expiry, and checks
 * that each call sends the request that was recorded, so a replayed run that drifts from the recorded one fails.
 */
import { SDK_VERSION } from "../version.js";
import type { Clock } from "./determinism.js";
import { normalisedRequest, type RecordedPair, RecordingError, type RecordingStamp, storable } from "./recording.js";
import { type RecordedRequest, ScriptedModel, type ScriptStep } from "./scripted-model.js";

/** The stamp fields a replay can require to match exactly. */
export type ExpectedStamp = Partial<
  Pick<RecordingStamp, "sdkVersion" | "api" | "provider" | "model" | "providerVersion">
>;

/** What `replayPairs()` takes besides the pairs. */
export interface ReplayOptions {
  /** Gives the time the expiry is checked against. Defaults to the system time. */
  readonly clock?: Clock;
  /** Stamp fields that must match exactly, such as the `providerVersion` your adapter speaks today. */
  readonly expect?: ExpectedStamp;
}

/** Sorted-key JSON, so two requests compare equal whatever order their keys were written in. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** The JSON path of the first place `a` and `b` differ, such as `$.context.messages[2].content`. */
function firstDifference(a: unknown, b: unknown, path = "$"): string {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return path;
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path} (length ${b.length}, recorded ${a.length})`;
    const index = a.findIndex((item, i) => canonical(item) !== canonical(b[i]));
    return index < 0 ? path : firstDifference(a[index], b[index], `${path}[${index}]`);
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const key = keys.find((name) => canonical(left[name]) !== canonical(right[name]));
  return key === undefined ? path : firstDifference(left[key], right[key], `${path}.${key}`);
}

/** The release line: the major version from 1.0 on, the minor one under 0.x, where a minor bump may break. */
function releaseLine(version: string): string {
  const [major = "", minor = ""] = version.split(".");
  return major === "0" ? `0.${minor}` : major;
}

// `typeof null` is "object", so a bare typeof check would let a null stamp through to a TypeError.
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkShape(pairs: readonly RecordedPair[]): RecordingStamp {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new RecordingError("invalid_recording", "replayPairs() needs a non-empty array of recorded pairs");
  }
  for (const [i, pair] of pairs.entries()) {
    const candidate = pair as Partial<RecordedPair> | null;
    const events = candidate?.response?.events;
    if (!isObject(candidate?.stamp) || !isObject(candidate?.request) || !Array.isArray(events)) {
      throw new RecordingError("invalid_recording", `pair ${i + 1} needs a stamp, a request and response events`);
    }
  }
  return (pairs[0] as RecordedPair).stamp;
}

function checkStamp(stamp: RecordingStamp, pairs: readonly RecordedPair[], options: ReplayOptions): void {
  const others = pairs.findIndex((pair) => canonical(pair.stamp) !== canonical(stamp));
  if (others >= 0) {
    throw new RecordingError("recording_mismatch", `pair ${others + 1} has a different stamp from pair 1`);
  }
  const expiresAt = Date.parse(stamp.expiresAt);
  if (Number.isNaN(expiresAt)) throw new RecordingError("invalid_recording", "the stamp's expiresAt isn't a time");
  const now = options.clock?.now() ?? new Date().toISOString();
  if (Date.parse(now) >= expiresAt) {
    throw new RecordingError("recording_expired", `the recording expired at ${stamp.expiresAt}; record it again`);
  }
  if (typeof stamp.sdkVersion !== "string" || releaseLine(stamp.sdkVersion) !== releaseLine(SDK_VERSION)) {
    throw new RecordingError(
      "recording_mismatch",
      `the recording was made with SDK ${String(stamp.sdkVersion)}, which this SDK (${SDK_VERSION}) can't replay`,
    );
  }
  for (const [field, value] of Object.entries(options.expect ?? {})) {
    const recorded = stamp[field as keyof ExpectedStamp];
    if (value !== undefined && recorded !== value) {
      throw new RecordingError("recording_mismatch", `the stamp's ${field} is ${String(recorded)}, expected ${value}`);
    }
  }
}

/**
 * A `ScriptedModel` that plays back recorded pairs. Its `api` and `provider` are the stamp's, and `modelId` is the id
 * to pass to `createModel()`, so the replayed calls are priced from the same catalog entry as the recorded ones.
 */
export class ReplayModel extends ScriptedModel {
  /** The recorded model id. */
  readonly modelId: string;
  readonly #mismatches: RecordingError[];

  constructor(pairs: readonly RecordedPair[], options: ReplayOptions = {}) {
    const stamp = checkShape(pairs);
    checkStamp(stamp, pairs, options);
    const mismatches: RecordingError[] = [];
    super(
      pairs.map((pair, i) => matchingStep(pair, i, mismatches)),
      { ref: { api: stamp.api, provider: stamp.provider }, caps: { ...stamp.caps } },
    );
    this.modelId = stamp.model;
    this.#mismatches = mismatches;
  }

  /**
   * Throws the first `RecordingError` a call raised by sending a request other than the recorded one, then does what
   * `ScriptedModel.assertComplete()` does. Call it in teardown: behind `createModel()`, a mismatch ends the run with
   * an `error` result, and only this check makes the test fail.
   */
  override assertComplete(): void {
    const [first] = this.#mismatches;
    if (first !== undefined) throw first;
    super.assertComplete();
  }
}

function matchingStep(pair: RecordedPair, index: number, mismatches: RecordingError[]): ScriptStep {
  return (request: RecordedRequest) => {
    const sent = normalisedRequest(request.model, request.context, request.options);
    const recorded = storable(pair.request);
    if (canonical(sent) !== canonical(recorded)) {
      const error = new RecordingError(
        "recording_mismatch",
        `call ${index + 1} sent a request that differs from the recording at ${firstDifference(recorded, sent)}`,
      );
      mismatches.push(error);
      throw error;
    }
    return pair.response;
  };
}

/**
 * Replays pairs from `recordPairs()` through a `ScriptedModel`: the n-th call streams the n-th pair's events exactly as
 * they were recorded, after checking that it sent the recorded request. Wrap it with
 * `createModel({ adapter: replay, id: replay.modelId })`, with no middleware: the recording was taken outside the
 * recorded model's middleware, so it already holds that middleware's effect.
 *
 * Throws a `RecordingError`: `invalid_recording` for an empty or malformed recording, `recording_expired` once the
 * clock reaches the stamp's `expiresAt`, and `recording_mismatch` when the pairs' stamps differ, the recording comes
 * from another SDK release line (another minor version under 0.x), or a stamp field differs from `expect`. A call
 * whose request differs from the recording fails with a `recording_mismatch` error, which `assertComplete()`
 * rethrows.
 */
export function replayPairs(pairs: readonly RecordedPair[], options: ReplayOptions = {}): ReplayModel {
  return new ReplayModel(pairs, options);
}
