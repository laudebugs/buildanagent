// The four token classes a call reports, the usage object that carries them, and what each class costs.
import type { LanguageModelV4Usage } from "@ai-sdk/provider";

/** The four token classes a provider reports for one call. */
export type TokenCounts = { noCache: number; cacheRead: number; cacheWrite: number; output: number };

/** Nano-dollars per token (dollars per million tokens, times 1,000), one rate for each token class. */
export type Rates = Readonly<TokenCounts>;

// #region rates
/**
 * Claude Sonnet 5.5, as of November 2026: $2, $0.10, $2.50 (five-minute cache write) and $10 per million tokens.
 * Source: https://platform.claude.com/docs/en/about-claude/pricing, copied on 2026-11-19. A whole number of
 * nano-dollars per token keeps every sum exact.
 */
export const SONNET_5_5: Rates = { noCache: 2_000, cacheRead: 100, cacheWrite: 2_500, output: 10_000 };

/** What a call costs in nano-dollars: each token class times its rate. */
export const costNanos = (rates: Rates, tokens: TokenCounts) =>
  tokens.noCache * rates.noCache +
  tokens.cacheRead * rates.cacheRead +
  tokens.cacheWrite * rates.cacheWrite +
  tokens.output * rates.output;
// #endregion

export const NANOS_PER_DOLLAR = 1_000_000_000;

/** The usage object a provider sends with its final stream part. */
export function usageOf(tokens: TokenCounts): LanguageModelV4Usage {
  const total = tokens.noCache + tokens.cacheRead + tokens.cacheWrite;
  return {
    inputTokens: { total, noCache: tokens.noCache, cacheRead: tokens.cacheRead, cacheWrite: tokens.cacheWrite },
    outputTokens: { total: tokens.output, text: tokens.output, reasoning: undefined },
  };
}
