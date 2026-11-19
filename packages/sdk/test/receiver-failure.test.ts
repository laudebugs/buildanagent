// A receiver that runs user code and throws, such as an observer's callback, must not leave siblings running.
import assert from "node:assert/strict";
import { test } from "vitest";
import { runToolCalls, type ToolCallResult } from "../src/tools/pipeline.js";
import { flush, Probe } from "./scheduler-helpers.js";
import { assistant, call } from "./tool-helpers.js";

function probeCall(id: string) {
  return call("probe", { id }, id);
}

async function runWithThrowingReceiver() {
  const probe = new Probe();
  const received: string[] = [];
  const failure = new Error("receiver failed");
  let settled = false;
  const ctx = probe.context({
    onResult({ call: { callId } }: ToolCallResult) {
      received.push(callId);
      if (callId === "a") throw failure;
    },
  });
  const running = runToolCalls(assistant([probeCall("a"), probeCall("b")]), [probe.tool()], ctx).then(
    () => undefined,
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("a");
  await flush();
  return { probe, received, failure, running, isSettled: () => settled };
}

test("a receiver that throws fires the signal the sibling calls hold", async () => {
  const { probe, running } = await runWithThrowingReceiver();
  assert.equal(probe.signals.get("b")?.aborted, true);
  probe.release("b");
  await running;
});

test("a receiver that throws does not end the batch while a sibling is still running", async () => {
  const { probe, running, isSettled } = await runWithThrowingReceiver();
  assert.equal(isSettled(), false);
  probe.release("b");
  await running;
});

test("a receiver that throws still gets the later calls' results, and its error is the one thrown", async () => {
  const { probe, received, failure, running } = await runWithThrowingReceiver();
  probe.release("b");
  assert.equal(await running, failure);
  assert.deepEqual(received, ["a", "b"]);
});
