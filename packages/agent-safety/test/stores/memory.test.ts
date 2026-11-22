import { memoryEffectStore, memoryPlanLedger } from "@buildanagent/agent-safety";
import { effectStoreConformance, planLedgerConformance } from "@buildanagent/agent-safety/testing";
import { test } from "vitest";
import { leaseScenario } from "./scenario.js";

// The memory store and ledger are the reference: the same cases that each durable store runs.
for (const conformance of planLedgerConformance()) {
  test(`memory plan ledger: ${conformance.name}`, () => conformance.run(() => memoryPlanLedger()));
}

test("memory: a started record is taken over only after its lease lapses", () =>
  leaseScenario(() => memoryEffectStore()));

test("the conformance lists are not empty, so a store can't pass by running nothing", () => {
  if (effectStoreConformance().length < 8 || planLedgerConformance().length < 6) throw new Error("a list shrank");
});
