/** Usage helpers (D3). */
import type { Usage } from "./types.ts";

/** All input tokens: uncached, cache reads and both cache-write lifetimes. */
export function totalInput(u: Usage): number {
  return u.uncachedInput + u.cacheRead + u.cacheWrite["5m"] + u.cacheWrite["1h"];
}

/** A usage record with every count at zero. */
export function emptyUsage(raw: unknown = null): Usage {
  return { uncachedInput: 0, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 0, reasoning: 0, raw };
}
