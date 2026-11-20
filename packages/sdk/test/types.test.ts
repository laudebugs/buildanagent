// Type tests: `pnpm typecheck` fails if a rule below stops holding. Each test also runs, so its body must be sound.
import assert from "node:assert/strict";
import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type CallOptions,
  type DoneResult,
  type Interceptors,
  outputTool,
  type RunOptions,
  type RunResult,
  run,
} from "@buildanagent/sdk";
import { test } from "vitest";
import { z } from "zod";
import { drive, scripted, toolCall } from "./run-helpers.js";

test("reading result.output without narrowing on stopReason is a compile error", async () => {
  const { model } = scripted([toolCall("answer", { total: 1 })]);
  const answer = outputTool({ name: "answer", schema: z.object({ total: z.number() }) });
  const { result } = await drive(run({ model, system: "", input: "Sum.", output: answer }));
  // @ts-expect-error: only the done variant carries output
  const unnarrowed = result.output;
  assert.deepEqual(unnarrowed, { total: 1 });
  if (result.stopReason === "done") {
    const total: number | undefined = result.output?.total;
    assert.equal(total, 1);
  }
});

test("AGENT_EVENT_TYPES lists every AgentEvent type and nothing else", () => {
  type Listed = (typeof AGENT_EVENT_TYPES)[number];
  type Missing = Exclude<AgentEvent["type"], Listed>;
  type Extra = Exclude<Listed, AgentEvent["type"]>;
  const complete: [Missing, Extra] extends [never, never] ? true : false = true;
  assert.equal(complete, true);
  assert.equal(new Set(AGENT_EVENT_TYPES).size, AGENT_EVENT_TYPES.length);
});

test("a raw event's payload is unknown, and includeRaw is a run option, not a model-call option", () => {
  type Raw = Extract<AgentEvent, { type: "raw" }>;
  const payload: unknown extends Raw["event"] ? true : false = true;
  const onRun: RunOptions["includeRaw"] extends boolean | undefined ? true : false = true;
  const notOnCall: "includeRaw" extends keyof CallOptions ? false : true = true;
  assert.deepEqual([payload, onRun, notOnCall], [true, true, true]);
  assert.ok(AGENT_EVENT_TYPES.includes("raw"));
});

test("only the done variant of RunResult carries output", () => {
  type WithOutput = Extract<RunResult<string>, { output: unknown }>;
  const onlyDone: [WithOutput] extends [DoneResult<string>]
    ? [DoneResult<string>] extends [WithOutput]
      ? true
      : false
    : false = true;
  assert.equal(onlyDone, true);
});

test("an error result always carries its run error", () => {
  type ErrorVariant = Extract<RunResult, { stopReason: "error" }>;
  const required: undefined extends ErrorVariant["error"] ? false : true = true;
  assert.equal(required, true);
});

test("a no_progress result carries its reason", () => {
  type NoProgress = Extract<RunResult, { stopReason: "no_progress" }>;
  const required: undefined extends NoProgress["reason"] ? false : true = true;
  assert.equal(required, true);
});

test("a hook may be a plain function, an async one, or return nothing", () => {
  const hooks: Interceptors = {
    beforeModelCall: () => {},
    afterToolCall: async () => {},
    shouldStop: () => false,
    transformContext: (e) => e.messages,
  };
  assert.equal(Object.keys(hooks).length, 4);
});

test("a gate that returns no decision is a compile error", () => {
  // @ts-expect-error: a gate must return allow, deny or ask
  const hooks: Interceptors = { beforeToolCall: async () => {} };
  assert.equal(typeof hooks.beforeToolCall, "function");
});

test("a retry event says which layer retried, and the layer is one of two names", () => {
  type Retry = Extract<AgentEvent, { type: "retry" }>;
  const layers: Retry["layer"][] = ["gateway", "turn"];
  // @ts-expect-error: a retry event without a layer no longer type-checks
  const unlayered: Retry = {
    type: "retry",
    attempt: 1,
    delayMs: 0,
    error: "x",
    runId: "",
    seq: 0,
    stepIndex: 0,
    timestamp: "",
  };
  assert.deepEqual(layers, ["gateway", "turn"]);
  assert.equal(unlayered.type, "retry");
});
