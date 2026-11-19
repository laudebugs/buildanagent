// Offline tests for catalog-staleness.mjs; run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tsImport } from "tsx/esm/api";
import { staleWarnings } from "./catalog-staleness.mjs";

// The test compares against the gateway's real rule, read from its TypeScript source. tsx loads it, because the
// source's relative imports use `.js` specifiers for the dist/ build, which Node's own type stripping doesn't map
// back to `.ts` files.
const { staleCatalogEntries } = await tsImport("../../packages/gateway/src/catalog.ts", import.meta.url);

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
