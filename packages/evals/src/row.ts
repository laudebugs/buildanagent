/**
 * The eval row: one trial of one task, run by one harness under one ablation, with its grade, its cost and its
 * counts. A row's rules are checked here, once, so `report()` and `discordance()` read only valid rows.
 */
import type { Usage } from "@buildanagent/gateway";
import { EvalsError } from "./errors.js";

/**
 * Why a trial has no grade. `judge_unknown`: the grader answered "unknown", as a model judge may. `infra_error`: the
 * infrastructure failed, in the agent's run or in the grader, so the trial says nothing about the agent.
 */
export type UnscoredReason = "judge_unknown" | "infra_error";

/**
 * How a trial's run ended. `submitted`: the agent finished and handed in its answer. `limit`: a step, budget, time
 * or progress limit stopped it. `infra_error`: the run failed for a reason outside the agent, such as a provider
 * error or a sandbox that would not start.
 */
export type EvalExit = "submitted" | "limit" | "infra_error";

/** One trial of one task: its grade, what it cost and what it took. */
export interface EvalRow {
  /** The task's id, the same across harnesses, so two runs pair up by task and trial. */
  readonly task: string;
  /** Which attempt at the task this is, a whole number from 0. */
  readonly trial: number;
  /** What the trial cost in US dollars, or `null` when any of its calls had no known price. Never a guessed zero. */
  readonly costUsd: number | null;
  /** The tokens of every model call the trial made. */
  readonly tokens: Usage;
  /** Whether the grader passed the trial, or `null` when it has no grade; `unscored` then says why. */
  readonly passed: boolean | null;
  /** Why `passed` is `null`. Set exactly when it is. */
  readonly unscored?: UnscoredReason;
  /** The model steps the agent took. */
  readonly steps: number;
  /** The tokens of the preamble the first call sent: the system prompt and the tool schemas. */
  readonly preambleTokens: number;
  /** How long the trial ran, in milliseconds. */
  readonly wallMs: number;
  /** How many times the trial asked a person to approve a call. */
  readonly prompts: number;
  /** How the run ended. A row with `exit: "infra_error"` has `passed: null` and `unscored: "infra_error"`. */
  readonly exit: EvalExit;
  /**
   * Which harness ran the trial: `"ours"`, `"mini-swe-agent"` for the baseline, `"single-call"` for one model call with
   * no loop, or any other name. `report()` groups rows by it.
   */
  readonly harness: string;
  /** The task's labels, such as its slice of the suite and `"safety"`. `report()` can keep only rows with one tag. */
  readonly tags?: readonly string[];
  /** Which ablation the trial ran under, such as the hash of its switches, or `"none"` for the full harness. */
  readonly ablation: string;
}

/** What a row counts as in a report: a pass, a fail, an infra error, or a trial the grader could not score. */
export type Outcome = "pass" | "fail" | "infra_error" | "unscored";

function fail(row: EvalRow, message: string): never {
  throw new EvalsError("invalid_row", `${row.harness}/${row.task}#${row.trial}: ${message}`);
}

const isCount = (value: number) => Number.isSafeInteger(value) && value >= 0;
const isAmount = (value: number) => Number.isFinite(value) && value >= 0;

function checkGrade(row: EvalRow): void {
  if (row.passed === null && row.unscored === undefined) fail(row, "passed is null, so unscored must say why");
  if (row.passed !== null && row.unscored !== undefined) fail(row, `passed is set, so unscored must be left out`);
  if (row.exit === "infra_error" && row.unscored !== "infra_error") {
    fail(row, 'exit is "infra_error", so passed must be null and unscored "infra_error"');
  }
}

/** Throws an `EvalsError` with code `invalid_row` when the row breaks a rule its fields' docs state. */
export function checkRow(row: EvalRow): void {
  if (row.task === "") fail(row, "task must not be empty");
  if (row.harness === "") fail(row, "harness must not be empty");
  if (!isCount(row.trial)) fail(row, "trial must be a whole number, 0 or more");
  for (const name of ["steps", "preambleTokens", "prompts"] as const) {
    if (!isCount(row[name])) fail(row, `${name} must be a whole number, 0 or more`);
  }
  if (!isAmount(row.wallMs)) fail(row, "wallMs must be a finite number, 0 or more");
  if (row.costUsd !== null && !isAmount(row.costUsd)) fail(row, "costUsd must be null or a finite number, 0 or more");
  checkGrade(row);
}

/** The row's outcome. An infra error counts as one whichever side failed, the agent's run or the grader. */
export function outcomeOf(row: EvalRow): Outcome {
  if (row.unscored === "infra_error") return "infra_error";
  if (row.passed === null) return "unscored";
  return row.passed ? "pass" : "fail";
}

/** Checks every row and that no two share a harness, ablation, task and trial. */
export function checkRows(rows: readonly EvalRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    checkRow(row);
    const key = JSON.stringify([row.harness, row.ablation, row.task, row.trial]);
    if (seen.has(key)) {
      throw new EvalsError(
        "duplicate_trial",
        `${row.harness}/${row.task}#${row.trial} appears twice under ablation ${JSON.stringify(row.ablation)}`,
      );
    }
    seen.add(key);
  }
}
