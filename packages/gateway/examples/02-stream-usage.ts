// A streamed answer's closing message carries its usage in four token classes and the cost the gateway priced from
// its catalog. The rates are Claude Sonnet 5.5's, which the shipped catalog holds. The book's Chapter 2 lists it
// beside the AI SDK's streamed usage and its hand-written price sum.
import {
  type AssistantMessage,
  defaultCatalog,
  findCatalogEntry,
  type ModelContext,
  totalInput,
} from "@buildanagent/gateway";
import { check, scripted } from "./lib/check.js";

const ANSWER = "Prompt caching bills a cache read at 0.05x the input rate.";
const TOKENS = { uncachedInput: 1_000, cacheRead: 1_500, cacheWrite: 500, output: 200 };
const NANOS_PER_DOLLAR = 1_000_000_000;
/** The catalog's rates are dollars per million tokens, so one rate unit is this many nano-dollars a token. */
const NANOS_PER_RATE_UNIT = 1_000;
const TOKENS_PER_RATE_UNIT = 1_000_000;
const INPUT_TOKENS = TOKENS.uncachedInput + TOKENS.cacheRead + TOKENS.cacheWrite;
/** Claude Sonnet 5.5's bill for TOKENS, worked by hand in Chapter 2: $0.0054. */
const EXPECTED_NANOS = 5_400_000;

// #region stream-usage
const { model } = scripted(ANSWER, { usage: TOKENS, modelId: "claude-sonnet-5-5" });
const context: ModelContext = {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "What does a cache read cost?" }] }],
  tools: [],
};
const deltas: string[] = [];
let answer: AssistantMessage | undefined;
for await (const event of model.stream(context)) {
  if (event.type === "text_delta") deltas.push(event.delta);
  if (event.type === "done" || event.type === "error") answer = event.message; // book:note usage-at-end
}
if (answer === undefined) throw new Error("the stream ended without a closing event");
const { uncachedInput, cacheRead, cacheWrite, output } = answer.usage; // book:note four-classes
const { total, basis } = answer.cost; // book:note priced
// #endregion

check(deltas.length > 1, `the text arrives in several deltas (${deltas.length})`);
check(deltas.join("") === ANSWER, "the deltas join to the whole answer");
check(totalInput(answer.usage) === INPUT_TOKENS, "total input is the three input classes together (3,000)");
check(uncachedInput === TOKENS.uncachedInput, "usage reports the uncached input tokens (1,000)");
check(cacheRead === TOKENS.cacheRead, "usage reports the cache-read tokens (1,500)");
check(
  cacheWrite["5m"] === TOKENS.cacheWrite && cacheWrite["1h"] === 0,
  "usage reports the cache-write tokens, by lifetime (500, 0)",
);
check(output === TOKENS.output, "usage reports the output tokens (200)");
check(basis === "catalog", "the price comes from the catalog, since the provider billed no total");
const rates = findCatalogEntry(defaultCatalog, "anthropic", "claude-sonnet-5-5")?.rates[0];
check(rates !== undefined, "the shipped catalog lists Claude Sonnet 5.5");
// Nano-dollars keep the sum exact: a rate in dollars per million tokens is that many thousands of nano-dollars a token.
const nanos = (rate: number) => Math.round(rate * NANOS_PER_RATE_UNIT);
const byClass =
  uncachedInput * nanos(rates.uncachedInput) +
  cacheRead * nanos(rates.cacheRead) +
  cacheWrite["5m"] * nanos(rates.cacheWrite["5m"]) +
  output * nanos(rates.output);
check(byClass === EXPECTED_NANOS, `each class times its own catalog rate is 5,400,000 nano-dollars (${byClass})`);
check(
  total !== null && Math.round(total * NANOS_PER_DOLLAR) === byClass,
  `the message's cost is the same $0.0054 (${total})`,
);
check(
  total !== null && total < (INPUT_TOKENS * rates.uncachedInput + TOKENS.output * rates.output) / TOKENS_PER_RATE_UNIT,
  "billing every input token at the uncached rate would cost more",
);
