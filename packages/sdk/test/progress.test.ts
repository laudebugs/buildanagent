// The default progress policy (D11): a check on canonicalInputHash() and progressKey() that ends a run `no_progress`.
import assert from "node:assert/strict";
import {
  continueRun,
  DEFAULT_PROGRESS,
  defineTool,
  type Interceptors,
  isSdkError,
  type RunOptions,
  run,
} from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { determinism, drive, scripted, text, toolCall } from "./run-helpers.js";

const SYSTEM = "You edit files.";

/** A tool that fails when its input says so, and succeeds otherwise. */
const flaky = defineTool({
  name: "flaky",
  description: "Does a thing that may fail.",
  inputSchema: { type: "object", properties: { fail: { type: "boolean" } } },
  async execute(input) {
    const fails = (input as { fail?: boolean }).fail === true;
    return { content: [{ type: "text", text: fails ? "it failed" : "it worked" }], isError: fails };
  },
});

/** An edit tool whose calls with one path and line count as the same attempt. */
const edit = defineTool({
  name: "edit",
  description: "Edits a line.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, line: { type: "integer" }, fail: { type: "boolean" } },
  },
  progressKey: (input) => `${(input as { path: string }).path}:${(input as { line: number }).line}`,
  async execute(input) {
    const fails = (input as { fail?: boolean }).fail === true;
    return { content: [{ type: "text", text: fails ? "no match" : "edited" }], isError: fails };
  },
});

async function go(steps: ScriptStep[], options: Partial<RunOptions> = {}) {
  const { adapter, model } = scripted(steps);
  const { result } = await drive(
    run({ model, system: SYSTEM, input: "Go.", tools: [flaky, edit], ...determinism(), ...options }),
  );
  return { adapter, result };
}

const failing = (extra: Record<string, unknown> = {}) => toolCall("flaky", { fail: true, ...extra });

test("the defaults are three identical failing calls and five calls on one key", () => {
  assert.deepEqual(DEFAULT_PROGRESS, { maxIdenticalFailures: 3, maxSameKeyCalls: 5 });
  assert.ok(Object.isFrozen(DEFAULT_PROGRESS), "no caller can loosen the defaults for every other run");
});

test("three identical failing calls end no_progress, and the key order of the input does not matter", async () => {
  const { adapter, result } = await go([
    toolCall("flaky", { fail: true, note: "a" }),
    toolCall("flaky", { note: "a", fail: true }),
    toolCall("flaky", { fail: true, note: "a" }),
    text("never sent"),
  ]);
  assert.equal(result.stopReason, "no_progress");
  if (result.stopReason !== "no_progress") return;
  assert.equal(result.steps, 3);
  assert.equal(adapter.calls.length, 3);
  assert.match(result.reason, /3 identical failing calls to flaky/);
});

test("two identical failing calls do not end the run", async () => {
  const { result } = await go([failing(), failing(), text("Giving up politely.")]);
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 3);
});

test("failing calls with different inputs are not identical", async () => {
  const { result } = await go([
    failing({ n: 1 }),
    failing({ n: 2 }),
    failing({ n: 3 }),
    failing({ n: 4 }),
    text("Done."),
  ]);
  assert.equal(result.stopReason, "done");
});

test("a success between failures breaks the streak", async () => {
  const { result } = await go([failing(), failing(), toolCall("flaky", {}), failing(), text("Done.")]);
  assert.equal(result.stopReason, "done");
});

test("identical calls to two different tools are not one streak", async () => {
  const other = defineTool({ ...flaky, name: "flaky_too" });
  const { adapter, model } = scripted([failing(), toolCall("flaky_too", { fail: true }), failing(), text("Done.")]);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", tools: [flaky, other], ...determinism() }));
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
});

test("five calls with one progressKey and no success between them end no_progress", async () => {
  const attempt = (n: number) => toolCall("edit", { path: "a.ts", line: 7, fail: true, attempt: n });
  const { adapter, result } = await go([1, 2, 3, 4, 5].map(attempt).concat([text("never sent")]));
  assert.equal(result.stopReason, "no_progress");
  if (result.stopReason !== "no_progress") return;
  assert.equal(result.steps, 5);
  assert.equal(adapter.calls.length, 5);
  assert.match(result.reason, /called edit 5 times with the key "a.ts:7"/);
});

test("four calls on one key do not end the run, and a success on that key starts the count again", async () => {
  const bad = (n: number) => toolCall("edit", { path: "a.ts", line: 7, fail: true, attempt: n });
  const good = toolCall("edit", { path: "a.ts", line: 7 });
  const four = await go([1, 2, 3, 4].map(bad).concat([text("Done.")]));
  assert.equal(four.result.stopReason, "done");
  const reset = await go([1, 2, 3, 4].map(bad).concat([good], [5, 6, 7, 8].map(bad), [text("Done.")]));
  assert.equal(reset.result.stopReason, "done");
  assert.equal(reset.result.steps, 10);
});

test("calls on other keys, and calls to other tools, do not reset or add to a key's count", async () => {
  const bad = (n: number) => toolCall("edit", { path: "a.ts", line: 7, fail: true, attempt: n });
  const elsewhere = toolCall("edit", { path: "b.ts", line: 1 });
  const steps = [bad(1), elsewhere, bad(2), toolCall("flaky", {}), bad(3), elsewhere, bad(4), text("Done.")];
  assert.equal((await go(steps)).result.stopReason, "done");
  const fifth = [
    bad(1),
    elsewhere,
    bad(2),
    toolCall("flaky", {}),
    bad(3),
    elsewhere,
    bad(4),
    bad(5),
    text("never sent"),
  ];
  assert.equal((await go(fifth)).result.stopReason, "no_progress");
});

test("a progressKey that throws leaves its calls unkeyed", async () => {
  const brittle = defineTool({
    ...edit,
    name: "brittle",
    progressKey: () => {
      throw new Error("cannot read input");
    },
  });
  const steps = [1, 2, 3, 4, 5, 6].map((n) => toolCall("brittle", { fail: true, attempt: n })).concat([text("Done.")]);
  const { adapter, model } = scripted(steps);
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", tools: [brittle], ...determinism() }));
  adapter.assertComplete();
  assert.equal(result.stopReason, "done");
});

test("a progressKey that is not a function is refused when the tool is defined", () => {
  assert.throws(
    () => defineTool({ ...edit, progressKey: "path" as never }),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
  assert.throws(
    () =>
      run({
        model: scripted([text("x")]).model,
        system: SYSTEM,
        input: "Go.",
        tools: [{ ...edit, progressKey: 1 as never }],
      }),
    (error) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});

test("the thresholds are options, and progress: false turns the policy off", async () => {
  const steps = () => [failing(), failing(), text("Done.")];
  const strict = await go(steps(), { progress: { maxIdenticalFailures: 2 } });
  assert.equal(strict.result.stopReason, "no_progress");
  const lax = await go([failing(), failing(), failing(), failing(), text("Done.")], {
    progress: { maxIdenticalFailures: 5 },
  });
  assert.equal(lax.result.stopReason, "done");
  const off = await go([failing(), failing(), failing(), failing(), text("Done.")], { progress: false });
  assert.equal(off.result.stopReason, "done");
  assert.equal(off.result.steps, 5);
});

test("a threshold that isn't a positive integer is refused when the run starts", () => {
  const { model } = scripted([text("x")]);
  for (const progress of [{ maxIdenticalFailures: 0 }, { maxSameKeyCalls: 2.5 }]) {
    assert.throws(
      () => run({ model, system: SYSTEM, input: "Go.", progress }),
      (error) => isSdkError(error) && error.code === "invalid_run_options",
    );
  }
});

test("a caller's shouldStop that asks to continue cannot keep a stuck run going", async () => {
  const interceptors: Interceptors = { shouldStop: () => ({ continue: "Keep going." }) };
  const { result } = await go([failing(), failing(), failing(), text("never sent")], { interceptors });
  assert.equal(result.stopReason, "no_progress");
});

test("the policy leaves the caller's own shouldStop and onFailure setting in force", async () => {
  const seen: number[] = [];
  const interceptors: Interceptors = {
    shouldStop: (e) => {
      seen.push(e.messages.length);
      return false;
    },
    onFailure: "continue",
  };
  const { result } = await go([toolCall("flaky", {}), text("Done.")], { interceptors });
  assert.equal(result.stopReason, "done");
  assert.ok(seen.length >= 1);
});

test("a continued run counts only its own calls, not the loop in its history", async () => {
  const first = await go([failing(), failing(), failing()]);
  assert.equal(first.result.stopReason, "no_progress");
  const { adapter, model } = scripted([failing(), text("Fixed it another way.")]);
  const context = {
    system: first.result.context.system,
    messages: [
      ...first.result.context.messages,
      { role: "user" as const, content: [{ type: "text" as const, text: "Try again." }] },
    ],
  };
  const next = await drive(continueRun(context, { model, tools: [flaky], ...determinism() }));
  adapter.assertComplete();
  assert.equal(next.result.stopReason, "done");
});

test("calls that share one callId keep their own inputs and outcomes", async () => {
  const reused = (input: Record<string, unknown>) => toolCall("flaky", input, "call_0");
  const different = await go([
    reused({ fail: true, n: 1 }),
    reused({ fail: true, n: 2 }),
    reused({ fail: true, n: 3 }),
    text("Done."),
  ]);
  assert.equal(different.result.stopReason, "done");
  const identical = await go([reused({ fail: true }), reused({ fail: true }), reused({ fail: true }), text("never")]);
  assert.equal(identical.result.stopReason, "no_progress");
});

test("a key's failures still count when a success in the same step reuses their callId", async () => {
  const step = {
    content: [
      { type: "tool_call" as const, callId: "call_0", name: "edit", input: { path: "a.ts", line: 1, fail: true } },
      { type: "tool_call" as const, callId: "call_0", name: "flaky", input: {} },
    ],
  };
  const { result } = await go([step, step, step, step, step, text("never sent")]);
  assert.equal(result.stopReason, "no_progress");
  if (result.stopReason !== "no_progress") return;
  assert.equal(result.steps, 5);
});

test("a caller's shouldStop that throws under onFailure continue leaves the policy in force", async () => {
  const interceptors: Interceptors = {
    shouldStop: () => {
      throw new Error("bug");
    },
    onFailure: "continue",
  };
  const { result } = await go([failing(), failing(), failing(), text("never sent")], { interceptors });
  assert.equal(result.stopReason, "no_progress");
});
