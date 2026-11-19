import assert from "node:assert/strict";
import {
  type Cost,
  createModel,
  emptyUsage,
  estimateInputTokens,
  isGatewayError,
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

/** An adapter whose first `throws` calls throw `error`, then replies with 1M uncached input tokens. */
function throwingAdapter(throws: number, error: Error): { adapter: ModelAdapter; calls: () => number } {
  let calls = 0;
  const adapter: ModelAdapter = {
    specificationVersion: "v1",
    api: "test-api",
    provider: "test",
    defaultCaps: TEST_CAPS,
    async *stream(model): AsyncGenerator<ModelEvent> {
      calls += 1;
      if (calls <= throws) throw error;
      const reply = message("stop", [], { model, usage: usage({ uncachedInput: 1_000_000 }) });
      yield { type: "start" };
      yield { type: "done", message: reply };
    },
  };
  return { adapter, calls: () => calls };
}

const UNKNOWN: Cost = { total: null, basis: "unknown", currency: "USD" };

test("an attempt whose stream throws leaves the call's cost unknown, not a known zero", async () => {
  // The request may have reached the provider and been billed before the stream threw, so its cost is unknown.
  const retried = throwingAdapter(1, new TypeError("fetch failed"));
  const model = createModel({ adapter: retried.adapter, id: "priced", catalog, sleep: recordingSleep().sleep });
  const result = await model.complete(context);
  assert.equal(retried.calls(), 2);
  assert.equal(result.usage.uncachedInput, 1_000_000);
  assert.deepEqual(result.cost, UNKNOWN);

  const final = throwingAdapter(1, new RangeError("bad content block"));
  const failed = await createModel({ adapter: final.adapter, id: "priced", catalog }).complete(context);
  assert.equal(failed.stopReason, "error");
  assert.deepEqual(failed.cost, UNKNOWN);
});

test("a stream that throws on abort reports an unknown cost, not a known zero", async () => {
  const { adapter } = throwingAdapter(1, new Error("The operation was aborted"));
  const controller = new AbortController();
  controller.abort();
  const result = await createModel({ adapter, id: "priced", catalog }).complete(context, { signal: controller.signal });
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(result.cost, UNKNOWN);
});

test("a sum of catalog estimates and provider bills is labelled catalog, with the catalog's date", async () => {
  const billed: Cost = { total: 0.5, basis: "provider", currency: "USD" };
  const run = (attempts: Attempt[]) => pricedModel(attempts).model.complete(context);
  const expected: Cost = { total: 2.5, basis: "catalog", currency: "USD", catalogAsOf: "2026-11-01" };
  const estimated = { usage: usage({ uncachedInput: 1_000_000 }) };
  assert.deepEqual(
    (
      await run([
        { fail: "retryable", ...estimated },
        { reply: "hi", cost: billed },
      ])
    ).cost,
    expected,
  );
  assert.deepEqual(
    (
      await run([
        { fail: "retryable", cost: billed },
        { reply: "hi", ...estimated },
      ])
    ).cost,
    expected,
  );
});

test("a sum of provider bills alone stays labelled provider", async () => {
  const billed: Cost = { total: 0.5, basis: "provider", currency: "USD" };
  const { model } = pricedModel([
    { fail: "retryable", cost: billed },
    { reply: "hi", cost: billed },
  ]);
  assert.deepEqual((await model.complete(context)).cost, { total: 1, basis: "provider", currency: "USD" });
});

test("createModel() rejects a caller's catalog that pricing cannot use", () => {
  const adapter = new FailingAdapter([]);
  const outOfOrder = [{ ...FAKE_RATES, upToInputTokens: 20 }, { ...FAKE_RATES, upToInputTokens: 10 }, FAKE_RATES];
  const bad: PriceCatalog[] = [
    { models: [fakeEntry({ rates: outOfOrder })] },
    { models: [fakeEntry({ rates: [{ ...FAKE_RATES, upToInputTokens: 10 }] })] },
    { models: [fakeEntry({ rates: [{ ...FAKE_RATES, output: -1 }] })] },
    { models: [fakeEntry({ rates: [{ ...FAKE_RATES, cacheRead: Number.NaN }] })] },
  ];
  for (const badCatalog of bad) {
    assert.throws(
      () => createModel({ adapter, id: "priced", catalog: badCatalog }),
      (error) => isGatewayError(error) && error.code === "invalid_catalog",
    );
  }
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

test("a retried call's estimate counts its last attempt's request, not every attempt's", async () => {
  const request = usage({ uncachedInput: 900, cacheRead: 100 });
  const { model } = pricedModel([
    { fail: "retryable", usage: request },
    { fail: "retryable", usage: request },
    { reply: "hi", usage: { ...request, output: 40 } },
  ]);
  const reply = await model.complete(context);
  assert.equal(reply.usage.uncachedInput, 2700);
  assert.deepEqual(reply.lastAttemptUsage, { ...request, output: 40 });
  const later: ModelContext = {
    ...firstTurn,
    messages: [...firstTurn.messages, reply, { role: "user", content: [{ type: "text", text: "r".repeat(25) }] }],
  };
  // 1,000 input + 40 output of the last request alone, plus 25 characters of the next user message.
  assert.equal(estimateInputTokens(later), 1040 + 10);
});

test("a call that was not retried carries no lastAttemptUsage", async () => {
  const { model } = pricedModel([{ reply: "hi", usage: usage({ uncachedInput: 10 }) }]);
  assert.equal("lastAttemptUsage" in (await model.complete(context)), false);
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
