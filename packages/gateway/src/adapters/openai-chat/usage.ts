/**
 * Maps a Chat Completions `usage` object into the gateway's four token classes (D3), from `CompletionUsage` in
 * openai-node v7.49.0 (`src/resources/completions.ts`, as of November 2026):
 *
 * - `prompt_tokens` counts the whole prompt. `prompt_tokens_details.cached_tokens` are the "cached tokens present in
 *   the prompt", and `cache_write_tokens` the prompt tokens "written to cache", so the uncached input is what is left
 *   of `prompt_tokens` after both.
 * - The cache writes carry no lifetime, so they count under the `Usage.cacheWrite` key the request's breakpoints asked
 *   for: `"5m"` for OpenAI's 30-minute writes, `"1h"` for its 12-hour writes. The two keys name the short and the long
 *   cache-write rate, and an OpenAI catalog entry stores its 30-minute and 12-hour rates under them.
 * - `completion_tokens` is the output, and `completion_tokens_details.reasoning_tokens` the part of it spent on
 *   reasoning: `max_completion_tokens` bounds "visible output tokens and reasoning tokens" together, and the type
 *   says rejected prediction tokens are, "like reasoning tokens", counted in the completion tokens for billing.
 *
 * The usage object holds token counts only, so a reply carries no billed price and the cost comes from the catalog.
 */
import type { Usage } from "../../types.js";
import { emptyUsage } from "../../usage.js";
import { count, isObject } from "../wire.js";

/** The gateway's `Usage` for a Chat Completions usage object; a reply without one reports zero tokens. */
export function openaiUsage(raw: unknown, cacheSlot: "5m" | "1h"): Usage {
  if (!isObject(raw)) return emptyUsage(raw ?? null);
  const prompt = isObject(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const completion = isObject(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  const cacheRead = count(prompt.cached_tokens);
  const written = count(prompt.cache_write_tokens);
  const output = count(raw.completion_tokens);
  return {
    uncachedInput: Math.max(0, count(raw.prompt_tokens) - cacheRead - written),
    cacheRead,
    cacheWrite: { "5m": cacheSlot === "5m" ? written : 0, "1h": cacheSlot === "1h" ? written : 0 },
    output,
    // Reasoning is a part of output; the cap keeps that true for a server that reports more.
    reasoning: Math.min(count(completion.reasoning_tokens), output),
    raw,
  };
}
