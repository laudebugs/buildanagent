/**
 * `memoryPlanLedger()`: the in-memory `PlanLedger`, which records each plan step that passed verification so a
 * replayed approval can't run a step twice and no step runs before the steps ahead of it.
 */
import type { PlanLedger } from "./plan-approval.js";

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
      const next = passed.get(planId) ?? 0;
      if (stepIndex < next) return "replayed" as const;
      if (stepIndex > next) return "out_of_order" as const;
      // No await between the read and the write, so two claims of one step can't both pass.
      passed.set(planId, next + 1);
      return "claimed" as const;
    },
  });
}
