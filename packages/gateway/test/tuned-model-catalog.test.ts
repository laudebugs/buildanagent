import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// The README's tuned-model sample shows this entry character for character, apart from whitespace, and the last test
// checks that it still does, so the sample's entry is type-checked and tested here. OpenAI's prompt-caching guide
// lists no cache-write charge for models before GPT-5.6, so a write costs the uncached input rate.
const tuned: CatalogEntry = {
  provider: "openai",
  id: "ft:gpt-4.1-mini-2025-04-14:my-org::AbC123xy",
  rates: [
    {
      upToInputTokens: null,
      uncachedInput: 0.8,
      cacheRead: 0.2,
      cacheWrite: { "5m": 0.8, "1h": 0.8 },
      output: 3.2,
    },
  ],
  contextWindow: 1_047_576,
  maxOutputTokens: 32_768,
  images: true,
  reasoning: false,
  asOf: "2026-11-19",
  sources: {
    rates: "https://developers.openai.com/api/docs/pricing",
    contextWindow: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
    maxOutputTokens: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
  },
  note: "Tuned rates copied on 2026-11-19. A cache write costs the uncached input rate. The limits and flags are the base model's.",
};

const ONE_MILLION: Usage = { ...emptyUsage(), uncachedInput: 1_000_000, output: 1_000_000 };

function priceOf(models: readonly CatalogEntry[] | undefined, id: string): Cost {
  const adapter = new OpenAiNamed([]);
  const options = models === undefined ? { adapter, id } : { adapter, id, catalog: parseCatalog({ models }) };
  return createModel(options).price(ONE_MILLION);
}

/** The `const tuned: CatalogEntry = { … };` literal in `text`, with its whitespace removed. */
function tunedLiteral(text: string): string {
  const start = text.indexOf("const tuned: CatalogEntry = {");
  assert.ok(start >= 0, "no tuned entry found");
  const end = text.indexOf("\n};\n", start);
  assert.ok(end > start, "the tuned entry is not closed");
  return text.slice(start, end + 3).replace(/\s+/g, "");
}

test("a catalog spread from defaultCatalog with a tuned entry prices the tuned model and a shipped one", () => {
  const models = [...defaultCatalog.models, tuned];
  assert.deepEqual(priceOf(models, tuned.id), {
    total: 0.8 + 3.2,
    basis: "catalog",
    currency: "USD",
    catalogAsOf: "2026-11-19",
  });
  assert.equal(priceOf(models, "gpt-5.4-mini").basis, "catalog");
});

test("a catalog holding only the tuned entry leaves a shipped model's price unknown", () => {
  assert.equal(priceOf([tuned], tuned.id).basis, "catalog");
  const shipped = priceOf([tuned], "gpt-5.4-mini");
  assert.equal(shipped.basis, "unknown");
  assert.equal(shipped.total, null);
});

test("the shipped catalog prices no tuned model", () => {
  assert.equal(priceOf(undefined, tuned.id).basis, "unknown");
  assert.equal(priceOf(defaultCatalog.models, tuned.id).basis, "unknown");
});

test("the tuned entry takes its limits and flags from the catalog, not the adapter's defaults", () => {
  const catalog = parseCatalog({ models: [...defaultCatalog.models, tuned] });
  const model = createModel({ adapter: new OpenAiNamed([]), id: tuned.id, catalog });
  assert.deepEqual(model.caps, { contextWindow: 1_047_576, maxOutputTokens: 32_768, images: true, reasoning: false });
});

test("the README's tuned-model sample shows the entry this file tests", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const here = readFileSync(new URL(import.meta.url), "utf8");
  assert.equal(tunedLiteral(readme), tunedLiteral(here));
});
