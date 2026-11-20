import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultCatalog,
  findCatalogEntry,
  isGatewayError,
  parseCatalog,
  staleCatalogEntries,
} from "@buildanagent/gateway";
import { test } from "vitest";
import { FAKE_RATES, fakeEntry } from "./fixtures.js";

const shippedJson: unknown = JSON.parse(readFileSync(new URL("../src/catalog.json", import.meta.url), "utf8"));

function rejects(value: unknown, pattern: RegExp): void {
  assert.throws(
    () => parseCatalog(value),
    (error) => isGatewayError(error) && error.code === "invalid_catalog" && pattern.test(error.message),
  );
}

function withEntry(overrides: Record<string, unknown>): unknown {
  return { models: [{ ...fakeEntry(), ...overrides }] };
}

test("the shipped catalog.json passes the catalog schema", () => {
  assert.deepEqual(parseCatalog(shippedJson), defaultCatalog);
  assert.ok(defaultCatalog.models.length > 0);
});

test("every shipped entry carries contextWindow and maxOutputTokens, each with an https source URL", () => {
  for (const entry of defaultCatalog.models) {
    assert.ok(Number.isInteger(entry.contextWindow) && entry.contextWindow > 0, `${entry.id} contextWindow`);
    assert.ok(Number.isInteger(entry.maxOutputTokens) && entry.maxOutputTokens > 0, `${entry.id} maxOutputTokens`);
    assert.match(entry.sources.contextWindow, /^https:\/\//);
    assert.match(entry.sources.maxOutputTokens, /^https:\/\//);
    assert.match(entry.sources.rates, /^https:\/\//);
  }
});

test("an entry without a source URL for its limits is rejected", () => {
  const { contextWindow: _cw, ...sources } = fakeEntry().sources;
  rejects(withEntry({ sources }), /sources\.contextWindow must be/);
  const { maxOutputTokens: _max, ...limits } = fakeEntry();
  rejects({ models: [limits] }, /maxOutputTokens must be a positive integer/);
});

test("a negative rate, an open middle tier or tiers out of order are rejected", () => {
  rejects(withEntry({ rates: [{ ...FAKE_RATES, output: -1 }] }), /rates\[0\]\.output/);
  rejects(withEntry({ rates: [{ ...FAKE_RATES, upToInputTokens: 10 }] }), /must be null on the last tier/);
  rejects(withEntry({ rates: [FAKE_RATES, FAKE_RATES] }), /rates\[0\]\.upToInputTokens must be a positive integer/);
  const tiers = [{ ...FAKE_RATES, upToInputTokens: 20 }, { ...FAKE_RATES, upToInputTokens: 10 }, FAKE_RATES];
  rejects(withEntry({ rates: tiers }), /ascending order/);
  rejects(withEntry({ rates: [] }), /non-empty array/);
});

test("an asOf that is not a calendar date is rejected", () => {
  rejects(withEntry({ asOf: "November 2026" }), /asOf must be a date/);
  rejects(withEntry({ asOf: "2026-02-30" }), /asOf must be a date/);
});

test("an asOf with a month or day out of range is an invalid_catalog error, not a RangeError", () => {
  rejects(withEntry({ asOf: "2026-13-01" }), /asOf must be a date/);
  rejects(withEntry({ asOf: "2026-11-32" }), /asOf must be a date/);
});

test("a retires date parses, a malformed one is rejected and a missing one stays absent", () => {
  assert.equal(parseCatalog(withEntry({ retires: "2027-03-01" })).models[0]?.retires, "2027-03-01");
  assert.equal("retires" in (parseCatalog(withEntry({})).models[0] ?? {}), false);
  rejects(withEntry({ retires: "March 2027" }), /models\[0\]\.retires must be a date/);
  rejects(withEntry({ retires: "2027-02-30" }), /retires must be a date/);
  rejects(withEntry({ retires: 20270301 }), /retires must be a non-empty string/);
  rejects(withEntry({ retires: "" }), /retires must be a non-empty string/);
});

test("gpt-5.4-mini's contextWindow is its 272,000-token input limit, not its 400,000-token window", () => {
  assert.equal(findCatalogEntry(defaultCatalog, "openai", "gpt-5.4-mini")?.contextWindow, 272_000);
});

test("two entries for one model are rejected", () => {
  rejects({ models: [fakeEntry(), fakeEntry()] }, /lists test\/priced twice/);
});

test("entries whose provider/id joins match are still two different models", () => {
  const nested = {
    models: [
      fakeEntry({ provider: "openrouter/meta", id: "llama" }),
      fakeEntry({ provider: "openrouter", id: "meta/llama" }),
    ],
  };
  assert.equal(parseCatalog(nested).models.length, 2);
});

test("findCatalogEntry() matches on provider and id", () => {
  const catalog = { models: [fakeEntry(), fakeEntry({ provider: "other" })] };
  assert.equal(findCatalogEntry(catalog, "other", "priced")?.provider, "other");
  assert.equal(findCatalogEntry(catalog, "test", "missing"), undefined);
});

// The check of the shipped catalog against today's date runs in CI (scripts/ci/catalog-staleness.mjs), because a
// test that reads the wall clock is not deterministic.
test("staleCatalogEntries() returns the entries dated more than 90 days before the given clock", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const catalog = {
    models: [fakeEntry({ id: "old", asOf: "2026-08-20" }), fakeEntry({ id: "recent", asOf: "2026-08-22" })],
  };
  assert.deepEqual(
    staleCatalogEntries(catalog, now).map((e) => e.id),
    ["old"],
  );
});
