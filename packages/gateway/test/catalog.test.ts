import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  defaultCatalog,
  findCatalogEntry,
  isGatewayError,
  type PriceCatalog,
  parseCatalog,
  staleCatalogEntries,
} from "@buildanagent/gateway";
import { test } from "vitest";
import { FAKE_RATES, fakeEntry } from "./fixtures.ts";

const shippedJson: unknown = JSON.parse(readFileSync(new URL("../src/catalog.json", import.meta.url), "utf8"));

/** Warns once per entry whose `asOf` is more than 90 days before `now`, and returns the warnings. */
function warnAboutStaleEntries(catalog: PriceCatalog, now: Date, warn: (text: string) => void): string[] {
  const warnings = staleCatalogEntries(catalog, now).map(
    (e) =>
      `price catalog: ${e.provider}/${e.id} was copied on ${e.asOf}, more than 90 days ago; refresh it from ${e.sources.rates}`,
  );
  for (const warning of warnings) warn(warning);
  return warnings;
}

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

test("two entries for one model are rejected", () => {
  rejects({ models: [fakeEntry(), fakeEntry()] }, /lists test\/priced twice/);
});

test("findCatalogEntry() matches on provider and id", () => {
  const catalog = { models: [fakeEntry(), fakeEntry({ provider: "other" })] };
  assert.equal(findCatalogEntry(catalog, "other", "priced")?.provider, "other");
  assert.equal(findCatalogEntry(catalog, "test", "missing"), undefined);
});

test("the staleness check warns on an entry dated more than 90 days before the test clock", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const catalog = {
    models: [fakeEntry({ id: "old", asOf: "2026-08-20" }), fakeEntry({ id: "recent", asOf: "2026-08-22" })],
  };
  const warned: string[] = [];
  warnAboutStaleEntries(catalog, now, (text) => warned.push(text));
  assert.equal(warned.length, 1);
  assert.match(warned[0] ?? "", /test\/old was copied on 2026-08-20/);
});

test("the shipped catalog is checked for stale entries against today's date, as a warning", () => {
  // A warning, not a failure: an old price should prompt a refresh, not block an unrelated change.
  warnAboutStaleEntries(defaultCatalog, new Date(), (text) => console.warn(text));
});
