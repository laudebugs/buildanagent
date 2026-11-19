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

test("a fixture counts as a loss when pi-schema misses an instance the fallback gets right, even at equal scores", () => {
  const row = (pi: boolean[], cf: boolean[]) => ({
    fixture: { name: "tie" },
    pi: { right: pi, correct: pi.filter(Boolean).length },
    cf: { right: cf, correct: cf.filter(Boolean).length },
  });
  const losses = piSchemaLosses([{ rows: [row([true, false, true], [true, true, false])] }]);
  assert.equal(losses.length, 1);
});
