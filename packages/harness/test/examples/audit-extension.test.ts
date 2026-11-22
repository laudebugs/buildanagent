// Runs the README's audit extension: a bash call asks a person, another tool runs, the observer sees every event, and
// the harness records both extensions.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { createToolRegistry } from "@buildanagent/harness/tools";
import type { AgentEvent, ToolCallEvent } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { auditedHarness } from "../../examples/audit-extension.js";

const call = (tool: string): ToolCallEvent => ({
  runId: "r",
  stepIndex: 0,
  callId: "c1",
  tool,
  input: {},
  signal: new AbortController().signal,
  timestamp: "2026-11-22T00:00:00.000Z",
});

test("the audit extension asks before bash, allows the rest, logs events and is recorded", async () => {
  const model = createModel({ adapter: new ScriptedModel([]), id: "m", retries: 0 }) as Model;
  const logged: AgentEvent[] = [];
  const harness = await auditedHarness(createToolRegistry(), model, (event) => logged.push(event), {
    name: "other",
    version: "2.0.0",
  });
  const gate = harness.interceptors?.beforeToolCall;
  assert.ok(gate !== undefined);
  assert.equal((await gate(call("bash"))).decision, "ask");
  assert.equal((await gate(call("read"))).decision, "allow");
  const event = { type: "run_start" } as unknown as AgentEvent;
  for (const observer of harness.observers ?? []) await observer(event);
  assert.deepEqual(logged, [event]);
  assert.deepEqual(
    harness.extensionRecords?.map((record) => record.name),
    ["audit", "other"],
  );
});
