import assert from "node:assert/strict";
import {
  type Cost,
  createModel,
  emptyUsage,
  estimateInputTokens,
  type ModelAdapter,
  type ModelContext,
  type ModelEvent,
  type PriceCatalog,
  priceUsage,
  projectCallCost,
  projectCost,
  type Usage,
} from "@buildanagent/gateway";
import { test } from "vitest";
import { type Attempt, context, FailingAdapter, recordingSleep, TEST_CAPS } from "./adapters.ts";
import { FAKE_RATES, fakeEntry, message } from "./fixtures.ts";

const entry = fakeEntry();
const catalog: PriceCatalog = { models: [entry] };

function usage(counts: Partial<Omit<Usage, "cacheWrite" | "raw">> & { cw5m?: number; cw1h?: number }): Usage {
  const { cw5m = 0, cw1h = 0, ...rest } = counts;
  return { ...emptyUsage(), ...rest, cacheWrite: { "5m": cw5m, "1h": cw1h } };
}

function pricedModel(attempts: Attempt[], id = "priced") {
  const adapter = new FailingAdapter(attempts);
  return { adapter, model: createModel({ adapter, id, catalog, sleep: recordingSleep().sleep }) };
}

test("a message's cost is each token class times its catalog rate", async () => {
  const reported = usage({
    uncachedInput: 1_000_000,
    cacheRead: 2_000_000,
    cw5m: 1_000_000,
    cw1h: 1_000_000,
    output: 500_000,
    reasoning: 100_000,
  });
  const { model } = pricedModel([{ reply: "hi", usage: reported }]);
  const result = await model.complete(context);
  // 1M × $2 + 2M × $0.50 + 1M × $4 + 1M × $8 + 0.5M × $16; reasoning is part of output, so it adds nothing.
  assert.deepEqual(result.cost, { total: 23, basis: "catalog", currency: "USD", catalogAsOf: "2026-11-01" });
});

test("Model.price() prices usage with the model's catalog entry", () => {
  const { model } = pricedModel([]);
  const cost = model.price(usage({ uncachedInput: 1000, output: 10 }));
  assert.equal(cost.basis, "catalog");
  assert.ok(Math.abs((cost.total ?? Number.NaN) - (1000 * 2 + 10 * 16) / 1_000_000) < 1e-15);
});

test("the tier is chosen by the request's total input, cache reads and writes included", () => {
  const high = { ...FAKE_RATES, uncachedInput: 20, cacheRead: 5, output: 160 };
  const tiered = fakeEntry({ rates: [{ ...FAKE_RATES, upToInputTokens: 1000 }, high] });
  assert.equal(priceUsage(usage({ uncachedInput: 1000 }), tiered).total, (1000 * 2) / 1_000_000);
  // 600 uncached plus 600 cache reads is 1,200 input tokens, over the first tier's limit.
  const over = priceUsage(usage({ uncachedInput: 600, cacheRead: 600 }), tiered);
  assert.equal(over.total, (600 * 20 + 600 * 5) / 1_000_000);
});

test("a model missing from the catalog yields total null and basis unknown", async () => {
  const { model } = pricedModel([{ reply: "hi", usage: usage({ uncachedInput: 10, output: 5 }) }], "unlisted");
  const unknown: Cost = { total: null, basis: "unknown", currency: "USD" };
  assert.deepEqual((await model.complete(context)).cost, unknown);
  assert.deepEqual(model.price(usage({ uncachedInput: 10 })), unknown);
});

test("createModel() prices with the shipped catalog when no catalog is passed", () => {
  const adapter = {
    ...new FailingAdapter([]),
    provider: "anthropic",
    stream: () => ({ async *[Symbol.asyncIterator]() {} }),
  };
  const model = createModel({ adapter, id: "claude-sonnet-5-5" });
  assert.equal(model.price(usage({ output: 1 })).basis, "catalog");
});

test("a provider-billed total wins over the catalog", async () => {
  const billed: Cost = { total: 0.42, basis: "provider", currency: "USD" };
  const { model } = pricedModel([{ reply: "hi", usage: usage({ uncachedInput: 1_000_000 }), cost: billed }]);
  assert.deepEqual((await model.complete(context)).cost, billed);
});

test("two failed attempts and one success yield a cost that includes all three", async () => {
  const { model } = pricedModel([
    { fail: "retryable", usage: usage({ uncachedInput: 1_000_000 }) },
    { fail: "retryable", usage: usage({ uncachedInput: 2_000_000 }) },
    { reply: "hi", usage: usage({ uncachedInput: 1_000_000, output: 1_000_000 }) },
  ]);
  const result = await model.complete(context);
  assert.equal(result.stopReason, "stop");
  // $2 + $4 + ($2 + $16)
  assert.deepEqual(result.cost, { total: 24, basis: "catalog", currency: "USD", catalogAsOf: "2026-11-01" });
  assert.equal(result.usage.uncachedInput, 4_000_000);
});

test("each attempt is priced in its own tier, not the tier of the summed usage", async () => {
  const high = { ...FAKE_RATES, uncachedInput: 20 };
  const tiered: PriceCatalog = {
    models: [fakeEntry({ rates: [{ ...FAKE_RATES, upToInputTokens: 1_000_000 }, high] })],
  };
  const adapter = new FailingAdapter([
    { fail: "retryable", usage: usage({ uncachedInput: 1_000_000 }) },
    { reply: "hi", usage: usage({ uncachedInput: 1_000_000 }) },
  ]);
  const model = createModel({ adapter, id: "priced", catalog: tiered, sleep: recordingSleep().sleep });
  // Summed, the call has 2M input tokens, which would select the $20 tier; each request alone has 1M.
  assert.equal((await model.complete(context)).cost.total, 4);
});

test("an attempt whose stream throws costs nothing, so the call keeps a known total", async () => {
  let calls = 0;
  const adapter: ModelAdapter = {
    specificationVersion: "v1",
    api: "test-api",
    provider: "test",
    defaultCaps: TEST_CAPS,
    async *stream(model): AsyncGenerator<ModelEvent> {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      const reply = message("stop", [], { model, usage: usage({ uncachedInput: 1_000_000 }) });
      yield { type: "start" };
      yield { type: "done", message: reply };
    },
  };
  const model = createModel({ adapter, id: "priced", catalog, sleep: recordingSleep().sleep });
  const result = await model.complete(context);
  assert.equal(calls, 2);
  assert.equal(result.cost.total, 2);
});

test("the cacheRetention option reaches the adapter unchanged", async () => {
  const { adapter, model } = pricedModel([{ reply: "hi" }]);
  await model.complete(context, { cacheRetention: "long" });
  assert.equal(adapter.calls[0]?.cacheRetention, "long");
});

const firstTurn: ModelContext = {
  system: "s".repeat(25),
  tools: [{ name: "read", description: "d".repeat(10), inputSchema: { type: "object" } }],
  messages: [{ role: "user", content: [{ type: "text", text: "u".repeat(50) }] }],
};

test("a context with no reported usage is estimated from its characters", () => {
  // 25 system + 4 name + 10 description + 17 schema + 50 text = 106 characters, at 2.5 per token.
  assert.equal(estimateInputTokens(firstTurn), Math.ceil(106 / 2.5));
});

test("an image counts as a fixed number of tokens, not its base64 length", () => {
  const withImage: ModelContext = {
    ...firstTurn,
    messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", data: "A".repeat(100_000) }] }],
  };
  assert.equal(estimateInputTokens(withImage), Math.ceil(56 / 2.5 + 4784));
});

test("a context with a reported call starts from that call's input and output", () => {
  const reply = message("tool_calls", [], { usage: usage({ uncachedInput: 900, cacheRead: 100, output: 40 }) });
  const later: ModelContext = {
    ...firstTurn,
    messages: [
      ...firstTurn.messages,
      reply,
      { role: "tool", callId: "c1", content: [{ type: "text", text: "r".repeat(25) }], isError: false },
    ],
  };
  // 1,000 reported input + 40 reported output + 25 characters of tool result.
  assert.equal(estimateInputTokens(later), 1040 + 10);
});

test("projectCallCost() and projectCost() agree on one scripted context", () => {
  const { model } = pricedModel([]);
  const inputTokens = estimateInputTokens(firstTurn);
  const expected = projectCost({ inputTokens, maxOutputTokens: model.caps.maxOutputTokens }, entry);
  assert.deepEqual(projectCallCost(model, firstTurn), expected);
  assert.equal(expected.total, (inputTokens * 2 + model.caps.maxOutputTokens * 16) / 1_000_000);
});

test("projectCallCost() uses the call's maxOutputTokens over the model's limit", () => {
  const { model } = pricedModel([]);
  const inputTokens = estimateInputTokens(firstTurn);
  const expected = projectCost({ inputTokens, maxOutputTokens: 7 }, entry);
  assert.deepEqual(projectCallCost(model, firstTurn, { maxOutputTokens: 7 }), expected);
});

test("projectCallCost() and projectCost() project an unknown price for a model the catalog lacks", () => {
  const { model } = pricedModel([], "unlisted");
  assert.equal(projectCallCost(model, firstTurn).total, null);
  assert.equal(projectCost({ inputTokens: 1, maxOutputTokens: 1 }, undefined).basis, "unknown");
});
