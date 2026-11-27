/**
 * `discordance()`: how many paired trials two runs grade differently. Among mature harnesses, swapping the harness
 * flips about as many tasks as rerunning the same one (harness guide §10), so a gain means little until it beats this.
 */
import { checkRows, type EvalRow, isGraded, outcomeOf } from "./row.js";

/** How many paired trials two runs graded differently, out of how many both graded. */
export interface Discordance {
  /** The pairs that passed in one run and failed in the other. */
  readonly flipped: number;
  /** The pairs both runs graded. */
  readonly total: number;
}

const trialKey = (row: EvalRow) => JSON.stringify([row.task, row.trial]);

function gradesByTrial(rows: readonly EvalRow[], run: string): Map<string, boolean> {
  checkRows(rows, (row) => [row.task, row.trial], `run ${run}`);
  const grades = new Map<string, boolean>();
  for (const row of rows) {
    const outcome = outcomeOf(row);
    if (isGraded(outcome)) grades.set(trialKey(row), outcome === "pass");
  }
  return grades;
}

/**
 * Pairs the trials of runs `a` and `b` by task and trial number and counts the pairs whose grades differ. A pair
 * counts only when both runs graded it, so a trial missing from one run, an infra error or a trial the grader could
 * not score is left out of `total` as well as `flipped`.
 *
 * Throws an `EvalsError`: `invalid_row` for a row that breaks a rule of `EvalRow`, and `duplicate_trial` when one
 * run has the same task and trial twice.
 */
export function discordance(a: readonly EvalRow[], b: readonly EvalRow[]): Discordance {
  const left = gradesByTrial(a, "a");
  const right = gradesByTrial(b, "b");
  let flipped = 0;
  let total = 0;
  for (const [key, passed] of left) {
    const other = right.get(key);
    if (other === undefined) continue;
    total++;
    if (other !== passed) flipped++;
  }
  return { flipped, total };
}
