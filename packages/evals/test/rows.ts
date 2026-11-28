// Builds eval rows for the tests: every field has a plain default, so a test names only what it is about.

import type { EvalRow } from "@buildanagent/evals";
import type { Usage } from "@buildanagent/gateway";

/** Usage with `input` uncached input tokens and `output` output tokens. */
export const tokens = (input: number, output: number): Usage => ({
  uncachedInput: input,
  cacheRead: 0,
  cacheWrite: { "5m": 0, "1h": 0 },
  output,
  reasoning: 0,
  raw: null,
});

type Grade = "pass" | "fail" | "infra" | "unknown";

const grades: Record<Grade, Pick<EvalRow, "passed" | "unscored" | "exit">> = {
  pass: { passed: true, exit: "submitted" },
  fail: { passed: false, exit: "submitted" },
  infra: { passed: null, unscored: "infra_error", exit: "infra_error" },
  unknown: { passed: null, unscored: "judge_unknown", exit: "submitted" },
};

/** One row of `harness` for `task` and `trial`, graded `grade`, with `extra` over the defaults. */
export function row(
  harness: string,
  task: string,
  trial: number,
  grade: Grade,
  extra: Partial<Omit<EvalRow, "harness" | "task" | "trial">> = {},
): EvalRow {
  return {
    task,
    trial,
    costUsd: 0,
    tokens: tokens(0, 0),
    steps: 0,
    preambleTokens: 0,
    wallMs: 0,
    prompts: 0,
    harness,
    ablation: "none",
    ...grades[grade],
    ...extra,
  };
}
