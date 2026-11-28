import assert from "node:assert/strict";
import { isEvalsError, toEvalRow, toMiniSweTrajectory } from "@buildanagent/evals";
import type { SessionEntry } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { entry, log } from "./log.js";
import { tokens } from "./rows.js";

describe("toEvalRow()", () => {
  const meta = { task: "t", trial: 0, harness: "ours", ablation: "none", preambleTokens: 10, passed: true } as const;

  test("the row sums the agent's calls, leaves the judge out, and reads steps, prompts and wall time", () => {
    const row = toEvalRow(log("done"), meta);
    assert.equal(row.costUsd, 0.01 + 0.005 + 0.02);
    assert.deepEqual(row.tokens, tokens(350, 35));
    assert.equal(row.steps, 2);
    assert.equal(row.prompts, 0);
    assert.equal(row.wallMs, 8000, "from turn_start at 1 s to turn_end at 9 s");
    assert.equal(row.exit, "submitted");
    assert.equal(row.passed, true);
  });

  test("an unknown price makes the row's cost null", () => {
    assert.equal(toEvalRow(log("done", { call2: null }), meta).costUsd, null);
  });

  test("a run that ended in error is an infra error, ungraded whatever the grader said", () => {
    const row = toEvalRow(log("error"), meta);
    assert.equal(row.exit, "infra_error");
    assert.equal(row.passed, null);
    assert.equal(row.unscored, "infra_error");
  });

  test("each limit, an abort and a hook's stop are exit limit", () => {
    for (const stop of ["max_steps", "budget", "no_progress", "aborted", "stopped"]) {
      assert.equal(toEvalRow(log(stop), { ...meta, passed: false }).exit, "limit", stop);
    }
  });

  test("the wall time leaves out the wait for a person between a paused turn and its resume", () => {
    const paused = log("awaiting_approval");
    const resumedAt = (second: number, body: Record<string, unknown>) =>
      ({
        ...body,
        id: `r${second}`,
        parentId: null,
        seq: second,
        timestamp: `2026-11-25T09:10:${second}.000Z`,
        origin: "harness",
      }) as SessionEntry;
    const entries = [
      ...paused,
      resumedAt(10, { type: "turn_start", runId: "r2", mode: "continue", system: "Be brief." }),
      resumedAt(13, { type: "turn_end", runId: "r2", stopReason: "done", steps: 1 }),
    ];
    // 8 s for the first turn and 3 s for the resumed one; the ten minutes between them are not counted.
    assert.equal(toEvalRow(entries, meta).wallMs, 11_000);
  });

  test("a judge that could not decide leaves the row unscored", () => {
    const row = toEvalRow(log("done"), { ...meta, passed: null, unscored: "judge_unknown" });
    assert.equal(row.passed, null);
    assert.equal(row.unscored, "judge_unknown");
  });

  test("a stop reason this package does not know is an invalid session, not an unfinished one", () => {
    const invalid = (error: unknown) => isEvalsError(error) && error.code === "invalid_session";
    assert.throws(() => toEvalRow(log("teleported"), meta), invalid);
    assert.throws(() => toMiniSweTrajectory(log("teleported")), invalid);
  });

  test("a turn_end with no turn_start of its run is an invalid session, so the wall time is never too small", () => {
    const entries = log("done").filter((entry) => entry.type !== "turn_start");
    assert.throws(
      () => toEvalRow(entries, meta),
      (error) => isEvalsError(error) && error.code === "invalid_session",
    );
  });

  test("a session whose last turn waits on a person, or never ended, has no row", () => {
    const unfinished = (error: unknown) => isEvalsError(error) && error.code === "unfinished_session";
    assert.throws(() => toEvalRow(log("awaiting_approval"), meta), unfinished);
    assert.throws(() => toEvalRow(log("clarification_requested"), meta), unfinished);
    assert.throws(() => toEvalRow(log(undefined), meta), unfinished);
  });

  test("a session whose resumed run started and never ended has no row, though an earlier turn ended done", () => {
    const entries = [
      ...log("done"),
      entry(10, { type: "turn_start", runId: "r2", mode: "continue", system: "Be brief." }),
    ];
    assert.throws(
      () => toEvalRow(entries, meta),
      (error) => isEvalsError(error) && error.code === "unfinished_session",
    );
    const trajectory = toMiniSweTrajectory(entries);
    assert.equal(trajectory.info.exit_status, "");
    assert.notEqual(trajectory.messages.at(-1)?.role, "exit");
  });

  test("a second turn_end for a run already ended is an invalid session, so its time is never counted twice", () => {
    const entries = [...log("done"), entry(12, { type: "turn_end", runId: "r1", stopReason: "done", steps: 0 })];
    assert.throws(
      () => toEvalRow(entries, meta),
      (error) => isEvalsError(error) && error.code === "invalid_session",
    );
  });
});
