// The loop over parallel tool calls: transcript order, events and aborts.
import assert from "node:assert/strict";
import type { ContentBlock } from "@buildanagent/gateway";
import { run } from "@buildanagent/sdk";
import { test } from "vitest";
import { determinism, drive, scripted, text, typesOf } from "./run-helpers.js";
import { Probe } from "./scheduler-helpers.js";

const SYSTEM = "You run probes.";

function twoCalls(): { content: ContentBlock[] } {
  return {
    content: [
      { type: "tool_call", callId: "a", name: "probe", input: { id: "a" } },
      { type: "tool_call", callId: "b", name: "probe", input: { id: "b" } },
    ],
  };
}

function probeRun(probe: Probe, options: { signal?: AbortSignal } = {}) {
  const { model } = scripted([twoCalls(), text("Done.")]);
  return run({ model, system: SYSTEM, input: "Go.", tools: [probe.tool()], ...determinism(), ...options });
}

test("a step's tool messages are in model order although the calls finish in the other order", async () => {
  const probe = new Probe();
  const driven = drive(probeRun(probe));
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("b");
  probe.release("a");
  const { result } = await driven;
  const callIds = result.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : []));
  assert.deepEqual(callIds, ["a", "b"]);
  assert.deepEqual(probe.log.slice(2), ["end b", "end a"]);
});

test("both calls start before either ends, and tool_call_end events come in model order", async () => {
  const probe = new Probe();
  const driven = drive(probeRun(probe));
  await Promise.all([probe.started("a"), probe.started("b")]);
  probe.release("b");
  probe.release("a");
  const { events } = await driven;
  const toolEvents = events.flatMap((event) =>
    event.type === "tool_call_start" || event.type === "tool_call_end" ? [`${event.type} ${event.callId}`] : [],
  );
  assert.deepEqual(toolEvents, ["tool_call_start a", "tool_call_start b", "tool_call_end a", "tool_call_end b"]);
});

test("an abort while calls run in parallel gives every call a result and settles before run_end", async () => {
  const probe = new Probe();
  const controller = new AbortController();
  const driven = drive(probeRun(probe, { signal: controller.signal }));
  await Promise.all([probe.started("a"), probe.started("b")]);
  controller.abort("stop");
  probe.release("a");
  probe.release("b");
  const { events, result } = await driven;
  assert.equal(result.stopReason, "aborted");
  const callIds = result.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : []));
  assert.deepEqual(callIds, ["a", "b"]);
  assert.deepEqual(typesOf(events).slice(-2), ["agent_settled", "run_end"]);
});
