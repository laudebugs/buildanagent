// Offline tests for catalog-staleness.mjs; run with `node --test scripts/ci/*.test.mjs`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { staleWarnings } from "./catalog-staleness.mjs";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const entry = (id, asOf) => ({ provider: "test", id, asOf, sources: { rates: "https://provider.test/pricing" } });

test("warns only about entries copied more than 90 days before now", () => {
  const warnings = staleWarnings({ models: [entry("old", "2026-08-20"), entry("recent", "2026-08-22")] }, NOW);
  assert.deepEqual(warnings, [
    "price catalog: test/old was copied on 2026-08-20, more than 90 days ago; refresh it from https://provider.test/pricing",
  ]);
});
