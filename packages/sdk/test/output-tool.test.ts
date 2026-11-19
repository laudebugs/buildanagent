import assert from "node:assert/strict";
import { clarificationTool, outputTool } from "@buildanagent/sdk";
import { test } from "vitest";
import { z } from "zod";
import { runToolCall } from "../src/tools/pipeline.js";
import { call, pipelineContext, textOf } from "./tool-helpers.js";

const triage = outputTool({
  name: "submit_triage",
  schema: z.object({ priority: z.enum(["low", "high"]), summary: z.string().min(1) }),
});

test("a valid output call returns the validated answer as structured and ends the run", async () => {
  const input = { priority: "high", summary: "Login fails on Safari" };
  const result = await runToolCall(call("submit_triage", input), [triage], pipelineContext());
  assert.deepEqual(result.structured, input);
  assert.equal(result.terminate, true);
  assert.equal(result.isError, undefined);
});

test("an output call that fails its schema returns the issues to the model as an error result", async () => {
  const result = await runToolCall(call("submit_triage", { priority: "urgent" }), [triage], pipelineContext());
  assert.equal(result.isError, true);
  assert.equal(result.structured, undefined);
  assert.equal(result.terminate, undefined);
  assert.match(textOf(result.content), /^- \/priority: /m);
  assert.match(textOf(result.content), /^- \/summary: /m);
});

test("clarificationTool returns the question as a clarification pause", async () => {
  const ask = clarificationTool();
  const result = await runToolCall(call("ask_user", { question: "Which order?" }), [ask], pipelineContext());
  assert.deepEqual(result.pause, { kind: "clarification", question: "Which order?" });
});

test("clarificationTool takes a custom name", () => {
  assert.equal(clarificationTool({ name: "ask_customer" }).name, "ask_customer");
});
