/**
 * The `PlanLedger` conformance cases: what every ledger must do for a plan's steps to pass verification once each, in
 * order. The memory ledger runs them in this package's tests, and each durable ledger runs the same list. The cases
 * throw plain `Error`s and import no test runner, so any runner, and workerd, can call them.
 */
import type { PlanLedger } from "./plan-approval.js";

/** One conformance case: a name a test runner can show, and a check that rejects if the ledger breaks the rule. */
export interface PlanLedgerCase {
  /** What the case checks, as a sentence. */
  readonly name: string;
  /** Runs the check against a fresh, empty ledger from `makeLedger`. */
  run(makeLedger: () => PlanLedger | Promise<PlanLedger>): Promise<void>;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`PlanLedger conformance: ${message}`);
}

const CASES: readonly PlanLedgerCase[] = [
  {
    name: "claim passes each step once, in order, and answers replayed for a step that already passed",
    async run(makeLedger) {
      const ledger = await makeLedger();
      check((await ledger.claim("plan-1", 0)) === "claimed", "the first step must be claimed");
      check((await ledger.claim("plan-1", 1)) === "claimed", "the next step must be claimed");
      check((await ledger.claim("plan-1", 0)) === "replayed", "a step that passed must be replayed");
      check((await ledger.claim("plan-1", 1)) === "replayed", "the latest step that passed must be replayed");
    },
  },
  {
    name: "claim refuses a step whose earlier steps have not passed, as out_of_order",
    async run(makeLedger) {
      const ledger = await makeLedger();
      check((await ledger.claim("plan-1", 1)) === "out_of_order", "a first claim of step 2 must be out of order");
      check((await ledger.claim("plan-1", 5)) === "out_of_order", "a claim far ahead must be out of order");
      await ledger.claim("plan-1", 0);
      check((await ledger.claim("plan-1", 2)) === "out_of_order", "a claim that skips a step must be out of order");
    },
  },
  {
    name: "a refused claim uses nothing up: the step it named can still be claimed in its turn",
    async run(makeLedger) {
      const ledger = await makeLedger();
      await ledger.claim("plan-1", 2);
      await ledger.claim("plan-1", 1);
      check((await ledger.claim("plan-1", 0)) === "claimed", "step 1 must still be claimable after refused claims");
      check((await ledger.claim("plan-1", 1)) === "claimed", "step 2 must still be claimable after a refused claim");
      check((await ledger.claim("plan-1", 2)) === "claimed", "step 3 must still be claimable after a refused claim");
    },
  },
  {
    name: "a replayed claim uses nothing up: the next step is still claimed once",
    async run(makeLedger) {
      const ledger = await makeLedger();
      await ledger.claim("plan-1", 0);
      for (let i = 0; i < 4; i++) await ledger.claim("plan-1", 0);
      check((await ledger.claim("plan-1", 1)) === "claimed", "the next step must be claimed after replays");
      check((await ledger.claim("plan-1", 1)) === "replayed", "and claimed only once");
    },
  },
  {
    name: "of many concurrent claims of one step, exactly one is claimed and the rest are replayed",
    async run(makeLedger) {
      const ledger = await makeLedger();
      const answers = await Promise.all(Array.from({ length: 8 }, () => ledger.claim("plan-1", 0)));
      check(answers.filter((answer) => answer === "claimed").length === 1, "exactly one claim must win");
      check(
        answers.every((answer) => answer === "claimed" || answer === "replayed"),
        "the rest must be replayed",
      );
      const next = await Promise.all(Array.from({ length: 8 }, () => ledger.claim("plan-1", 1)));
      check(next.filter((answer) => answer === "claimed").length === 1, "exactly one claim of the next step must win");
    },
  },
  {
    name: "claim rejects a step index that is not a whole number of 0 or more, and uses nothing up",
    async run(makeLedger) {
      const ledger = await makeLedger();
      await ledger.claim("plan-1", 0);
      for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
        let rejected = false;
        await ledger.claim("plan-1", bad).catch(() => {
          rejected = true;
        });
        check(rejected, `a claim of step ${String(bad)} must be rejected`);
      }
      check(
        (await ledger.claim("plan-1", 1)) === "claimed",
        "the next step must still be claimed after the rejections",
      );
    },
  },
  {
    name: "plans keep separate progress",
    async run(makeLedger) {
      const ledger = await makeLedger();
      await ledger.claim("plan-a", 0);
      await ledger.claim("plan-a", 1);
      check((await ledger.claim("plan-b", 0)) === "claimed", "another plan's first step must be claimed");
      check((await ledger.claim("plan-b", 2)) === "out_of_order", "another plan's progress must not count");
      check((await ledger.claim("plan-a", 2)) === "claimed", "a plan must keep its own progress");
    },
  },
];

/**
 * The cases every `PlanLedger` must pass. Run each against a fresh ledger:
 *
 * @example
 * ```ts
 * for (const conformance of planLedgerConformance()) {
 *   test(conformance.name, () => conformance.run(() => myPlanLedger()));
 * }
 * ```
 */
export function planLedgerConformance(): readonly PlanLedgerCase[] {
  return CASES;
}
