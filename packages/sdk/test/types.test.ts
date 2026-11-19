// Type tests: `pnpm typecheck` fails if a rule below stops holding. Each test also runs, so its body must be sound.
import assert from "node:assert/strict";
import {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type DoneResult,
  outputTool,
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
