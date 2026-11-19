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

/** A seeded generator in [0, 1) (mulberry32), for tests that need randomness without `Math.random()`. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
