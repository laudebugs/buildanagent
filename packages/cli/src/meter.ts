/**
 * The meter: what a session has cost so far and how full its context is, read from the events a turn streams. It
 * warns once a session when the context passes 80% of its budget, and once a run when the run's spend passes 80% of
 * `--budget`, so you see the warning before the budget stops the run or the context has to be summarised. The budget
 * is per run, as the harness applies it: a turn is one run, and each resume after an answer is another.
 */
import type { HarnessEvent } from "@buildanagent/protocol";
import type { AgentEvent } from "@buildanagent/sdk";

/** The share of a limit at which the meter warns. */
export const WARN_AT = 0.8;

/** A warning or reading the meter reports. */
export type MeterNote =
  | { readonly kind: "context_warning"; readonly tokens: number; readonly budget: number }
  | { readonly kind: "budget_warning"; readonly spentUsd: number; readonly capUsd: number };

/** The meter's totals. */
export interface MeterReading {
  /** The cost of every priced call in US dollars. */
  readonly costUsd: number;
  /** How many calls had no price, so `costUsd` leaves them out. */
  readonly unpriced: number;
  /** The last context fill, when the harness reported one. */
  readonly fill?: { readonly tokens: number; readonly budget: number };
}

/** Counts cost and context fill for one session, and says when to warn. */
export class Meter {
  readonly #budgetUsd: number | undefined;
  #costUsd = 0;
  #runCostUsd = 0;
  #unpriced = 0;
  #fill: { tokens: number; budget: number } | undefined;
  #contextWarned = false;
  #budgetWarned = false;

  /** `budgetUsd` is the spend cap of each run, when it has one. */
  constructor(budgetUsd?: number) {
    this.#budgetUsd = budgetUsd;
  }

  /**
   * Takes one event and returns the warnings it causes: the context warning at most once a session, and the budget
   * warning at most once a run. A `replayed` event, read back from the log, counts toward the session's totals but
   * never warns, so it leaves both warnings for the live runs that follow.
   */
  observe(event: AgentEvent | HarnessEvent, replayed = false): MeterNote[] {
    if (event.type === "run_start") {
      // A nested run streams into its parent's run, which keeps one budget.
      if (event.parentRunId === undefined) this.#startRun();
      return [];
    }
    if (event.type === "context_fill") return this.#contextFill(event.tokens, event.budget, replayed);
    if (event.type === "budget_warning") {
      if (replayed || this.#budgetWarned) return [];
      this.#budgetWarned = true;
      return [{ kind: "budget_warning", spentUsd: event.spentUsd, capUsd: event.capUsd }];
    }
    if (event.type !== "entry_appended" || event.entry.type !== "usage") return [];
    const total = event.entry.cost.total;
    if (total === null) this.#unpriced += 1;
    else {
      this.#costUsd += total;
      this.#runCostUsd += total;
    }
    return replayed ? [] : this.#checkBudget();
  }

  #contextFill(tokens: number, budget: number, replayed: boolean): MeterNote[] {
    this.#fill = { tokens, budget };
    if (replayed || this.#contextWarned || budget <= 0 || tokens < budget * WARN_AT) return [];
    this.#contextWarned = true;
    return [{ kind: "context_warning", tokens, budget }];
  }

  #startRun(): void {
    this.#runCostUsd = 0;
    this.#budgetWarned = false;
  }

  #checkBudget(): MeterNote[] {
    const cap = this.#budgetUsd;
    if (cap === undefined || this.#budgetWarned || this.#runCostUsd < cap * WARN_AT) return [];
    this.#budgetWarned = true;
    return [{ kind: "budget_warning", spentUsd: this.#runCostUsd, capUsd: cap }];
  }

  /** The totals so far. */
  reading(): MeterReading {
    return {
      costUsd: this.#costUsd,
      unpriced: this.#unpriced,
      ...(this.#fill === undefined ? {} : { fill: this.#fill }),
    };
  }
}

const percent = (part: number, whole: number): string => `${Math.round((part / whole) * 100)}%`;
const usd = (value: number): string => `$${value.toFixed(4)}`;

/** One line for a warning. */
export function warningText(note: MeterNote): string {
  return note.kind === "context_warning"
    ? `warning: the context is ${percent(note.tokens, note.budget)} full (${note.tokens} of ${note.budget} tokens)`
    : `warning: this turn has spent ${usd(note.spentUsd)}, ${percent(note.spentUsd, note.capUsd)} of its ${usd(note.capUsd)} budget`;
}

/** One status line: the cost so far, and the context fill when the harness reported one. */
export function readingText(reading: MeterReading): string {
  const unpriced = reading.unpriced === 0 ? "" : ` (+${reading.unpriced} unpriced)`;
  const cost = `cost ${usd(reading.costUsd)}${unpriced}`;
  if (reading.fill === undefined || reading.fill.budget <= 0) return cost;
  const { tokens, budget } = reading.fill;
  return `context ${percent(tokens, budget)} (${tokens} of ${budget} tokens) · ${cost}`;
}
