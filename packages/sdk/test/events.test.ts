import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ModelMiddleware } from "@buildanagent/gateway";
import { AGENT_EVENT_TYPES, CAPABILITIES, DEFAULTS_HASH, defineTool, run } from "@buildanagent/sdk";
import { test } from "vitest";
import { assertDeclaredEvents, recordEventTypes } from "./event-check.js";
import { determinism, drive, lookup, START, scripted, text, toolCall, typesOf } from "./run-helpers.js";

const SYSTEM = "You look up orders.";
const packageVersion: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function lookupRun() {
  const { model } = scripted([toolCall("lookup", { order: 42 }), text("Shipped.")]);
  return run({ model, system: SYSTEM, input: "Where is order 42?", tools: [lookup], ...determinism() });
}

test("run_start comes first, with the SDK's version, spec version, defaults hash, capabilities and the model", async () => {
  const { events } = await drive(lookupRun());
  assert.deepEqual(events[0], {
    runId: "run-1",
    seq: 0,
    stepIndex: 0,
    timestamp: START,
    type: "run_start",
    sdkVersion: packageVersion,
    specVersion: "v1",
    defaultsHash: DEFAULTS_HASH,
    capabilities: CAPABILITIES,
    model: { api: "scripted", provider: "scripted", id: "scripted-model" },
  });
});

test("run_end comes last and carries the result", async () => {
  const { events, result } = await drive(lookupRun());
  const last = events.at(-1);
  assert.equal(last?.type, "run_end");
  assert.deepEqual(last?.type === "run_end" ? last.result : undefined, result);
});

test("seq counts every event from 0, and each event carries the run id and a clock timestamp", async () => {
  const { events } = await drive(lookupRun());
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_, index) => index),
  );
  assert.ok(events.every((event) => event.runId === "run-1"));
  assert.equal(events[1]?.timestamp, "2026-11-19T12:00:01.000Z");
});

test("a tool-calling step emits its events in order, and stepIndex counts model calls", async () => {
  const { events } = await drive(lookupRun());
  const first = events.filter((event) => event.stepIndex === 0 && event.type !== "tool_input_delta");
  assert.deepEqual(typesOf(first), [
    "run_start",
    "step_start",
    "model_call_start",
    "tool_input_start",
    "tool_input_end",
    "model_call_end",
    "tool_call_start",
    "tool_call_end",
    "step_end",
  ]);
  assert.ok(events.some((event) => event.stepIndex === 1 && event.type === "model_call_start"));
});

test("step_end reports continue after a tool step and stop after the final answer", async () => {
  const { events } = await drive(lookupRun());
  const checks = events.flatMap((event) => (event.type === "step_end" ? [event.stopCheck] : []));
  assert.deepEqual(checks, ["continue", "stop"]);
});

test("the text deltas join into the text block that text_end carries", async () => {
  const { events } = await drive(
    run({ model: scripted([text("Order 42 has shipped.")]).model, system: SYSTEM, input: "?" }),
  );
  const deltas = events.flatMap((event) => (event.type === "text_delta" ? [event.delta] : []));
  const end = events.find((event) => event.type === "text_end");
  assert.deepEqual(end?.type === "text_end" ? end.block : undefined, { type: "text", text: deltas.join("") });
});

test("model_call_start carries the request, and model_call_end the authoritative message", async () => {
  const { events, result } = await drive(lookupRun());
  const start = events.find((event) => event.type === "model_call_start");
  const end = events.find((event) => event.type === "model_call_end");
  assert.equal(start?.type === "model_call_start" ? start.request.context.messages.length : undefined, 1);
  assert.deepEqual(start?.type === "model_call_start" ? start.request.context.tools.map((t) => t.name) : [], [
    "lookup",
  ]);
  assert.deepEqual(end?.type === "model_call_end" ? end.message : undefined, result.messages[1]);
});

test("tool_call_start carries the call, and tool_call_end the result the model reads", async () => {
  const { events } = await drive(lookupRun());
  const start = events.find((event) => event.type === "tool_call_start");
  const end = events.find((event) => event.type === "tool_call_end");
  assert.deepEqual(start?.type === "tool_call_start" ? [start.callId, start.tool, start.input] : [], [
    "call-1",
    "lookup",
    { order: 42 },
  ]);
  assert.deepEqual(end?.type === "tool_call_end" ? end.result.content : [], [
    { type: "text", text: 'order {"order":42} is shipped' },
  ]);
});

test("a tool's update() emits tool_call_update with its details", async () => {
  const progress = defineTool({
    name: "progress",
    description: "Reports progress.",
    inputSchema: { type: "object" },
    async execute(_input, ctx) {
      ctx.update({ rows: 10 });
      return { content: [{ type: "text", text: "done" }] };
    },
  });
  const { model } = scripted([toolCall("progress", {}), text("Done.")]);
  const { events } = await drive(run({ model, system: SYSTEM, input: "Go.", tools: [progress] }));
  const update = events.find((event) => event.type === "tool_call_update");
  assert.deepEqual(update?.type === "tool_call_update" ? [update.callId, update.details] : [], [
    "call-1",
    { rows: 10 },
  ]);
});

test("a model warning becomes a warning event with code model_warning", async () => {
  const warn: ModelMiddleware = {
    async *wrapStream({ next }) {
      yield { type: "warning", code: "dropped_temperature", message: "temperature is not supported" };
      yield* next();
    },
  };
  const { model } = scripted([text("Hi.")], { middleware: [warn] });
  const { events } = await drive(run({ model, system: SYSTEM, input: "Hi." }));
  const warning = events.find((event) => event.type === "warning");
  assert.deepEqual(warning?.type === "warning" ? [warning.code, warning.detail] : [], [
    "model_warning",
    "dropped_temperature: temperature is not supported",
  ]);
});

test("a gateway retry becomes a retry event", async () => {
  const overloaded = { content: [], error: { kind: "retryable" as const, message: "overloaded", status: 529 } };
  const { model } = scripted([overloaded, text("Hi.")], { retries: 1 });
  const { events, result } = await drive(run({ model, system: SYSTEM, input: "Hi." }));
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, 1);
  const retry = events.find((event) => event.type === "retry");
  assert.equal(retry?.type === "retry" ? retry.attempt : undefined, 1);
  assert.equal(retry?.type === "retry" ? retry.layer : undefined, "gateway");
});

test("an error stop emits an error event with the run error before agent_settled", async () => {
  const error = { kind: "quota" as const, message: "out of credit", status: 402 };
  const { events } = await drive(
    run({ model: scripted([{ content: [], error }]).model, system: SYSTEM, input: "Hi." }),
  );
  assert.deepEqual(typesOf(events).slice(-3), ["error", "agent_settled", "run_end"]);
  const event = events.at(-3);
  assert.deepEqual(event?.type === "error" ? event.error : undefined, error);
});

test("every iteration of a run replays its events from the first", async () => {
  const started = lookupRun();
  const first = await drive(started);
  const second = await drive(started);
  assert.deepEqual(second.events, first.events);
});

test("the same script, clock and ids produce a deep-equal event log on a second run", async () => {
  const first = await drive(lookupRun());
  const second = await drive(lookupRun());
  assert.deepEqual(second.events, first.events);
});

test("every event type a run emits is declared in AGENT_EVENT_TYPES", async () => {
  const { events } = await drive(lookupRun());
  assert.deepEqual(
    typesOf(events).filter((type) => !(AGENT_EVENT_TYPES as readonly string[]).includes(type)),
    [],
  );
});

// test.fails passes only if the test fails, and here only the teardown check in test/setup.ts can fail it.
test.fails("the teardown check fails a test that emits an undeclared event type", () => {
  recordEventTypes([{ type: "run_start" }, { type: "compaction" }]);
});

test("the teardown check names each undeclared event type", () => {
  recordEventTypes([{ type: "run_start" }, { type: "compaction" }]);
  assert.throws(() => assertDeclaredEvents(), /missing from AGENT_EVENT_TYPES were emitted: compaction$/);
});
