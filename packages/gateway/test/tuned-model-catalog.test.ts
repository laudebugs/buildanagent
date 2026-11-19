import assert from "node:assert/strict";
import {
  type CatalogEntry,
  type Cost,
  createModel,
  defaultCatalog,
  emptyUsage,
  parseCatalog,
  type Usage,
} from "@buildanagent/gateway";
import { test } from "vitest";
import { FailingAdapter } from "./adapters.js";

/** A stand-in for the OpenAI adapter: the catalog matches on the adapter's provider name. */
class OpenAiNamed extends FailingAdapter {
  override readonly provider = "openai";
}

// The README's tuned-model sample shows this entry, so the sample has a type-checked, tested copy.
const tunedMini: CatalogEntry = {
  provider: "openai",
  id: "ft:gpt-4.1-mini-2025-04-14:my-org::AbC123xy",
  rates: [
    {
      upToInputTokens: null,
      uncachedInput: 0.8,
      cacheRead: 0.2,
      // OpenAI's pricing page lists no cache-write charge for this model, so a write costs the uncached input rate.
      cacheWrite: { "5m": 0.8, "1h": 0.8 },
      output: 3.2,
    },
  ],
  contextWindow: 1_047_576,
  maxOutputTokens: 32_768,
  asOf: "2026-11-19",
  sources: {
    rates: "https://developers.openai.com/api/docs/pricing",
    contextWindow: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
    maxOutputTokens: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
  },
  note: "An example copied on 2026-11-19, not a price to rely on: tuned GPT-4.1 mini costs twice the base rates, and the limits are the base model's.",
};

const ONE_MILLION: Usage = { ...emptyUsage(), uncachedInput: 1_000_000, output: 1_000_000 };

function priceOf(models: readonly CatalogEntry[], id: string): Cost {
  const catalog = parseCatalog({ models });
  const adapter = new OpenAiNamed([]);
  return createModel({ adapter, id, catalog }).price(ONE_MILLION);
}

test("a catalog spread from defaultCatalog with a tuned entry prices the tuned model and a shipped one", () => {
  const models = [...defaultCatalog.models, tunedMini];
  assert.deepEqual(priceOf(models, tunedMini.id), {
    total: 0.8 + 3.2,
    basis: "catalog",
    currency: "USD",
    catalogAsOf: "2026-11-19",
  });
  assert.equal(priceOf(models, "gpt-5.4-mini").basis, "catalog");
});

test("a catalog holding only the tuned entry leaves a shipped model's price unknown", () => {
  assert.equal(priceOf([tunedMini], tunedMini.id).basis, "catalog");
  const shipped = priceOf([tunedMini], "gpt-5.4-mini");
  assert.equal(shipped.basis, "unknown");
  assert.equal(shipped.total, null);
});

test("the shipped catalog prices no tuned model", () => {
  assert.equal(priceOf(defaultCatalog.models, tunedMini.id).basis, "unknown");
});
