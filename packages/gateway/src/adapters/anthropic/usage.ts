/**
 * Maps Anthropic's `usage` object into the gateway's four token classes (D3), from the Messages API reference's
 * `Usage` and `MessageDeltaUsage` (https://platform.claude.com/docs/en/api/messages/create, as of November 2026):
 *
 * - `input_tokens` is the uncached input: the reference says total input is the sum of `input_tokens`,
 *   `cache_creation_input_tokens` and `cache_read_input_tokens`.
 * - `cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` split the cache writes by TTL.
 * - `output_tokens` is "the inclusive, authoritative total used for billing", and
 *   `output_tokens_details.thinking_tokens` is the part spent on reasoning, "always ≤ `output_tokens`". When
 *   streaming, the breakdown arrives only on the final `message_delta` (Extended thinking,
 *   https://platform.claude.com/docs/en/build-with-claude/extended-thinking, as of November 2026).
 *
 * The response carries no billed price, so the cost always comes from the catalog.
 */
import type { Usage } from "../../types.js";
import { count, isObject, type Json } from "../wire.js";

/**
 * Overlays a later usage report on an earlier one. A `message_delta`'s counts are cumulative, and a field it sends
 * as `null` or leaves out keeps the earlier value, so the `message_start` split of cache writes survives.
 */
export function mergeUsage(earlier: Json, later: unknown): Json {
  if (!isObject(later)) return earlier;
  const merged: Json = { ...earlier };
  for (const [key, value] of Object.entries(later)) {
    if (value === null || value === undefined) continue;
    merged[key] = isObject(value) && isObject(earlier[key]) ? { ...(earlier[key] as Json), ...value } : value;
  }
  return merged;
}

/**
 * The gateway's `Usage` for an Anthropic usage object. Cache writes reported without their TTL split count as
 * `fallbackTtl`, the TTL the request asked for.
 */
export function anthropicUsage(raw: Json, fallbackTtl: "5m" | "1h"): Usage {
  const split = isObject(raw.cache_creation) ? raw.cache_creation : undefined;
  const written = count(raw.cache_creation_input_tokens);
  const cacheWrite = split
    ? { "5m": count(split.ephemeral_5m_input_tokens), "1h": count(split.ephemeral_1h_input_tokens) }
    : { "5m": fallbackTtl === "5m" ? written : 0, "1h": fallbackTtl === "1h" ? written : 0 };
  const output = count(raw.output_tokens);
  const details = isObject(raw.output_tokens_details) ? raw.output_tokens_details : {};
  return {
    uncachedInput: count(raw.input_tokens),
    cacheRead: count(raw.cache_read_input_tokens),
    cacheWrite,
    output,
    // Reasoning is a part of output; the reference guarantees it never exceeds it, and the cap keeps that true.
    reasoning: Math.min(count(details.thinking_tokens), output),
    raw,
  };
}
