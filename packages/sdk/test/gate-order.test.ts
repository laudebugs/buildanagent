// Gates run in model order before any call executes, and an abort still gives every call a result.
import assert from "node:assert/strict";
import type { ContentBlock } from "@buildanagent/gateway";
import { test } from "vitest";
import { hookedRun } from "./hook-helpers.js";
import { drive, text, typesOf } from "./run-helpers.js";
import { deferred, flush, Probe } from "./scheduler-helpers.js";

function twoCalls(): { content: ContentBlock[] } {
  return {
    content: [
      { type: "tool_call", callId: "a", name: "probe", input: { id: "a" } },
      { type: "tool_call", callId: "b", name: "probe", input: { id: "b" } },
    ],
  };
}

test("the gate asks about calls one at a time in model order, and no call starts before every gate has answered", async () => {
  const probe = new Probe();
  const opened = [deferred(), deferred()];
  const entered = [deferred(), deferred()];
  const asked: string[] = [];
  const { started } = hookedRun(
    [twoCalls(), text("Done.")],
    {
      beforeToolCall: async (e) => {
        asked.push(e.callId);
        entered[asked.length - 1]?.resolve();
        await opened[asked.length - 1]?.promise;
        return { decision: "allow" };
      },
    },
    { tools: [probe.tool()] },
  );
  const driven = drive(started);
  await entered[0]?.promise;
  await flush();
  assert.deepEqual(asked, ["a"]);
  opened[0]?.resolve();
  await entered[1]?.promise;
  assert.deepEqual(asked, ["a", "b"]);
  assert.deepEqual(probe.log, []);
  opened[1]?.resolve();
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("a");
  probe.release("b");
  await driven;
});

test("an abort while a gate waits gives every call a result, and agent_settled comes before run_end", async () => {
  const probe = new Probe();
  const controller = new AbortController();
  const open = deferred();
  const entered = deferred();
  const { started } = hookedRun(
    [twoCalls()],
    {
      beforeToolCall: async () => {
        entered.resolve();
        await open.promise;
        return { decision: "allow" };
      },
    },
    { tools: [probe.tool()], signal: controller.signal },
  );
  const driven = drive(started);
  await entered.promise;
  controller.abort("stop");
  open.resolve();
  const { events, result } = await driven;
  assert.equal(result.stopReason, "aborted");
  assert.deepEqual(
    result.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : [])),
    ["a", "b"],
  );
  assert.deepEqual(probe.log, []);
  assert.deepEqual(typesOf(events).slice(-2), ["agent_settled", "run_end"]);
});
