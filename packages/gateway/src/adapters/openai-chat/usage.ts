/**
 * Maps a Chat Completions `usage` object into the gateway's four token classes (D3), from the `usage` of a chat
 * completion (https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) and
 * the Prompt caching guide (https://developers.openai.com/api/docs/guides/prompt-caching), both as of November 2026:
 *
 * - `prompt_tokens` counts the whole prompt. `prompt_tokens_details.cached_tokens` counts billed cache reads, which
 *   exclude the tokens charged as writes, and `cache_write_tokens` the prompt tokens written to cache. The guide
 *   computes ordinary input as the input tokens less both, and so does the adapter.
 * - Chat Completions writes only 30-minute cache entries, so every write counts under `Usage.cacheWrite["5m"]`, the
 *   key for the short cache-write rate; an OpenAI catalog entry stores its 30-minute rate there.
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
export function openaiUsage(raw: unknown): Usage {
  if (!isObject(raw)) return emptyUsage(raw ?? null);
  const prompt = isObject(raw.prompt_tokens_details) ? raw.prompt_tokens_details : {};
  const completion = isObject(raw.completion_tokens_details) ? raw.completion_tokens_details : {};
  const cacheRead = count(prompt.cached_tokens);
  const written = count(prompt.cache_write_tokens);
  const output = count(raw.completion_tokens);
  return {
    uncachedInput: Math.max(0, count(raw.prompt_tokens) - cacheRead - written),
    cacheRead,
    cacheWrite: { "5m": written, "1h": 0 },
    output,
    // Reasoning is a part of output; the cap keeps that true for a server that reports more.
    reasoning: Math.min(count(completion.reasoning_tokens), output),
    raw,
  };
}
