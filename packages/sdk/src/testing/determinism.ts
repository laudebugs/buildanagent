/** Deterministic clocks, ids and randomness for tests (SDK plan §3.3, §5.2). Nothing here reads `Date` or `Math.random`. */

/** An ISO 8601 clock (SDK plan §3.3). */
export interface Clock {
  now(): string;
}

/** A clock that starts at `start` and advances `stepMs` on every `now()` call. */
export function fixedClock(start: string, stepMs = 0): Clock {
  let t = Date.parse(start);
  if (Number.isNaN(t)) throw new RangeError(`fixedClock: not an ISO 8601 time: ${start}`);
  return {
    now() {
      const value = new Date(t).toISOString();
      t += stepMs;
      return value;
    },
  };
}

/** Returns `prefix-1`, `prefix-2`, … */
export function sequentialIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

// The seeded generator lives in the gateway's testing export, so gateway tests can use it too.
export { seededRandom } from "@buildanagent/gateway/testing";
