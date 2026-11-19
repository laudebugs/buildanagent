// A streamed answer folds into one message, and its final usage splits the input into three classes (tokens
// read from the cache, tokens written to it, and the rest) next to the output. Each class has its own price,
// so the bill is a sum over four classes. The rates are Claude Sonnet 5.5's, copied on 2026-11-19 from
// https://platform.claude.com/docs/en/about-claude/pricing (the five-minute cache-write rate).
import { streamText } from "ai";
import { check } from "./lib/check.ts";
import { streamingModel, type TokenCounts } from "./lib/usage-mock.ts";

// #region rates
/** Nano-dollars per token (dollars per million tokens, times 1,000), as of November 2026. */
const RATES = { noCache: 2_000, cacheRead: 100, cacheWrite: 2_500, output: 10_000 } as const;
const NANOS_PER_DOLLAR = 1_000_000_000;

/** What a call costs in nano-dollars. The sum stays a whole number, so no rounding error enters it. */
const costNanos = (tokens: TokenCounts) =>
  tokens.noCache * RATES.noCache +
  tokens.cacheRead * RATES.cacheRead +
  tokens.cacheWrite * RATES.cacheWrite +
  tokens.output * RATES.output;
// #endregion

const DELTAS = ["Prompt caching ", "bills a read ", "at a tenth ", "of the input rate."];
const TOKENS: TokenCounts = { noCache: 1_000, cacheRead: 1_500, cacheWrite: 500, output: 200 };

// #region stream-usage
const model = streamingModel("claude-sonnet-5-5", DELTAS, TOKENS);
const result = streamText({ model, prompt: "What does a cache read cost?" });
let text = "";
for await (const chunk of result.textStream) text += chunk;
const usage = await result.totalUsage;
const { noCacheTokens, cacheReadTokens, cacheWriteTokens } = usage.inputTokenDetails;
const nanos = costNanos({
  noCache: noCacheTokens ?? 0,
  cacheRead: cacheReadTokens ?? 0,
  cacheWrite: cacheWriteTokens ?? 0,
  output: usage.outputTokens ?? 0,
});
// #endregion

check(text === DELTAS.join(""), "the streamed deltas fold into the one message");
check((await result.text) === text, "result.text equals the folded deltas");
check(usage.inputTokens === 3_000, "input tokens total the three input classes (3,000)");
check(noCacheTokens === 1_000, "usage reports the uncached input tokens (1,000)");
check(cacheReadTokens === 1_500, "usage reports the cache-read tokens (1,500)");
check(cacheWriteTokens === 500, "usage reports the cache-write tokens (500)");
check(usage.outputTokens === 200, "usage reports the output tokens (200)");
check(nanos === 5_400_000, `the four classes cost 5,400,000 nano-dollars ($${nanos / NANOS_PER_DOLLAR})`);
check(
  nanos < 3_000 * RATES.noCache + 200 * RATES.output,
  "billing every input token at the uncached rate would cost more",
);
