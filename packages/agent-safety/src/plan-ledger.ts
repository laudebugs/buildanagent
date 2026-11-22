/**
 * `memoryPlanLedger()`: the in-memory `PlanLedger`, which records each plan step that passed verification so a
 * replayed approval can't run a step twice and no step runs before the steps ahead of it.
 */
import { SafetyError } from "./errors.js";
import type { PlanLedger } from "./plan-approval.js";

// The largest step index a ledger accepts, which a 32-bit integer column holds, as Postgres's does. A plan has a
// handful of steps, so the bound costs nothing, and every ledger answers an index beyond it the same way.
const MAX_STEP_INDEX = 2 ** 31 - 1;

/**
 * Refuses a step index that is not a whole number from 0 to 2 ** 31 - 1. Every ledger checks its argument with this
 * before it reads anything, because a negative index would compare as "already passed" and a fractional one as "out of
 * order", and neither names a step. Throws a `SafetyError`, code `invalid_plan`.
 */
export function assertStepIndex(stepIndex: unknown): asserts stepIndex is number {
  if (!Number.isSafeInteger(stepIndex) || (stepIndex as number) < 0 || (stepIndex as number) > MAX_STEP_INDEX) {
    throw new SafetyError("invalid_plan", "a plan ledger's step index must be a whole number from 0 to 2147483647");
  }
}

/**
 * A `PlanLedger` that keeps each plan's progress in memory, for tests and single-process hosts. It forgets
 * everything when the process ends, after which a replayed approval would pass again, so a host whose plans can
 * resume in another process needs a durable ledger. It never forgets a plan while the process lives, because
 * forgetting one would let its approval run again; each plan costs one map entry.
 */
export function memoryPlanLedger(): PlanLedger {
  // The number of steps of each plan that have passed, so the next step to claim is at this index.
  const passed = new Map<string, number>();
  return Object.freeze({
    async claim(planId: string, stepIndex: number) {
      assertStepIndex(stepIndex);
      const next = passed.get(planId) ?? 0;
      if (stepIndex < next) return "replayed" as const;
      if (stepIndex > next) return "out_of_order" as const;
      // No await between the read and the write, so two claims of one step can't both pass.
      passed.set(planId, next + 1);
      return "claimed" as const;
    },
  });
}
