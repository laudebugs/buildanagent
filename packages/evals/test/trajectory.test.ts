import assert from "node:assert/strict";
import { toMiniSweTrajectory } from "@buildanagent/evals";
import { describe, test } from "vitest";
import { loadCase } from "./capstone.js";
import { at, entry, log, MODEL, priced } from "./log.js";
import { tokens } from "./rows.js";

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

  test("every limit becomes LimitsExceeded, as the row's exit is limit, and an error stays error", () => {
    for (const stop of ["max_steps", "budget", "no_progress", "aborted", "stopped"]) {
      assert.equal(toMiniSweTrajectory(log(stop)).info.exit_status, "LimitsExceeded", stop);
    }
    const errored = toMiniSweTrajectory(log("error"));
    assert.equal(errored.info.exit_status, "error");
    assert.deepEqual(errored.messages.at(-1), {
      role: "exit",
      content: "error",
      extra: { exit_status: "error", submission: "" },
    });
  });

  test("each call's cost and time land on its own message, and a superseded call's on none", () => {
    const entries = log(undefined);
    entries.push(
      // A turn-layer retry superseded this call: billed, but no message_end.
      entry(10, { type: "usage", source: "model_call", usage: tokens(10, 1), cost: priced(0.5) }),
      // The retried call failed with no content: a message_end with no blocks.
      entry(11, { type: "message_end", messageId: "a3", model: MODEL, stopReason: "error" }),
      entry(11, { type: "usage", source: "model_call", usage: tokens(10, 1), cost: priced(0.07) }),
      entry(12, { type: "turn_end", runId: "r1", stopReason: "error", steps: 3 }),
    );
    const trajectory = toMiniSweTrajectory(entries);
    const assistants = trajectory.messages.filter((message) => message.role === "assistant");
    assert.deepEqual(
      assistants.map((message) => message.extra),
      [
        { cost: 0.01, timestamp: Date.parse(at(3)) / 1000 },
        { cost: 0.02, timestamp: Date.parse(at(7)) / 1000 },
        { cost: 0.07, timestamp: Date.parse(at(11)) / 1000 },
      ],
    );
    assert.deepEqual(assistants[2], { role: "assistant", content: null, extra: assistants[2]?.extra });
    assert.deepEqual(trajectory.info.model_stats, { instance_cost: 0.01 + 0.005 + 0.02 + 0.5 + 0.07, api_calls: 5 });
  });

  test("a later turn's changed system prompt comes before that turn's user message", () => {
    const entries = log("done");
    entries.push(
      entry(20, {
        type: "message_block",
        messageId: "u2",
        role: "user",
        index: 0,
        block: { type: "text", text: "Again." },
      }),
      entry(21, { type: "turn_start", runId: "r2", mode: "run", system: "Be thorough." }),
      entry(22, {
        type: "message_block",
        messageId: "a3",
        role: "assistant",
        index: 0,
        block: { type: "text", text: "Ok." },
      }),
      entry(23, { type: "message_end", messageId: "a3", model: MODEL, stopReason: "stop" }),
      entry(24, { type: "turn_end", runId: "r2", stopReason: "done", steps: 1 }),
    );
    const roles = toMiniSweTrajectory(entries).messages.map((message) =>
      message.role === "system" || message.role === "user" ? `${message.role}:${message.content}` : message.role,
    );
    assert.deepEqual(roles, [
      "system:Be brief.",
      "user:Fix it.",
      "assistant",
      "tool",
      "assistant",
      "system:Be thorough.",
      "user:Again.",
      "assistant",
      "exit",
    ]);
  });

  test("a log with no ended turn, or one paused for a person, has an empty exit_status and no exit message", () => {
    for (const stop of [undefined, "awaiting_approval", "clarification_requested"]) {
      const trajectory = toMiniSweTrajectory(log(stop));
      assert.equal(trajectory.info.exit_status, "", String(stop));
      assert.notEqual(trajectory.messages.at(-1)?.role, "exit", String(stop));
    }
  });
});
