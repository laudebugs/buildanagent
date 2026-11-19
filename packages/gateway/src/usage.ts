/** Usage helpers (D3). */
import type { Usage } from "./types.js";

/** All input tokens: uncached, cache reads and both cache-write lifetimes. */
export function totalInput(u: Usage): number {
  return u.uncachedInput + u.cacheRead + u.cacheWrite["5m"] + u.cacheWrite["1h"];
}

/**
 * Adds two usage records; the result keeps the second record's `raw`. The sum is unreported when either record is,
 * because its counts then miss what the unreported response used.
 */
export function addUsage(a: Usage, b: Usage): Usage {
  return {
    uncachedInput: a.uncachedInput + b.uncachedInput,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: { "5m": a.cacheWrite["5m"] + b.cacheWrite["5m"], "1h": a.cacheWrite["1h"] + b.cacheWrite["1h"] },
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    raw: b.raw,
    ...(a.unreported || b.unreported ? { unreported: true } : {}),
  };
}

/** A usage record with every count at zero. */
export function emptyUsage(raw: unknown = null): Usage {
  return { uncachedInput: 0, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 0, reasoning: 0, raw };
}

/**
 * A usage record for a response whose provider reported no usage: every count is zero and `unreported` is `true`,
 * so pricing gives an unknown cost instead of a known zero.
 */
export function unreportedUsage(raw: unknown = null): Usage {
  return { ...emptyUsage(raw), unreported: true };
}
