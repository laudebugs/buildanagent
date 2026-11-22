// A model call that survives a failure and reuses a cached prefix, on the gateway. The gateway's Anthropic adapter
// talks to a stub of Messages API (examples/lib/stub.ts), so a retried failure, a cache write and a cache read all
// happen on the real wire format: the stub answers an HTTP status the example queues, and reports cache tokens when it
// sees a marked prefix a second time. The book's Chapter 9 lists the code beside the AI SDK's, which retries through
// generateText and reads cache tokens from its mock model. Prices are Claude Sonnet 5.5's, from the shipped catalog.
import { createModel, type Model, type ModelCallOptions } from "@buildanagent/gateway";
import { check } from "./lib/check.js";
import { ANSWER, ANSWER_TOKENS, anthropicOver, anthropicStub, instantly, tokensIn } from "./lib/stub.js";

const MAX_OUTPUT_TOKENS = 500;
const NANOS_PER_DOLLAR = 1_000_000_000;
const policy = Array.from({ length: 400 }, (_, i) => `Refund rule ${i}: refund within 30 days.`).join("\n");

// #region wire
const stub = anthropicStub(); // book:note stub
const adapter = anthropicOver(stub); // book:note adapter
const model = createModel({ adapter, id: "claude-sonnet-5-5", sleep: instantly }); // book:note instant
// #endregion

// #region ask
const ask = (model: Model, question: string, system = policy, extra: ModelCallOptions = {}) =>
  model.complete(
    { system, messages: [{ role: "user", content: [{ type: "text", text: question }] }], tools: [] },
    {
      cacheRetention: "short", // book:note cache-mark
      maxOutputTokens: MAX_OUTPUT_TOKENS, // book:note output-cap
      ...extra,
    },
  );
// #endregion

// #region retry
stub.failures.push(529); // book:note retry-header
const first = await ask(model, "How long do refunds take?");
const retries = stub.requests.length - 1; // book:note retry-count
// #endregion
check(first.stopReason === "stop" && retries === 1, `an HTTP 529 costs one retry, and the answer arrives (${retries})`);
check(first.content[0]?.type === "text" && first.content[0].text === ANSWER, "the caller sees only the answer");
const marked = stub.requests[0]?.system?.[0]?.cache_control;
check(marked !== undefined, 'cacheRetention "short" marks the system prompt for the provider\'s cache');

// #region retry-limits
stub.failures.push(401); // book:note not-retryable
const before = stub.requests.length;
const rejected = await ask(model, "Again?");
check(
  rejected.stopReason === "error" && rejected.error?.kind === "fatal" && stub.requests.length - before === 1,
  "an error that is not retryable fails at once, with no retry",
);

stub.failures.push(429, 429);
const capped = createModel({ adapter, id: "claude-sonnet-5-5", retries: 1, sleep: instantly }); // book:note retry-cap
const exhausted = await ask(capped, "Once more?");
check(
  exhausted.error?.kind === "retryable" && stub.requests.length - before === 3,
  "retries: 1 gives up after two errors",
);
// #endregion

// #region cache
const second = await ask(model, "And for exchanges?");
const cacheRead = second.usage.cacheRead; // book:note cache-read
// #endregion
check(first.usage.cacheWrite["5m"] === tokensIn(policy), "the first call writes the prefix to the cache");
check(cacheRead === tokensIn(policy), `the same prefix, sent again, reports cache-read tokens (${cacheRead})`);
check(second.usage.cacheWrite["5m"] === 0, "the second call writes nothing");

// Literal checks, in nano-dollars: Sonnet 5.5 costs $2 an uncached input token, $2.5 a cache write, $0.10 a cache
// read and $10 an output token, per million. 3,973 prefix tokens, 7 or 5 question tokens, 20 output tokens.
const cost = (message: { cost: { total: number | null } }) =>
  Math.round((message.cost.total ?? Number.NaN) * NANOS_PER_DOLLAR);
check(cost(first) === 3973 * 2_500 + 7 * 2_000 + ANSWER_TOKENS * 10_000, "the first call is priced with a cache write");
check(cost(second) === 3973 * 100 + 5 * 2_000 + ANSWER_TOKENS * 10_000, "the second call is priced with a cache read");
check(second.cost.basis === "catalog", "the price comes from the gateway's catalog");
const uncached = (3973 + 5) * 2_000 + ANSWER_TOKENS * 10_000;
check(cost(second) < uncached / 5, "the cached call costs under a fifth of an uncached one");

// Turning the policy off sends no mark, so nothing is written or read.
const unmarked = await ask(model, "And for returns?", policy, { cacheRetention: "none" });
check(stub.requests.at(-1)?.system?.[0]?.cache_control === undefined, 'cacheRetention "none" sends no mark');
check(
  unmarked.usage.cacheRead === 0 && unmarked.usage.cacheWrite["5m"] === 0,
  "an unmarked prefix is neither written nor read",
);
