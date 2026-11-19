import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
// @ts-expect-error: the check script is plain JavaScript and ships no types.
import { piSchemaLosses, REPORT, renderReport, runCheck } from "../scripts/validator-check.mjs";

const sets = runCheck();

test("pi-schema judges no fixture instance wrong that @cfworker/json-schema judges right", () => {
  assert.deepEqual(
    piSchemaLosses(sets).map((row: { fixture: { name: string } }) => row.fixture.name),
    [],
  );
});

test("docs/validator-check.md matches a fresh run of the check", () => {
  assert.equal(readFileSync(REPORT, "utf8"), renderReport(sets));
});
