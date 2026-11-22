// `beforeModelCall` can return `{ stop }`, which ends the run before that call: no request is sent, no
// `model_call_start` is emitted, and the run ends `stopped` with the text as `stoppedBy`.
import assert from "node:assert/strict";
import { composeInterceptors, continueRun, isSdkError, run } from "@buildanagent/sdk";
import { test } from "vitest";
import { drivenRun, hookedRun, recorder, SYSTEM } from "./hook-helpers.js";
import { determinism, drive, scripted, text, toolCall, typesOf } from "./run-helpers.js";

test("a stop on the first call ends the run stopped, and no model is called", async () => {
  const { adapter, events, result } = await drivenRun([], { beforeModelCall: () => ({ stop: "prompt injection" }) });
  assert.equal(result.stopReason, "stopped");
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "prompt injection");
  assert.equal(adapter.calls.length, 0, "no request reached the model");
  adapter.assertComplete();
  assert.ok(!typesOf(events).includes("model_call_start"), "no model_call_start was emitted");
  assert.deepEqual(typesOf(events).slice(-3), ["step_end", "agent_settled", "run_end"]);
  assert.equal(result.steps, 0, "a call that did not happen is not a step");
});

test("a stop after a tool step ends the run stopped, with the earlier call and its result kept", async () => {
  const { tool, inputs } = recorder("lookup");
  const { adapter, result } = await drivenRun(
    [toolCall("lookup", { order: 1 })],
    { beforeModelCall: (e) => (e.stepIndex === 0 ? undefined : { stop: "second call refused" }) },
    { tools: [tool] },
  );
  assert.equal(result.stopReason, "stopped");
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "second call refused");
  assert.deepEqual(inputs, [{ order: 1 }]);
  assert.equal(adapter.calls.length, 1);
  assert.equal(result.context.messages.at(-1)?.role, "tool", "the transcript ends with the tool result");
});

test("continueRun() honours a stop on its first call too", async () => {
  const first = await drive(
    run({ model: scripted([text("Hello.")]).model, system: SYSTEM, input: "Hi.", ...determinism() }),
  );
  const { model, adapter } = scripted([]);
  const resumed = await drive(
    continueRun(
      {
        ...first.result.context,
        messages: [...first.result.context.messages, { role: "user", content: [{ type: "text", text: "Again." }] }],
      },
      { model, interceptors: { beforeModelCall: () => ({ stop: "no more" }) }, ...determinism() },
    ),
  );
  assert.equal(resumed.result.stopReason, "stopped");
  assert.equal(resumed.result.stopReason === "stopped" ? resumed.result.stoppedBy : undefined, "no more");
  assert.equal(adapter.calls.length, 0);
});

test("composeInterceptors() ends the check at the first stop and does not call the hooks after it", async () => {
  const called: string[] = [];
  const interceptors = composeInterceptors(
    {
      beforeModelCall: () => {
        called.push("a");
        return undefined;
      },
    },
    {
      beforeModelCall: () => {
        called.push("b");
        return { stop: "b stops" };
      },
    },
    {
      beforeModelCall: () => {
        called.push("c");
        return { system: "never" };
      },
    },
  );
  const { adapter, result } = await drivenRun([], interceptors);
  assert.deepEqual(called, ["a", "b"]);
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "b stops");
  assert.equal(adapter.calls.length, 0);
});

test("a stop with another field, or with blank or non-text content, is a loud programmer error", async () => {
  for (const returned of [
    { stop: "x", system: "y" },
    { stop: "" },
    { stop: "   " },
    { stop: 3 },
    { stop: "hook" },
    { stop: "no_progress" },
  ]) {
    const { started } = hookedRun([], { beforeModelCall: () => returned as never });
    await assert.rejects(started.result, (error) => isSdkError(error) && error.code === "invalid_hook_result");
  }
});

test("a hook that returns nothing, or a patch without stop, still lets the call go ahead", async () => {
  const { adapter, result } = await drivenRun([text("Done.")], { beforeModelCall: () => ({ system: "Patched." }) });
  assert.equal(result.stopReason, "done");
  assert.equal(adapter.calls.length, 1);
});

test("a stop on a turn retry ends the run stopped after the retry event, with the failed response left out", async () => {
  let calls = 0;
  const { adapter, events, result } = await drivenRun(
    [{ content: [], error: { kind: "retryable", message: "overloaded", status: 529 } }],
    {
      beforeModelCall: () => {
        calls += 1;
        return calls === 2 ? { stop: "no second attempt" } : undefined;
      },
    },
    { turnRetries: 2, turnRetryDelayMs: 1, sleep: async () => undefined },
  );
  assert.equal(result.stopReason, "stopped");
  assert.equal(result.stopReason === "stopped" ? result.stoppedBy : undefined, "no second attempt");
  assert.equal(adapter.calls.length, 1, "only the first attempt reached the model");
  assert.ok(typesOf(events).includes("retry"), "the retry was announced before the hook stopped the run");
  assert.ok(
    result.context.messages.every((message) => message.role !== "assistant"),
    "the failed response is not kept",
  );
});

test("a signal that fires while the hook runs ends the run aborted, not stopped", async () => {
  const controller = new AbortController();
  const { result } = await drive(
    run({
      model: scripted([]).model,
      system: SYSTEM,
      input: "Hi.",
      signal: controller.signal,
      interceptors: {
        beforeModelCall: () => {
          controller.abort();
          return { stop: "too late" };
        },
      },
      ...determinism(),
    }),
  );
  assert.equal(result.stopReason, "aborted");
});
