// A tuned model removes a long prompt prefix from every request, but it charges twice the base rate for every
// token, and a cached prefix is already cheap. Two scripted calls make the comparison: a base model that
// receives a 4,000-token prefix plus a 200-token question, and a tuned model that receives the question alone.
// Both answer in 300 tokens. The rates are GPT-4.1 mini's, copied on 2026-11-19 from
// https://developers.openai.com/api/docs/pricing. OpenAI stops new tuning jobs on 6 January 2027, so this
// example prices a tuned model that already exists and creates none.
import { streamText } from "ai";
import { check } from "./lib/check.ts";
import { streamingModel, type TokenCounts } from "./lib/usage-mock.ts";

// #region price-table
type Rates = { input: number; cachedInput: number; output: number };
/** Nano-dollars per token (dollars per million tokens, times 1,000), as of November 2026. */
const BASE: Rates = { input: 400, cachedInput: 100, output: 1_600 };
const TUNED: Rates = { input: 800, cachedInput: 200, output: 3_200 };
const TRAINING_RUN_NANOS = 30_000_000_000; // $30: 6 million tokens at $5 per million

const costNanos = (rates: Rates, tokens: TokenCounts) =>
  tokens.noCache * rates.input + tokens.cacheRead * rates.cachedInput + tokens.output * rates.output;
// #endregion

const PREFIX = 4_000;
const QUESTION = 200;
const ANSWER = 300;

/** Runs one scripted streamed call, then prices the usage it reports. */
async function priced(modelId: string, rates: Rates, tokens: TokenCounts) {
  const model = streamingModel(modelId, ["An answer ", "of 300 tokens."], tokens);
  const result = streamText({ model, prompt: "Classify this ticket." });
  await result.consumeStream();
  const usage = await result.totalUsage;
  return costNanos(rates, {
    noCache: usage.inputTokenDetails.noCacheTokens ?? 0,
    cacheRead: usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWrite: 0,
    output: usage.outputTokens ?? 0,
  });
}

// #region compare
const uncached = await priced("gpt-4.1-mini", BASE, {
  noCache: PREFIX + QUESTION,
  cacheRead: 0,
  cacheWrite: 0,
  output: ANSWER,
});
const cached = await priced("gpt-4.1-mini", BASE, {
  noCache: QUESTION,
  cacheRead: PREFIX,
  cacheWrite: 0,
  output: ANSWER,
});
const tuned = await priced("ft:gpt-4.1-mini:acme", TUNED, {
  noCache: QUESTION,
  cacheRead: 0,
  cacheWrite: 0,
  output: ANSWER,
});
// A request count breaks even when its savings cover the training run; a call that saves nothing never does.
const breakEven = (baseline: number) => (baseline > tuned ? Math.ceil(TRAINING_RUN_NANOS / (baseline - tuned)) : null);
// #endregion

check(uncached === 2_160_000, "the uncached base call costs $0.00216");
check(cached === 960_000, "the base call with its prefix cached costs $0.00096");
check(tuned === 1_120_000, "the tuned call costs $0.00112");
check(
  TUNED.input === 2 * BASE.input && TUNED.cachedInput === 2 * BASE.cachedInput && TUNED.output === 2 * BASE.output,
  "the tuned model pays twice the base rate on every token class",
);
check(uncached > tuned, "the uncached base call costs more than the tuned call");
check(cached < tuned, "the cached base call costs less than the tuned call");
check(
  breakEven(uncached) === 28_847,
  "against the uncached prompt, a $30 training run breaks even after 28,847 requests",
);
check(breakEven(cached) === null, "against the cached prompt, the training run never breaks even");
