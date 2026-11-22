/**
 * The session budget meter: folds the `usage` entries of a session into its spend, tells the caller how much of the cap
 * is left for the next turn, and reports once when the spend reaches 80% of the cap. The log is the source, so a meter
 * rebuilt from the entries of a branch holds the same spend as the one that ran the session.
 */
import type { Cost } from "@buildanagent/gateway";
import type { HarnessEvent, SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";

/** The fraction of the cap at which the meter warns, unless the caller sets another. */
export const DEFAULT_WARN_AT = 0.8;

/** The protocol event a meter emits when the spend reaches the warning threshold. */
export type BudgetWarning = Extract<HarnessEvent, { type: "budget_warning" }>;

/** Options for `createBudgetMeter()`. */
export interface BudgetMeterOptions {
  /** The session's cap in US dollars. A positive, finite number. */
  readonly capUsd: number;
  /** The fraction of the cap that triggers the warning, above 0 and at most 1. Default `DEFAULT_WARN_AT`. */
  readonly warnAt?: number;
  /** Called once, with the event the harness sends clients, when the spend first reaches `warnAt` of the cap. */
  readonly onWarning?: (event: BudgetWarning) => void;
}

/** A session's running spend against its cap. */
export interface BudgetMeter {
  /** The session's cap in US dollars. */
  readonly capUsd: number;
  /** What the session has spent, or `null` once any call's price was unknown, since the sum is then unknown too. */
  readonly spentUsd: number | null;
  /** Whether the warning has fired, or the spend was already past the threshold when the meter was rebuilt. */
  readonly warned: boolean;
  /** Adds one call's cost to the spend, and warns if that takes the spend to the threshold. */
  record(cost: Cost): void;
  /** Adds the cost of a `usage` entry. Any other entry changes nothing. */
  observe(entry: SessionEntry): void;
  /**
   * What the next turn may spend: the cap less the spend, never below zero, to pass as the turn's `budgetUsd`. Throws
   * a `HarnessError` with code `budget_unknown` when the spend is unknown, because a turn with a limit it cannot
   * measure against has no limit.
   */
  remainingUsd(): number;
}

function invalid(message: string): HarnessError {
  return new HarnessError("invalid_telemetry_options", message);
}

function validated(options: BudgetMeterOptions): { capUsd: number; warnAt: number } {
  const { capUsd } = options;
  const warnAt = options.warnAt ?? DEFAULT_WARN_AT;
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw invalid(`capUsd must be a positive number, not ${capUsd}`);
  if (!(warnAt > 0 && warnAt <= 1)) throw invalid(`warnAt must be above 0 and at most 1, not ${warnAt}`);
  return { capUsd, warnAt };
}

/** A meter that starts with `spent` already counted, and has already warned when that is past the threshold. */
function meterFrom(options: BudgetMeterOptions, start: number | null): BudgetMeter {
  const { capUsd, warnAt } = validated(options);
  let spent = start;
  let warned = spent !== null && spent >= capUsd * warnAt;
  return {
    capUsd,
    get spentUsd() {
      return spent;
    },
    get warned() {
      return warned;
    },
    record(cost) {
      spent = spent === null || cost.total === null ? null : spent + cost.total;
      if (spent === null || warned || spent < capUsd * warnAt) return;
      warned = true;
      options.onWarning?.({ type: "budget_warning", spentUsd: spent, capUsd });
    },
    observe(entry) {
      if (entry.type === "usage") this.record(entry.cost);
    },
    remainingUsd() {
      if (spent === null) {
        throw new HarnessError("budget_unknown", "a call's price is unknown, so the session's spend is unknown");
      }
      return Math.max(0, capUsd - spent);
    },
  };
}

/** Creates a meter with nothing spent. */
export const createBudgetMeter = (options: BudgetMeterOptions): BudgetMeter => meterFrom(options, 0);

/**
 * Rebuilds a meter from the entries of one branch, such as a session reopened after a restart. The warning does not
 * fire for spend the entries already hold, because a client that heard it once need not hear it again; it fires once
 * if later calls take a spend still under the threshold up to it. A branch with an unknown price gives an unknown
 * spend, which never warns.
 */
export function budgetMeterFromEntries(entries: Iterable<SessionEntry>, options: BudgetMeterOptions): BudgetMeter {
  let spent: number | null = 0;
  for (const entry of entries) {
    if (entry.type !== "usage") continue;
    spent = spent === null || entry.cost.total === null ? null : spent + entry.cost.total;
  }
  return meterFrom(options, spent);
}
