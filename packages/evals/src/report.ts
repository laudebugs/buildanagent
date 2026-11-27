/**
 * `report()`: pass@1 with its Wilson interval and pass^k beside the cost, tokens, steps, preamble and prompts of a
 * task, for each harness in a set of eval rows (build-harness.md §5.5).
 */
import { totalInput } from "@buildanagent/gateway";
import { EvalsError } from "./errors.js";
import { checkRows, type EvalRow, isGraded, type Outcome, outcomeOf } from "./row.js";
import { type Interval, passHatK, wilson } from "./stats.js";

/** Which rows `report()` reads, and the k of its pass^k. */
export interface ReportOptions {
  /** The k of pass^k: how many trials of a task must all pass. A whole number, 1 or more. */
  readonly k: number;
  /** Keep only this harness's rows. */
  readonly harness?: string;
  /** Keep only rows whose `tags` hold this tag, such as `"safety"`. */
  readonly tag?: string;
  /**
   * Keep only this ablation's rows. A harness whose kept rows span several ablations is refused, because pooling
   * their trials would mix two configurations in one pass^k.
   */
  readonly ablation?: string;
}

/** How a harness's trials came out. Each trial counts in exactly one of the four. */
export interface OutcomeCounts {
  /** Graded and passed. */
  readonly passed: number;
  /** Graded and failed. */
  readonly failed: number;
  /** Not graded because the infrastructure failed. Never counted as a failure. */
  readonly infraError: number;
  /** Not graded because the grader could not decide (`judge_unknown`). Neither a pass nor a fail. */
  readonly unscored: number;
}

/**
 * What one attempt at a task took, as a mean over every trial of the harness, infra errors and ungraded trials
 * included, because each of them was run and paid for.
 */
export interface PerTask {
  /** The mean cost in US dollars, or `null` when any trial's cost is unknown: an unknown is never read as zero. */
  readonly costUsd: number | null;
  /** The mean input tokens, cached and uncached together. */
  readonly inputTokens: number;
  /** The mean output tokens, reasoning included. */
  readonly outputTokens: number;
  /** The mean number of model steps. */
  readonly steps: number;
  /** The mean preamble size in tokens. */
  readonly preambleTokens: number;
  /** The mean number of times a person was asked to approve a call. */
  readonly prompts: number;
  /** The mean wall-clock time in milliseconds. */
  readonly wallMs: number;
}

/** The figures a report gives for any set of trials: a harness's, or one task's within it. */
export interface TrialFigures {
  /** How many trials there are. */
  readonly trials: number;
  /** How the trials came out. */
  readonly outcomes: OutcomeCounts;
  /**
   * The share of graded trials that passed, or `null` when none was graded. Infra errors and ungraded trials are
   * left out of both counts. For a harness, when every task has the same number of graded trials, it equals the mean
   * of each task's pass rate.
   */
  readonly passAt1: number | null;
  /** The 95% Wilson interval of `passAt1`, or `null` when no trial was graded. */
  readonly passAt1Interval: Interval | null;
  /** What one attempt took, on average. */
  readonly perTask: PerTask;
  /** The cost of every trial together, or `null` when any is unknown. */
  readonly totalCostUsd: number | null;
  /** How many trials have an unknown cost. */
  readonly unknownCostTrials: number;
}

/**
 * One task's figures within a harness, so two harnesses or two ablations can be compared task by task with paired
 * statistics.
 */
export interface TaskReport extends TrialFigures {
  /** The task's id. */
  readonly task: string;
  /** The task's unbiased pass^k, C(c, k) / C(n, k), or `null` when it has fewer than k graded trials. */
  readonly passHatK: number | null;
}

/** One harness's line of a report. */
export interface HarnessReport extends TrialFigures {
  /** The harness the rows name. */
  readonly harness: string;
  /** How many distinct tasks the trials cover. */
  readonly tasks: number;
  /**
   * The mean over tasks of each task's unbiased pass^k, C(c, k) / C(n, k), for n graded trials of which c passed. A
   * task with fewer than k graded trials is left out and counted in `tasksBelowK`. `null` when no task has k.
   */
  readonly passHatK: number | null;
  /** How many tasks `passHatK` averages. */
  readonly passHatKTasks: number;
  /** How many tasks have fewer than k graded trials, so `passHatK` leaves them out. */
  readonly tasksBelowK: number;
  /** Each task's own figures, keyed by task id in the order the rows first name it. */
  readonly byTask: Readonly<Record<string, TaskReport>>;
}

/** A report: the k it used and one line for each harness, keyed by its name in the order the rows first name it. */
export interface EvalReport {
  /** The k of every `passHatK`. */
  readonly k: number;
  /** One line per harness. */
  readonly harnesses: Readonly<Record<string, HarnessReport>>;
}

function checkOptions(options: ReportOptions): void {
  if (!Number.isSafeInteger(options.k) || options.k < 1) {
    throw new EvalsError("invalid_option", `k must be a whole number, 1 or more, not ${options.k}`);
  }
}

function kept(rows: readonly EvalRow[], options: ReportOptions): EvalRow[] {
  return rows.filter(
    (row) =>
      (options.harness === undefined || row.harness === options.harness) &&
      (options.ablation === undefined || row.ablation === options.ablation) &&
      (options.tag === undefined || (row.tags ?? []).includes(options.tag)),
  );
}

function byKey<T>(rows: readonly EvalRow[], key: (row: EvalRow) => T): Map<T, EvalRow[]> {
  const groups = new Map<T, EvalRow[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group === undefined) groups.set(key(row), [row]);
    else group.push(row);
  }
  return groups;
}

function countOutcomes(rows: readonly EvalRow[]): OutcomeCounts {
  const counts: Record<Outcome, number> = { pass: 0, fail: 0, infra_error: 0, unscored: 0 };
  for (const row of rows) counts[outcomeOf(row)]++;
  return { passed: counts.pass, failed: counts.fail, infraError: counts.infra_error, unscored: counts.unscored };
}

/** A task's pass^k, or `null` when it has fewer than k graded trials. */
function taskPassHatK(rows: readonly EvalRow[], k: number): number | null {
  const graded = rows.map(outcomeOf).filter(isGraded);
  return graded.length < k ? null : passHatK(graded.length, graded.filter((outcome) => outcome === "pass").length, k);
}

function meanPassHatK(tasks: readonly TaskReport[]) {
  const known = tasks.flatMap((task) => (task.passHatK === null ? [] : [task.passHatK]));
  const mean = known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0) / known.length;
  return { passHatK: mean, passHatKTasks: known.length, tasksBelowK: tasks.length - known.length };
}

function totalCost(rows: readonly EvalRow[]): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.costUsd === null) return null;
    total += row.costUsd;
  }
  return total;
}

function perTaskOf(rows: readonly EvalRow[], total: number | null): PerTask {
  const mean = (value: (row: EvalRow) => number) => rows.reduce((sum, row) => sum + value(row), 0) / rows.length;
  return {
    costUsd: total === null ? null : total / rows.length,
    inputTokens: mean((row) => totalInput(row.tokens)),
    outputTokens: mean((row) => row.tokens.output),
    steps: mean((row) => row.steps),
    preambleTokens: mean((row) => row.preambleTokens),
    prompts: mean((row) => row.prompts),
    wallMs: mean((row) => row.wallMs),
  };
}

function figuresOf(rows: readonly EvalRow[]): TrialFigures {
  const outcomes = countOutcomes(rows);
  const graded = outcomes.passed + outcomes.failed;
  const total = totalCost(rows);
  return {
    trials: rows.length,
    outcomes,
    passAt1: graded === 0 ? null : outcomes.passed / graded,
    passAt1Interval: graded === 0 ? null : wilson(outcomes.passed, graded),
    perTask: perTaskOf(rows, total),
    totalCostUsd: total,
    unknownCostTrials: rows.filter((row) => row.costUsd === null).length,
  };
}

function harnessReport(harness: string, rows: readonly EvalRow[], k: number): HarnessReport {
  const ablations = new Set(rows.map((row) => row.ablation));
  if (ablations.size > 1) {
    throw new EvalsError(
      "invalid_option",
      `harness ${JSON.stringify(harness)} has rows from ${ablations.size} ablations; report one with options.ablation`,
    );
  }
  const tasks = [...byKey(rows, (row) => row.task)].map(
    ([task, trials]): TaskReport => ({ task, ...figuresOf(trials), passHatK: taskPassHatK(trials, k) }),
  );
  return {
    harness,
    tasks: tasks.length,
    ...figuresOf(rows),
    ...meanPassHatK(tasks),
    byTask: Object.fromEntries(tasks.map((task) => [task.task, task])),
  };
}

/**
 * Reports each harness in `rows`: pass@1 with its 95% Wilson interval, pass^k by the unbiased estimator
 * C(c, k) / C(n, k) averaged over tasks, and the mean cost, tokens, steps, preamble size, approval prompts and wall
 * time of one attempt at a task. Each harness also gives the same figures for each of its tasks in `byTask`, for
 * paired comparisons. Infra errors are counted apart from failures, and a trial the grader could not score
 * counts as neither. A harness with no kept rows has no line.
 *
 * Throws an `EvalsError`: `invalid_option` for a `k` below 1 or a harness whose kept rows span several ablations,
 * `invalid_row` for a row that breaks a rule of `EvalRow`, and `duplicate_trial` when two rows share a harness,
 * ablation, task and trial.
 */
export function report(rows: readonly EvalRow[], options: ReportOptions): EvalReport {
  checkOptions(options);
  checkRows(rows);
  const groups = byKey(kept(rows, options), (row) => row.harness);
  const harnesses = Object.fromEntries(
    [...groups].map(([harness, group]) => [harness, harnessReport(harness, group, options.k)]),
  );
  return { k: options.k, harnesses };
}
