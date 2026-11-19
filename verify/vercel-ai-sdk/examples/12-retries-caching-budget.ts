// A model call that survives a failure, reuses a cached prefix and stays under a budget. generateText retries an
// API error that marks itself retryable, and waits as long as the error's retry-after-ms header says. A prompt
// cache reports cache-read tokens when it sees a prefix a second time. A middleware built with wrapLanguageModel
// projects each call's worst-case cost, adds what earlier calls already spent, and throws before the model sees a
// call that would pass the budget. Each behaviour runs twice: against a scripted model, and through
// @ai-sdk/anthropic with a fetch function that answers in Anthropic's Messages wire format, so the same retry,
// cache and budget code works over a second wire protocol. No network is used.
// Prices are Claude Sonnet 5.5 list prices per million tokens as of November 2026.
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { APICallError, generateText, RetryError, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { check } from "./lib/check.ts";

// #region prices
const PRICE_PER_MILLION = { input: 2, cacheRead: 0.1, cacheWrite: 2.5, output: 10 };
const BUDGET_USD = 0.03;
const MAX_OUTPUT_TOKENS = 500;
const ANSWER_TOKENS = 20;
const tokensIn = (text: string) => Math.ceil(text.length / 4);
type Tokens = { input: number; cacheRead: number; cacheWrite: number; output: number };
const usd = (t: Tokens) =>
  (t.input * PRICE_PER_MILLION.input +
    t.cacheRead * PRICE_PER_MILLION.cacheRead +
    t.cacheWrite * PRICE_PER_MILLION.cacheWrite +
    t.output * PRICE_PER_MILLION.output) /
  1e6;
// #endregion

// The cached prefix is the system messages; everything after them is the call's own text.
const prefixOf = (p: LanguageModelV4CallOptions) =>
  p.prompt
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("");
const restOf = (p: LanguageModelV4CallOptions) =>
  JSON.stringify(p.prompt.filter((m) => m.role !== "system").map((m) => m.content));

class BudgetExceededError extends Error {
  constructor(readonly projectedUsd: number) {
    super(`projected $${projectedUsd.toFixed(4)}`);
  }
}

// #region budget
/** Wraps a model so a call is refused, before the model sees it, when spent + projected cost passes the budget. */
function withBudget(inner: LanguageModelV4) {
  const ledger = { spent: 0, projected: 0 };
  const model = wrapLanguageModel({
    model: inner,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) => {
        // Worst case: the prefix is written to the cache, the rest is uncached, and the answer fills maxOutputTokens.
        ledger.projected = usd({
          input: tokensIn(restOf(params)),
          cacheRead: 0,
          cacheWrite: tokensIn(prefixOf(params)),
          output: params.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        });
        if (ledger.spent + ledger.projected > BUDGET_USD) throw new BudgetExceededError(ledger.projected);
        const result = await doGenerate();
        const u = result.usage;
        ledger.spent += usd({
          input: u.inputTokens.noCache ?? 0,
          cacheRead: u.inputTokens.cacheRead ?? 0,
          cacheWrite: u.inputTokens.cacheWrite ?? 0,
          output: u.outputTokens.total ?? 0,
        });
        return result;
      },
    },
  });
  return { model, ledger };
}
// #endregion

const apiError = (statusCode: number, isRetryable: boolean) =>
  new APICallError({
    message: "scripted failure",
    url: "https://mock.invalid",
    requestBodyValues: {},
    statusCode,
    isRetryable,
    responseHeaders: { "retry-after-ms": "0" },
  });

const policy = Array.from({ length: 400 }, (_, i) => `Refund rule ${i}: refund within 30 days.`).join("\n");
const longPolicy = policy.repeat(2);
const cacheControl = { anthropic: { cacheControl: { type: "ephemeral" } } };
type Extra = { maxRetries?: number; maxOutputTokens?: number };
const ask = (model: LanguageModelV4, question: string, system = policy, extra: Extra = {}) =>
  generateText({
    model,
    instructions: { role: "system", content: system, providerOptions: cacheControl },
    prompt: question,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    ...extra,
  });

// ---- First protocol: a scripted model that fails on demand and caches a prefix the way a provider does. ----
const failures: APICallError[] = [];
const seen = new Set<string>();
let attempts = 0;
const scripted = new MockLanguageModelV4({
  provider: "mock",
  modelId: "mock-sonnet",
  doGenerate: async (options) => {
    attempts++;
    const failure = failures.shift();
    if (failure) throw failure;
    const prefix = prefixOf(options);
    const hit = seen.has(prefix);
    seen.add(prefix);
    const prefixTokens = tokensIn(prefix);
    return {
      content: [{ type: "text", text: "Refunds take five days." }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: prefixTokens + tokensIn(restOf(options)),
          noCache: tokensIn(restOf(options)),
          cacheRead: hit ? prefixTokens : 0,
          cacheWrite: hit ? 0 : prefixTokens,
        },
        outputTokens: { total: ANSWER_TOKENS, text: ANSWER_TOKENS, reasoning: undefined },
      },
      warnings: [],
    };
  },
});
const { model, ledger } = withBudget(scripted);

// #region retry
failures.push(apiError(529, true)); // book:note retry-header
const first = await ask(model, "How long do refunds take?");
const retries = attempts - 1; // book:note retry-count
// #endregion
check(first.text === "Refunds take five days." && retries === 1, `a retryable error costs one retry (${retries})`);

failures.push(apiError(401, false));
const before = attempts;
const rejected = await ask(model, "Again?").catch((e) => e);
check(APICallError.isInstance(rejected) && attempts - before === 1, "an error that is not retryable is not retried");

failures.push(apiError(429, true), apiError(429, true));
const exhausted = await ask(model, "Once more?", policy, { maxRetries: 1 }).catch((e) => e);
check(
  RetryError.isInstance(exhausted) && exhausted.reason === "maxRetriesExceeded",
  "maxRetries 1 gives up after two errors",
);

// #region cache
const spentBefore = ledger.spent;
const second = await ask(model, "And for exchanges?");
const cacheRead = second.usage.inputTokenDetails.cacheReadTokens; // book:note cache-read
// #endregion
const uncachedCost = usd({ input: tokensIn(policy), cacheRead: 0, cacheWrite: 0, output: ANSWER_TOKENS });
check(
  first.usage.inputTokenDetails.cacheWriteTokens === tokensIn(policy),
  "the first call writes the prefix to the cache",
);
check(cacheRead === tokensIn(policy), `the same prefix, sent again, reports cache-read tokens (${cacheRead})`);
const cachedCost = ledger.spent - spentBefore;
check(
  cachedCost < uncachedCost / 5,
  `the cached call costs under a fifth of an uncached one ($${cachedCost.toFixed(5)})`,
);

// A long prefix with a short answer: the projection prices the prefix as a cache write and uses the call's own limit.
await ask(model, "Hi", policy, { maxOutputTokens: 20 });
const shortCall = usd({ input: 0, cacheRead: 0, cacheWrite: tokensIn(policy), output: 20 });
check(
  Math.abs(ledger.projected - shortCall) < 0.0001,
  `a long prefix with a short answer projects $${ledger.projected.toFixed(5)}`,
);

// #region refuse
// This call fits the budget alone, but not on top of what the earlier calls already spent.
const callsBefore = attempts;
const refused = await ask(model, "Summarise.", longPolicy).catch((e) => e);
check(
  refused instanceof BudgetExceededError && refused.projectedUsd < BUDGET_USD,
  `a call that fits the budget alone ($${ledger.projected.toFixed(4)}) is refused ...`,
);
check(ledger.spent + ledger.projected > BUDGET_USD, `... because $${ledger.spent.toFixed(4)} is already spent`);
check(attempts === callsBefore, "the refused call never reached the model"); // book:note refused
// #endregion

// ---- Second protocol: @ai-sdk/anthropic against a fetch function that answers in the Messages wire format. ----
type WireRequest = { system: { text: string; cache_control?: unknown }[]; messages: { content: { text: string }[] }[] };
const wireSeen = new Set<string>();
const wireStatuses = [529, 200]; // the first request is rejected as overloaded, its retry succeeds
let wireRequests = 0;
const wireFetch = (async (_url: unknown, init?: RequestInit) => {
  wireRequests++;
  const status = wireStatuses.shift() ?? 200;
  if (status !== 200) {
    const error = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };
    return Response.json(error, { status, headers: { "retry-after-ms": "0" } });
  }
  const body = JSON.parse(String(init?.body)) as WireRequest;
  const prefix = body.system.map((b) => b.text).join("");
  const marked = body.system.some((b) => b.cache_control);
  const hit = marked && wireSeen.has(prefix);
  if (marked) wireSeen.add(prefix);
  const rest = tokensIn(body.messages.map((m) => m.content.map((c) => c.text).join("")).join(""));
  const usage = {
    input_tokens: marked ? rest : rest + tokensIn(prefix),
    cache_read_input_tokens: hit ? tokensIn(prefix) : 0,
    cache_creation_input_tokens: marked && !hit ? tokensIn(prefix) : 0,
    output_tokens: ANSWER_TOKENS,
  };
  const content = [{ type: "text", text: "Refunds take five days." }];
  const message = { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content };
  return Response.json({ ...message, stop_reason: "end_turn", stop_sequence: null, usage });
}) as typeof fetch;

// #region wire
const anthropic = createAnthropic({ apiKey: "not-a-real-key", baseURL: "http://localhost/v1", fetch: wireFetch });
const wire = withBudget(anthropic("claude-sonnet-5-5"));
const overWire = await ask(wire.model, "How long do refunds take?");
const overWireAgain = await ask(wire.model, "And for exchanges?");
// #endregion
check(
  overWire.text === "Refunds take five days." && wireRequests === 3,
  `over the Messages format, an HTTP 529 costs one retry (${wireRequests} requests for two calls)`,
);
check(
  overWire.usage.inputTokenDetails.cacheWriteTokens === tokensIn(policy),
  "over the Messages format, the first call writes the prefix",
);
check(
  overWireAgain.usage.inputTokenDetails.cacheReadTokens === tokensIn(policy),
  "over the Messages format, the repeated prefix reads from the cache",
);
const wireRefused = await ask(wire.model, "Summarise.", longPolicy.repeat(2)).catch((e) => e);
check(
  wireRefused instanceof BudgetExceededError && wireRequests === 3,
  "over the Messages format, the budget refuses before any request is sent",
);
