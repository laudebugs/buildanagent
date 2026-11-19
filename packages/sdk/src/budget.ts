/**
 * The USD budget (D9): the loop projects each call's cost before it sends the call, and ends the run `budget` when
 * the spend so far plus that projection would pass the cap. The projection is the gateway's `projectCallCost()`, the
 * same formula a caller uses outside the loop, so the loop's check and a caller's agree.
 */
import { type Cost, emptyUsage, type Model } from "@buildanagent/gateway";
import { SdkError } from "./errors.js";
import type { RunError } from "./result.js";

/** What a budget check decides before one call. */
export type BudgetVerdict =
  | { readonly kind: "allow" }
  | { readonly kind: "exceeded"; readonly reason: string; readonly spentUsd: number; readonly projectedUsd: number }
  | { readonly kind: "unknown"; readonly error: RunError };

/** Checks the `budgetUsd` option: a finite number of dollars that isn't negative. */
export function checkBudgetOption(budgetUsd: unknown): number | undefined {
  if (budgetUsd === undefined) return undefined;
  if (typeof budgetUsd !== "number" || !Number.isFinite(budgetUsd) || budgetUsd < 0) {
    throw new SdkError(
      "invalid_run_options",
      `budgetUsd must be a finite number of dollars, 0 or more, got ${String(budgetUsd)}`,
    );
  }
  return budgetUsd;
}

/**
 * The refusal a budgeted run starts with when its model has no price, or `undefined` when the price is known. A
 * budget can't be enforced against a price that is not there, and pricing the calls at zero would let the run spend
 * without bound (D4).
 */
export function unknownPriceError(model: Model): RunError | undefined {
  const probe = model.price({ ...emptyUsage(), uncachedInput: 1 });
  if (probe.total !== null) return undefined;
  const { provider, id } = model.ref;
  return {
    kind: "unknown_price",
    message: `the price of ${provider}/${id} is unknown, so a run with a budgetUsd can't check its spend; add the model to a catalog or drop the budget`,
  };
}

function unknownCost(what: string): RunError {
  return { kind: "unknown_price", message: `${what} unknown, so the budget can't be checked` };
}

/**
 * Decides whether the next call may go out. `spent` is what the run's earlier calls cost, and `projected` is what
 * `projectCallCost()` says the next call can cost at most. A cost that is unknown ends the run with `unknown_price`
 * and never counts as zero.
 */
export function checkBudget(budgetUsd: number, spent: Cost | undefined, projected: Cost): BudgetVerdict {
  if (spent?.total === null) return { kind: "unknown", error: unknownCost("an earlier call's cost is") };
  if (projected.total === null) return { kind: "unknown", error: unknownCost("the next call's projected cost is") };
  const spentUsd = spent?.total ?? 0;
  if (spentUsd + projected.total <= budgetUsd) return { kind: "allow" };
  const reason = `the run has spent ${dollars(spentUsd)} and the next call can cost up to ${dollars(projected.total)}, which passes the budget of ${dollars(budgetUsd)}`;
  return { kind: "exceeded", reason, spentUsd, projectedUsd: projected.total };
}

/** A dollar amount for a message, to six significant digits, so a float sum doesn't print as $0.054000000000000006. */
function dollars(usd: number): string {
  return `$${Number(usd.toPrecision(6))}`;
}
