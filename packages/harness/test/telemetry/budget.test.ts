// The session budget meter: one warning at 80% of the cap, an unknown price that makes the spend unknown, and a meter
// rebuilt from the log.
import assert from "node:assert/strict";
import type { Cost } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { type BudgetWarning, budgetMeterFromEntries, createBudgetMeter } from "@buildanagent/harness/telemetry";
import type { SessionEntry } from "@buildanagent/protocol";
import { beforeAll, describe, test } from "vitest";
import { capstoneEntries } from "./capstone.js";

const dollars = (total: number | null): Cost =>
  total === null ? { total, basis: "unknown", currency: "USD" } : { total, basis: "catalog", currency: "USD" };

describe("the warning", () => {
  test("at 80% of the cap the meter emits one budget_warning, and no more for later calls", () => {
    const warnings: BudgetWarning[] = [];
    const meter = createBudgetMeter({ capUsd: 1, onWarning: (event) => warnings.push(event) });
    meter.record(dollars(0.5));
    meter.record(dollars(0.29));
    assert.equal(warnings.length, 0, "79% is under the threshold");
    meter.record(dollars(0.01));
    assert.deepEqual(warnings, [{ type: "budget_warning", spentUsd: 0.8, capUsd: 1 }]);
    meter.record(dollars(0.1));
    meter.record(dollars(0.3));
    assert.equal(warnings.length, 1, "the warning fires once");
    assert.equal(meter.warned, true);
  });

  test("one call can take the spend past the threshold and the cap at once, and still warns once", () => {
    const warnings: BudgetWarning[] = [];
    const meter = createBudgetMeter({ capUsd: 2, onWarning: (event) => warnings.push(event) });
    meter.record(dollars(5));
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0]?.spentUsd, 5);
    assert.equal(meter.remainingUsd(), 0, "nothing is left, and the remainder never goes negative");
  });

  test("warnAt moves the threshold", () => {
    const warnings: BudgetWarning[] = [];
    const meter = createBudgetMeter({ capUsd: 10, warnAt: 0.5, onWarning: (event) => warnings.push(event) });
    meter.record(dollars(4.9));
    assert.equal(warnings.length, 0);
    meter.record(dollars(0.1));
    assert.equal(warnings.length, 1);
  });

  test("the remainder is the cap less the spend", () => {
    const meter = createBudgetMeter({ capUsd: 3 });
    meter.record(dollars(1.25));
    assert.equal(meter.spentUsd, 1.25);
    assert.equal(meter.remainingUsd(), 1.75);
  });
});

describe("an unknown price", () => {
  test("makes the spend unknown for good, never warns and refuses a budgeted turn", () => {
    const warnings: BudgetWarning[] = [];
    const meter = createBudgetMeter({ capUsd: 1, onWarning: (event) => warnings.push(event) });
    meter.record(dollars(0.1));
    meter.record(dollars(null));
    meter.record(dollars(0.5));
    assert.equal(meter.spentUsd, null);
    assert.equal(warnings.length, 0);
    assert.throws(
      () => meter.remainingUsd(),
      (error) => isHarnessError(error) && error.code === "budget_unknown",
    );
  });
});

describe("options", () => {
  test("a cap that is zero, negative or not finite, and a threshold outside (0, 1], are refused", () => {
    for (const capUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => createBudgetMeter({ capUsd }),
        (error) => isHarnessError(error) && error.code === "invalid_telemetry_options",
      );
    }
    for (const warnAt of [0, 1.1, -0.5]) {
      assert.throws(
        () => createBudgetMeter({ capUsd: 1, warnAt }),
        (error) => isHarnessError(error) && error.code === "invalid_telemetry_options",
      );
    }
  });
});

describe("a meter rebuilt from the log", () => {
  let entries: SessionEntry[] = [];
  let spent = 0;
  beforeAll(async () => {
    entries = await capstoneEntries(true);
    spent = entries.reduce((sum, entry) => (entry.type === "usage" ? sum + (entry.cost.total ?? 0) : sum), 0);
    assert.ok(spent > 0);
  });

  test("holds the spend of the log's usage entries, whatever else the entries hold", () => {
    const meter = budgetMeterFromEntries(entries, { capUsd: 1 });
    assert.equal(meter.spentUsd, spent);
    assert.equal(meter.remainingUsd(), 1 - spent);
  });

  test("is quiet about spend the log already holds, and warns once when later calls reach the threshold", () => {
    const warnings: BudgetWarning[] = [];
    const past = budgetMeterFromEntries(entries, { capUsd: spent * 1.1, onWarning: (event) => warnings.push(event) });
    assert.equal(past.warned, true);
    past.record(dollars(1));
    assert.equal(warnings.length, 0, "a client already heard it");
    const under = budgetMeterFromEntries(entries, { capUsd: spent * 2, onWarning: (event) => warnings.push(event) });
    assert.equal(under.warned, false);
    under.record(dollars(spent * 0.7));
    assert.equal(warnings.length, 1);
  });

  test("a log with an unknown price gives an unknown spend", async () => {
    const meter = budgetMeterFromEntries(await capstoneEntries(false), { capUsd: 1 });
    assert.equal(meter.spentUsd, null);
  });

  test("record and observe work as detached callbacks", () => {
    const { record, observe } = createBudgetMeter({ capUsd: 1 });
    record(dollars(0.25));
    for (const entry of entries) observe(entry);
    assert.ok(true, "neither threw for want of `this`");
  });

  test("observe() adds a usage entry's cost and ignores every other entry", () => {
    const meter = createBudgetMeter({ capUsd: 1 });
    for (const entry of entries) meter.observe(entry);
    assert.equal(meter.spentUsd, spent);
  });
});
