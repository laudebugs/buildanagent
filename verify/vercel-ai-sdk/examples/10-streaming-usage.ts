// A streamed answer folds into one message. Its final usage splits the input into three classes (tokens read
// from the cache, tokens written to it, and the rest) next to the output. Each class has its own price,
// so the bill is a sum over four classes. The rates are Claude Sonnet 5.5's (see lib/rates.ts).
// Docs: ai-sdk-core/generating-text.mdx ("streamText"), reference/ai-sdk-core/stream-text.mdx
import { streamText } from "ai";
import { check, scripted } from "./lib/check.ts";
import { costNanos, NANOS_PER_DOLLAR, SONNET_5_5, type TokenCounts, usageOf } from "./lib/rates.ts";

const ANSWER = "Prompt caching bills a cache read at 0.05x the input rate.";
const TOKENS: TokenCounts = { noCache: 1_000, cacheRead: 1_500, cacheWrite: 500, output: 200 };

// #region stream-usage
const { model } = scripted([ANSWER], { usage: usageOf(TOKENS), modelId: "claude-sonnet-5-5" });
const result = streamText({ model, prompt: "What does a cache read cost?" });
const chunks: string[] = [];
for await (const chunk of result.textStream) chunks.push(chunk);
const usage = await result.totalUsage;
const { noCacheTokens, cacheReadTokens, cacheWriteTokens } = usage.inputTokenDetails; // book:note input-classes
const nanos = costNanos(SONNET_5_5, {
  noCache: noCacheTokens ?? 0,
  cacheRead: cacheReadTokens ?? 0,
  cacheWrite: cacheWriteTokens ?? 0,
  output: usage.outputTokens ?? 0,
}); // book:note price-the-classes
// #endregion

check(chunks.length > 1, `the text arrives in several deltas (${chunks.length})`);
check(chunks.join("") === ANSWER, "the deltas join to the whole answer");
check((await result.text) === ANSWER, "result.text equals the folded deltas");
check(usage.inputTokens === 3_000, "input tokens total the three input classes (3,000)");
check(noCacheTokens === 1_000, "usage reports the uncached input tokens (1,000)");
check(cacheReadTokens === 1_500, "usage reports the cache-read tokens (1,500)");
check(cacheWriteTokens === 500, "usage reports the cache-write tokens (500)");
check(usage.outputTokens === 200, "usage reports the output tokens (200)");
check(nanos === 5_400_000, `the four classes cost 5,400,000 nano-dollars ($${nanos / NANOS_PER_DOLLAR})`);
check(
  nanos < 3_000 * SONNET_5_5.noCache + 200 * SONNET_5_5.output,
  "billing every input token at the uncached rate would cost more",
);
