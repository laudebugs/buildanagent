// Offline tests for catalog-staleness.mjs; run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { retirementWarnings, staleWarnings } from "./catalog-staleness.mjs";

// The test compares against the gateway's real rule, read from its TypeScript source. Under Node, tsx loads it,
// because the source's relative imports use `.js` specifiers for the dist/ build, which Node's own type stripping
// doesn't map back to `.ts` files. Bun maps them itself, and tsx's loader doesn't run under Bun, so Bun imports the
// source directly.
const CATALOG_SOURCE = "../../packages/gateway/src/catalog.ts";
const { staleCatalogEntries } = process.versions.bun
  ? await import(CATALOG_SOURCE)
  : await (await import("tsx/esm/api")).tsImport(CATALOG_SOURCE, import.meta.url);

const NOW = Date.parse("2026-11-19T12:00:00Z");
const entry = (id, asOf) => ({ provider: "test", id, asOf, sources: { rates: "https://provider.test/pricing" } });

test("warns only about entries copied more than 90 days before now", () => {
  const warnings = staleWarnings({ models: [entry("old", "2026-08-20"), entry("recent", "2026-08-22")] }, NOW);
  assert.deepEqual(warnings, [
    "price catalog: test/old was copied on 2026-08-20, more than 90 days ago; refresh it from https://provider.test/pricing",
  ]);
});

test("the script and the gateway's staleCatalogEntries() flag the same entries", () => {
  // NOW is midday, so 2026-08-21 is 90.5 days old and 2026-08-22 is 89.5: the boundary falls between them.
  const catalog = { models: ["2026-08-20", "2026-08-21", "2026-08-22"].map((asOf) => entry(asOf, asOf)) };
  const script = staleWarnings(catalog, NOW).map((w) => w.match(/test\/(\S+) was copied/)[1]);
  const gateway = staleCatalogEntries(catalog, new Date(NOW)).map((e) => e.id);
  assert.deepEqual(script, gateway);
  assert.deepEqual(gateway, ["2026-08-20", "2026-08-21"]);
});

const retiring = (id, retires) => ({ ...entry(id, "2026-11-19"), retires });

test("warns about a retirement date 90 days away and not 91, whatever the hour", () => {
  // 2026-11-19 plus 90 days is 2027-02-17.
  const catalog = { models: [retiring("on-boundary", "2027-02-17"), retiring("beyond", "2027-02-18")] };
  for (const hour of ["00:00:00", "12:00:00", "23:59:59"]) {
    const warnings = retirementWarnings(catalog, Date.parse(`2026-11-19T${hour}Z`));
    assert.equal(warnings.length, 1, hour);
    assert.match(warnings[0], /test\/on-boundary is recorded as retiring on 2027-02-17 \(in 90 days\)/);
  }
});

test("warns about a retirement date that is today or past, and says so", () => {
  const catalog = { models: [retiring("today", "2026-11-19"), retiring("gone", "2026-11-09")] };
  const [today, gone] = retirementWarnings(catalog, NOW);
  assert.match(today, /test\/today .*\(today\)/);
  assert.match(gone, /test\/gone .*\(10 days ago\)/);
});

test("a date one day away or one day past reads as one day, not one days", () => {
  const catalog = { models: [retiring("tomorrow", "2026-11-20"), retiring("yesterday", "2026-11-18")] };
  const [tomorrow, yesterday] = retirementWarnings(catalog, NOW);
  assert.match(tomorrow, /\(in 1 day\)/);
  assert.match(yesterday, /\(1 day ago\)/);
});

test("the warning asks for a refresh and entries without a date are skipped", () => {
  const catalog = { models: [entry("undated", "2026-11-19"), retiring("dated", "2027-01-01")] };
  assert.deepEqual(retirementWarnings(catalog, NOW), [
    "price catalog: test/dated is recorded as retiring on 2027-01-01 (in 43 days), as of 2026-11-19; " +
      "check the provider's deprecations page and refresh the entry",
  ]);
});
