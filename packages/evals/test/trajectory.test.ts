import assert from "node:assert/strict";
import { isEvalsError, toEvalRow, toMiniSweTrajectory } from "@buildanagent/evals";
import type { Cost } from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { loadCase } from "./capstone.js";
import { tokens } from "./rows.js";

// A small hand-written log: one turn, two model calls, a summary and a judge call, ending as `stopReason` says.
const MODEL = { api: "scripted", provider: "scripted", id: "m" };
const priced = (total: number | null): Cost => ({
  total,
  basis: total === null ? "unknown" : "catalog",
  currency: "USD",
});
let seq = 0;
const at = (second: number) => `2026-11-25T09:00:${String(second).padStart(2, "0")}.000Z`;
function entry(second: number, body: Record<string, unknown>): SessionEntry {
  seq++;
  return {
    id: `e${seq}`,
    parentId: seq === 1 ? null : `e${seq - 1}`,
    seq,
    timestamp: at(second),
    origin: "harness",
    ...body,
  } as SessionEntry;
}
function log(
  stopReason: string | undefined,
  costs: { readonly call2: number | null } = { call2: 0.02 },
): SessionEntry[] {
  seq = 0;
  const entries = [
    entry(0, {
      type: "message_block",
      messageId: "u1",
      role: "user",
      index: 0,
      block: { type: "text", text: "Fix it." },
    }),
    entry(1, { type: "turn_start", runId: "r1", mode: "run", system: "Be brief." }),
    entry(2, {
      type: "message_block",
      messageId: "a1",
      role: "assistant",
      index: 0,
      block: { type: "reasoning", text: "hm" },
    }),
    entry(2, {
      type: "message_block",
      messageId: "a1",
      role: "assistant",
      index: 1,
      block: { type: "text", text: "Looking." },
    }),
    entry(2, {
      type: "message_block",
      messageId: "a1",
      role: "assistant",
      index: 2,
      block: { type: "tool_call", callId: "c1", name: "bash", input: { command: "ls" } },
    }),
    entry(3, { type: "message_end", messageId: "a1", model: MODEL, stopReason: "tool_calls" }),
    entry(3, { type: "usage", source: "model_call", usage: tokens(100, 10), cost: priced(0.01) }),
    entry(4, {
      type: "tool_result",
      callId: "c1",
      tool: "bash",
      content: [{ type: "text", text: "a.ts" }],
      isError: false,
      trust: "trusted",
    }),
    entry(5, { type: "usage", source: "summary", usage: tokens(50, 5), cost: priced(0.005) }),
    entry(6, {
      type: "message_block",
      messageId: "a2",
      role: "assistant",
      index: 0,
      block: { type: "text", text: "Done." },
    }),
    entry(7, { type: "message_end", messageId: "a2", model: MODEL, stopReason: "stop" }),
    entry(7, { type: "usage", source: "model_call", usage: tokens(200, 20), cost: priced(costs.call2) }),
    entry(8, { type: "usage", source: "judge", usage: tokens(999, 99), cost: priced(1) }),
  ];
  if (stopReason !== undefined) entries.push(entry(9, { type: "turn_end", runId: "r1", stopReason, steps: 2 }));
  return entries;
}

describe("toMiniSweTrajectory()", () => {
  test("a converted capstone trajectory has instance_cost, api_calls and exit_status filled", () => {
    const { info } = toMiniSweTrajectory(loadCase("approved").entries);
    assert.deepEqual(info, {
      model_stats: { instance_cost: 0.00135 + 0.00135 + 0.00135, api_calls: 3 },
      exit_status: "Submitted",
      submission: "",
    });
  });

  test("the messages follow mini-swe-agent's shapes, system prompt first and an exit message last", () => {
    const trajectory = toMiniSweTrajectory(log("done"), { submission: "diff --git a/a.ts b/a.ts" });
    assert.equal(trajectory.trajectory_format, "mini-swe-agent-1.1");
    assert.deepEqual(trajectory.messages, [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Fix it." },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [{ id: "c1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } }],
        extra: { cost: 0.01, timestamp: Date.parse(at(3)) / 1000 },
      },
      { role: "tool", tool_call_id: "c1", content: "a.ts" },
      { role: "assistant", content: "Done.", extra: { cost: 0.02, timestamp: Date.parse(at(7)) / 1000 } },
      {
        role: "exit",
        content: "diff --git a/a.ts b/a.ts",
        extra: { exit_status: "Submitted", submission: "diff --git a/a.ts b/a.ts" },
      },
    ]);
    assert.equal(trajectory.info.submission, "diff --git a/a.ts b/a.ts");
  });

  test("model and summary calls count toward cost and calls, and a judge's call does not", () => {
    assert.deepEqual(toMiniSweTrajectory(log("done")).info.model_stats, {
      instance_cost: 0.01 + 0.005 + 0.02,
      api_calls: 3,
    });
  });

  test("one unknown price makes instance_cost unknown, never a smaller sum", () => {
    const trajectory = toMiniSweTrajectory(log("done", { call2: null }));
    assert.deepEqual(trajectory.info.model_stats, { instance_cost: null, api_calls: 3 });
    assert.deepEqual(trajectory.messages[4], {
      role: "assistant",
      content: "Done.",
      extra: { cost: null, timestamp: Date.parse(at(7)) / 1000 },
    });
  });

  test("max_steps and budget become LimitsExceeded, and another stop reason is kept as it is", () => {
    assert.equal(toMiniSweTrajectory(log("max_steps")).info.exit_status, "LimitsExceeded");
    assert.equal(toMiniSweTrajectory(log("budget")).info.exit_status, "LimitsExceeded");
    const errored = toMiniSweTrajectory(log("error"));
    assert.equal(errored.info.exit_status, "error");
    assert.deepEqual(errored.messages.at(-1), {
      role: "exit",
      content: "error",
      extra: { exit_status: "error", submission: "" },
    });
  });

  test("a log with no ended turn has an empty exit_status and no exit message", () => {
    const trajectory = toMiniSweTrajectory(log(undefined));
    assert.equal(trajectory.info.exit_status, "");
    assert.notEqual(trajectory.messages.at(-1)?.role, "exit");
  });
});

describe("toEvalRow()", () => {
  const meta = { task: "t", trial: 0, harness: "ours", ablation: "none", preambleTokens: 10, passed: true } as const;

  test("the row sums the agent's calls, leaves the judge out, and reads steps, prompts and wall time", () => {
    const row = toEvalRow(log("done"), meta);
    assert.equal(row.costUsd, 0.01 + 0.005 + 0.02);
    assert.deepEqual(row.tokens, tokens(350, 35));
    assert.equal(row.steps, 2);
    assert.equal(row.prompts, 0);
    assert.equal(row.wallMs, 9000);
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

  test("a stop at a limit is exit limit", () => {
    assert.equal(toEvalRow(log("max_steps"), { ...meta, passed: false }).exit, "limit");
  });

  test("a judge that could not decide leaves the row unscored", () => {
    const row = toEvalRow(log("done"), { ...meta, passed: null, unscored: "judge_unknown" });
    assert.equal(row.passed, null);
    assert.equal(row.unscored, "judge_unknown");
  });

  test("a session whose last turn waits on a person, or never ended, has no row", () => {
    const unfinished = (error: unknown) => isEvalsError(error) && error.code === "unfinished_session";
    assert.throws(() => toEvalRow(log("awaiting_approval"), meta), unfinished);
    assert.throws(() => toEvalRow(log(undefined), meta), unfinished);
  });
});
