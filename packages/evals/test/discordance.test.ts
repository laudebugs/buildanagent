import assert from "node:assert/strict";
import { discordance, isEvalsError } from "@buildanagent/evals";
import { test } from "vitest";
import { row } from "./rows.js";

test("two runs flip the pairs they grade differently, out of the pairs both graded", () => {
  const a = [
    row("ours", "A", 0, "pass"),
    row("ours", "A", 1, "fail"),
    row("ours", "B", 0, "pass"),
    row("ours", "B", 1, "pass"),
    row("ours", "C", 0, "infra"),
    row("ours", "D", 0, "pass"),
  ];
  const b = [
    row("mini-swe-agent", "A", 0, "fail"), // flipped
    row("mini-swe-agent", "A", 1, "pass"), // flipped
    row("mini-swe-agent", "B", 0, "pass"), // same
    row("mini-swe-agent", "B", 1, "unknown"), // ungraded in b: out
    row("mini-swe-agent", "C", 0, "pass"), // an infra error in a: out
    row("mini-swe-agent", "E", 0, "pass"), // only in b: out
  ];
  assert.deepEqual(discordance(a, b), { flipped: 2, total: 3 });
  assert.deepEqual(discordance(b, a), { flipped: 2, total: 3 });
});

test("a run with the same task and trial twice is refused", () => {
  const twice = [row("ours", "A", 0, "pass"), row("ours", "A", 0, "fail", { ablation: "other" })];
  assert.throws(
    () => discordance(twice, []),
    (error) => isEvalsError(error) && error.code === "duplicate_trial",
  );
});

test("two empty runs have nothing to compare", () => {
  assert.deepEqual(discordance([], []), { flipped: 0, total: 0 });
});
