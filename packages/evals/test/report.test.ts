import assert from "node:assert/strict";
import { type EvalRow, isEvalsError, report } from "@buildanagent/evals";
import { describe, test } from "vitest";
import { row, tokens } from "./rows.js";

/** Asserts `actual` is within `tolerance` of `expected`. */
function near(actual: number | null | undefined, expected: number, tolerance = 1e-9, label = "") {
  assert.ok(typeof actual === "number" && Math.abs(actual - expected) <= tolerance, `${label} ${actual} ≉ ${expected}`);
}

// The ten-row fixture: six trials of "ours" and four of "single-call", over tasks A and B.
//
// ours, k = 2:
//   A0 pass $0.10 1000/100 tokens 3 steps 1 prompt | A1 pass $0.20 2000/200 4 steps 0 | A2 fail $0.30 3000/300 5 steps 2
//   B0 pass $0.40 1000/100 2 steps 0 | B1 infra error $0.05 0/0 0 steps 0 | B2 pass $0.15 2000/200 4 steps 1
//   outcomes: 4 passed, 1 failed, 1 infra error, 0 unscored; graded = 5
//   pass@1 = 4/5 = 0.8
//   Wilson(4, 5), z = 1.96: z²/n = 0.768292, centre = (0.8 + 0.384146) / 1.768292 = 0.669656,
//     half = 1.959964 · √(0.8·0.2/5 + 3.841459/100) / 1.768292 = 1.108397 · 0.265357 = 0.294121
//     → [0.375535, 0.963776]
//   pass^2: A has n = 3 graded, c = 2 → C(2,2)/C(3,2) = 1/3; B has n = 2 graded (B1 is out), c = 2 → 1/1 = 1
//     → (1/3 + 1) / 2 = 2/3, over 2 tasks, 0 below k
//   cost: 0.10 + 0.20 + 0.30 + 0.40 + 0.05 + 0.15 = 1.20 → 0.20 per task (the infra error's spend counts)
//   input 9000 / 6 = 1500, output 900 / 6 = 150, steps 18 / 6 = 3, prompts 4 / 6 = 2/3, preamble 500, wall 1000 ms
//
// single-call, k = 2:
//   A0 fail $0.01 | A1 judge unknown, cost unknown | B0 pass $0.02 | B1 pass $0.03; each 100/10 tokens, 1 step
//   outcomes: 2 passed, 1 failed, 0 infra errors, 1 unscored; graded = 3
//   pass@1 = 2/3
//   Wilson(2, 3): z²/n = 1.280486, centre = (0.666667 + 0.640243) / 2.280486 = 0.573083,
//     half = 1.959964 · √(0.074074 + 0.106707) / 2.280486 = 0.859449 · 0.425184 = 0.365425 → [0.20766, 0.938508]
//   (the hand values carry six places, so the test allows 1e-5)
//   pass^2: A has n = 1 graded < 2, so it is left out; B has n = 2, c = 2 → 1 → pass^2 = 1, over 1 task, 1 below k
//   cost: A1 is unknown, so the total and the mean are null and 1 trial is unknown
//   input 100, output 10, steps 1, prompts 0, preamble 50, wall 200 ms
const ours = (task: string, trial: number, grade: Parameters<typeof row>[3], extra: Partial<EvalRow>) =>
  row("ours", task, trial, grade, { preambleTokens: 500, wallMs: 1000, ...extra });
const single = (task: string, trial: number, grade: Parameters<typeof row>[3], costUsd: number | null) =>
  row("single-call", task, trial, grade, {
    costUsd,
    tokens: tokens(100, 10),
    steps: 1,
    preambleTokens: 50,
    wallMs: 200,
  });

const TEN_ROWS: EvalRow[] = [
  ours("A", 0, "pass", { costUsd: 0.1, tokens: tokens(1000, 100), steps: 3, prompts: 1, tags: ["safety"] }),
  ours("A", 1, "pass", { costUsd: 0.2, tokens: tokens(2000, 200), steps: 4, tags: ["safety"] }),
  ours("A", 2, "fail", { costUsd: 0.3, tokens: tokens(3000, 300), steps: 5, prompts: 2, tags: ["safety"] }),
  ours("B", 0, "pass", { costUsd: 0.4, tokens: tokens(1000, 100), steps: 2 }),
  ours("B", 1, "infra", { costUsd: 0.05 }),
  ours("B", 2, "pass", { costUsd: 0.15, tokens: tokens(2000, 200), steps: 4, prompts: 1 }),
  single("A", 0, "fail", 0.01),
  single("A", 1, "unknown", null),
  single("B", 0, "pass", 0.02),
  single("B", 1, "pass", 0.03),
];

describe("report() on the ten-row fixture matches the hand-computed table", () => {
  const result = report(TEN_ROWS, { k: 2 });

  test("rows are grouped by every harness string, single-call included, in the order they first appear", () => {
    assert.equal(result.k, 2);
    assert.deepEqual(Object.keys(result.harnesses), ["ours", "single-call"]);
  });

  test("ours: outcomes, pass@1, Wilson, pass^2 and the per-task means", () => {
    const line = result.harnesses.ours;
    assert.ok(line);
    assert.equal(line.trials, 6);
    assert.equal(line.tasks, 2);
    assert.deepEqual(line.outcomes, { passed: 4, failed: 1, infraError: 1, unscored: 0 });
    near(line.passAt1, 0.8);
    near(line.passAt1Interval?.lower, 0.375535, 1e-5, "lower");
    near(line.passAt1Interval?.upper, 0.963776, 1e-5, "upper");
    near(line.passHatK, 2 / 3);
    assert.equal(line.passHatKTasks, 2);
    assert.equal(line.tasksBelowK, 0);
    near(line.totalCostUsd, 1.2);
    near(line.perTask.costUsd, 0.2);
    assert.equal(line.unknownCostTrials, 0);
    near(line.perTask.inputTokens, 1500);
    near(line.perTask.outputTokens, 150);
    near(line.perTask.steps, 3);
    near(line.perTask.prompts, 2 / 3);
    near(line.perTask.preambleTokens, 500);
    near(line.perTask.wallMs, 1000);
  });

  test("single-call: the unscored trial is neither a pass nor a fail, and an unknown cost stays unknown", () => {
    const line = result.harnesses["single-call"];
    assert.ok(line);
    assert.deepEqual(line.outcomes, { passed: 2, failed: 1, infraError: 0, unscored: 1 });
    near(line.passAt1, 2 / 3);
    near(line.passAt1Interval?.lower, 0.20766, 1e-5, "lower");
    near(line.passAt1Interval?.upper, 0.938508, 1e-5, "upper");
    assert.equal(line.passHatK, 1);
    assert.equal(line.passHatKTasks, 1);
    assert.equal(line.tasksBelowK, 1);
    assert.equal(line.totalCostUsd, null);
    assert.equal(line.perTask.costUsd, null);
    assert.equal(line.unknownCostTrials, 1);
    near(line.perTask.inputTokens, 100);
    near(line.perTask.outputTokens, 10);
    near(line.perTask.steps, 1);
    near(line.perTask.preambleTokens, 50);
  });
});

describe("filters", () => {
  test("a tag keeps only the rows that carry it", () => {
    const result = report(TEN_ROWS, { k: 2, tag: "safety" });
    assert.deepEqual(Object.keys(result.harnesses), ["ours"]);
    const line = result.harnesses.ours;
    assert.equal(line?.trials, 3);
    assert.deepEqual(line?.outcomes, { passed: 2, failed: 1, infraError: 0, unscored: 0 });
    near(line?.passHatK, 1 / 3);
  });

  test("a harness keeps only its own rows", () => {
    assert.deepEqual(Object.keys(report(TEN_ROWS, { k: 1, harness: "single-call" }).harnesses), ["single-call"]);
  });

  test("a harness that spans two ablations is refused until one is chosen", () => {
    const rows = [row("ours", "A", 0, "pass"), row("ours", "A", 0, "fail", { ablation: "no-mcp" })];
    assert.throws(
      () => report(rows, { k: 1 }),
      (error) => isEvalsError(error) && error.code === "invalid_option",
    );
    assert.deepEqual(report(rows, { k: 1, ablation: "no-mcp" }).harnesses.ours?.outcomes.failed, 1);
  });
});

describe("pass^k is the unbiased estimator C(c, k) / C(n, k)", () => {
  // One task with n = 5 graded trials, c of them passed:
  //   k = 1: c/5                      → c = 3: 3/5 = 0.6
  //   k = 2: C(c,2)/C(5,2) = C(c,2)/10 → c = 2: 1/10, c = 3: 3/10, c = 4: 6/10
  //   k = 3: C(c,3)/C(5,3) = C(c,3)/10 → c = 3: 1/10, c = 4: 4/10, c = 2: 0
  //   k = 4: C(c,4)/C(5,4) = C(c,4)/5  → c = 4: 1/5
  //   k = 5: C(c,5)/C(5,5)            → c = 5: 1, c = 4: 0
  const HAND: Array<[c: number, k: number, expected: number]> = [
    [3, 1, 0.6],
    [2, 2, 0.1],
    [3, 2, 0.3],
    [4, 2, 0.6],
    [3, 3, 0.1],
    [4, 3, 0.4],
    [2, 3, 0],
    [4, 4, 0.2],
    [5, 5, 1],
    [4, 5, 0],
    [0, 1, 0],
  ];
  const fiveTrials = (c: number) =>
    Array.from({ length: 5 }, (_, trial) => row("ours", "T", trial, trial < c ? "pass" : "fail"));

  for (const [c, k, expected] of HAND) {
    test(`n = 5, c = ${c}, k = ${k} gives ${expected}`, () => {
      near(report(fiveTrials(c), { k }).harnesses.ours?.passHatK, expected, 1e-12);
    });
  }

  test("a k above every task's graded trials leaves no task to average", () => {
    const line = report(fiveTrials(5), { k: 6 }).harnesses.ours;
    assert.equal(line?.passHatK, null);
    assert.equal(line?.tasksBelowK, 1);
  });
});

describe("the Wilson interval matches published values", () => {
  // Textbook 95% Wilson intervals to 4 places (8/10 → [0.4902, 0.9433] is the usual worked example), recomputed
  // independently of this package from the closed form with z = 1.959964.
  const KNOWN: Array<[passes: number, trials: number, lower: number, upper: number]> = [
    [8, 10, 0.4902, 0.9433],
    [5, 10, 0.2366, 0.7634],
    [0, 10, 0, 0.2775],
    [10, 10, 0.7225, 1],
    [1, 1, 0.2065, 1],
  ];
  for (const [passes, trials, lower, upper] of KNOWN) {
    test(`${passes}/${trials} gives [${lower}, ${upper}]`, () => {
      const rows = Array.from({ length: trials }, (_, trial) =>
        row("ours", "T", trial, trial < passes ? "pass" : "fail"),
      );
      const interval = report(rows, { k: 1 }).harnesses.ours?.passAt1Interval;
      near(interval?.lower, lower, 5e-5, "lower");
      near(interval?.upper, upper, 5e-5, "upper");
    });
  }

  test("a harness with no graded trial has no pass@1 and no interval", () => {
    const line = report([row("ours", "A", 0, "infra"), row("ours", "A", 1, "unknown")], { k: 1 }).harnesses.ours;
    assert.equal(line?.passAt1, null);
    assert.equal(line?.passAt1Interval, null);
    assert.deepEqual(line?.outcomes, { passed: 0, failed: 0, infraError: 1, unscored: 1 });
  });
});

describe("infra errors and ungraded trials", () => {
  test("an infra error is counted apart from failures and leaves pass@1 untouched", () => {
    const line = report([row("ours", "A", 0, "pass"), row("ours", "A", 1, "infra")], { k: 1 }).harnesses.ours;
    assert.deepEqual(line?.outcomes, { passed: 1, failed: 0, infraError: 1, unscored: 0 });
    assert.equal(line?.passAt1, 1);
  });

  test("a grader's infra error on a submitted run also counts as an infra error", () => {
    const graderDown = row("ours", "A", 0, "unknown", { unscored: "infra_error" });
    assert.deepEqual(report([graderDown], { k: 1 }).harnesses.ours?.outcomes.infraError, 1);
  });

  test("a judge_unknown row is unscored: neither a pass nor a fail", () => {
    const rows = [row("ours", "A", 0, "fail"), row("ours", "A", 1, "unknown")];
    const line = report(rows, { k: 1 }).harnesses.ours;
    assert.deepEqual(line?.outcomes, { passed: 0, failed: 1, infraError: 0, unscored: 1 });
    assert.equal(line?.passAt1, 0);
  });
});

describe("rows and options that break the rules are refused", () => {
  const refuses = (rows: EvalRow[], code: string, k = 1) =>
    assert.throws(
      () => report(rows, { k }),
      (error) => isEvalsError(error) && error.code === code,
    );

  test("passed: null without a reason", () => {
    const { unscored: _unscored, ...bare } = row("ours", "A", 0, "unknown");
    refuses([bare], "invalid_row");
  });

  test("a reason beside a grade", () =>
    refuses([row("ours", "A", 0, "pass", { unscored: "judge_unknown" })], "invalid_row"));

  test("an infra_error exit with a grade", () =>
    refuses([row("ours", "A", 0, "pass", { exit: "infra_error" })], "invalid_row"));

  test("a negative cost", () => refuses([row("ours", "A", 0, "pass", { costUsd: -1 })], "invalid_row"));

  test("the same trial twice", () =>
    refuses([row("ours", "A", 0, "pass"), row("ours", "A", 0, "fail")], "duplicate_trial"));

  test("a k below 1", () => refuses([row("ours", "A", 0, "pass")], "invalid_option", 0));
});
