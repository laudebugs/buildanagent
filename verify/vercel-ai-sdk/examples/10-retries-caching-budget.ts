// A model call that survives a failure, reuses a cached prefix and stays under a budget. generateText retries an
// API error that marks itself retryable, and waits as long as the error's retry-after-ms header says. A mock model
// reports cache-read tokens when it sees a prefix a second time, as a provider's prompt cache does. A middleware
// built with wrapLanguageModel projects each call's worst-case cost and throws before the model sees a call that
// would pass the budget. The model here is scripted. A second wire protocol, served by a mock HTTP server through a
// provider's base URL, is not shown: such a server would replace the transport below the model interface, where
// the recorded transcript and this example's mock sit, so it would test a provider package instead of the behaviour here.
// Prices are Claude Sonnet 5.5 list prices per million tokens as of November 2026.
import { APICallError, generateText, RetryError, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { check } from "./lib/check.ts";

// #region prices
const PRICE_PER_MILLION = { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 };
const BUDGET_USD = 0.05;
const MAX_OUTPUT_TOKENS = 1000;
const tokensIn = (text: string) => Math.ceil(text.length / 4);
const usd = (t: { input: number; cacheRead: number; cacheWrite: number; output: number }) =>
  (t.input * PRICE_PER_MILLION.input +
    t.cacheRead * PRICE_PER_MILLION.cacheRead +
    t.cacheWrite * PRICE_PER_MILLION.cacheWrite +
    t.output * PRICE_PER_MILLION.output) /
  1e6;
// #endregion

const promptText = (p: { prompt: { content: unknown }[] }) => JSON.stringify(p.prompt.map((m) => m.content));
const answerTokens = 20;
const seenPrefixes = new Set<string>();
const failures: APICallError[] = [];
let attempts = 0;

const mock = new MockLanguageModelV4({
  provider: "mock",
  modelId: "mock-sonnet",
  doGenerate: async (options) => {
    attempts++;
    const failure = failures.shift();
    if (failure) throw failure;
    const prefix = options.prompt
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("");
    const prefixTokens = tokensIn(prefix);
    const hit = seenPrefixes.has(prefix);
    seenPrefixes.add(prefix);
    const total = tokensIn(promptText(options));
    return {
      content: [{ type: "text", text: "Refunds take five days." }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total,
          noCache: total - prefixTokens,
          cacheRead: hit ? prefixTokens : 0,
          cacheWrite: hit ? 0 : prefixTokens,
        },
        outputTokens: { total: answerTokens, text: answerTokens, reasoning: undefined },
      },
      warnings: [],
    };
  },
});

class BudgetExceededError extends Error {}
let spentUsd = 0;

// #region budget
const model = wrapLanguageModel({
  model: mock,
  middleware: {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      // Worst case: no cache hit and a full-length answer.
      const projected = usd({
        input: tokensIn(promptText(params)),
        cacheRead: 0,
        cacheWrite: 0,
        output: MAX_OUTPUT_TOKENS,
      });
      if (spentUsd + projected > BUDGET_USD) throw new BudgetExceededError(`projected $${projected.toFixed(4)}`);
      const result = await doGenerate();
      const u = result.usage;
      spentUsd += usd({
        input: u.inputTokens.noCache ?? 0,
        cacheRead: u.inputTokens.cacheRead ?? 0,
        cacheWrite: u.inputTokens.cacheWrite ?? 0,
        output: u.outputTokens.total ?? 0,
      });
      return result;
    },
  },
});
// #endregion

const policy = Array.from({ length: 400 }, (_, i) => `Refund rule ${i}: refund within 30 days.`).join("\n");
const ask = (question: string, system = policy, maxRetries?: number) =>
  generateText({ model, system, prompt: question, maxOutputTokens: MAX_OUTPUT_TOKENS, maxRetries });

// #region retry
// retry-after-ms of 0 makes the SDK retry at once instead of waiting its 2-second default.
failures.push(
  new APICallError({
    message: "overloaded",
    url: "https://mock.invalid",
    requestBodyValues: {},
    statusCode: 529,
    isRetryable: true,
    responseHeaders: { "retry-after-ms": "0" }, // book:note retry-header
  }),
);
const first = await ask("How long do refunds take?");
const retries = attempts - 1; // book:note retry-count
// #endregion
check(first.text === "Refunds take five days." && retries === 1, `a retryable error costs one retry (${retries})`);

failures.push(
  new APICallError({ message: "bad key", url: "https://mock.invalid", requestBodyValues: {}, statusCode: 401 }),
);
const before = attempts;
const rejected = await ask("Again?").catch((e) => e);
check(
  APICallError.isInstance(rejected) && attempts - before === 1,
  "an error that is not retryable fails on the first attempt",
);

failures.push(
  ...[1, 2].map(
    () =>
      new APICallError({
        message: "busy",
        url: "https://mock.invalid",
        requestBodyValues: {},
        statusCode: 429,
        isRetryable: true,
        responseHeaders: { "retry-after-ms": "0" },
      }),
  ),
);
const exhausted = await ask("Once more?", policy, 1).catch((e) => e);
check(
  RetryError.isInstance(exhausted) && exhausted.reason === "maxRetriesExceeded",
  "maxRetries 1 gives up after two errors",
);

// #region cache
const second = await ask("And for exchanges?");
const cacheRead = second.usage.inputTokenDetails.cacheReadTokens; // book:note cache-read
// #endregion
check(
  first.usage.inputTokenDetails.cacheWriteTokens === tokensIn(policy),
  "the first call writes the prefix to the cache",
);
check(cacheRead === tokensIn(policy), `the same prefix, sent again, reports cache-read tokens (${cacheRead})`);
check(spentUsd < BUDGET_USD / 2, `cached calls stay cheap (spent $${spentUsd.toFixed(5)})`);

// #region refuse
const callsBefore = attempts;
const refused = await ask("Summarise.", policy.repeat(6)).catch((e) => e);
// #endregion
check(refused instanceof BudgetExceededError, `a call over the budget is refused (${refused.message})`);
check(attempts === callsBefore, "the refused call never reached the model"); // book:note refused
