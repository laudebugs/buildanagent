import assert from "node:assert/strict";
import { OUTCOME_KINDS, renderOutcome, writeOutcome } from "@buildanagent/agent-safety";
import type { Message } from "@buildanagent/gateway";
import { defineTool, isSdkError, type WriteOutcome } from "@buildanagent/sdk";
import { test } from "vitest";
import { type AnyTool, runToolCall } from "../src/tools/pipeline.js";
import { call, pipelineContext, textOf } from "./tool-helpers.js";

const DECLINED = writeOutcome({
  kind: "not_applied",
  operation: "refund_create",
  reason: "CARD_DECLINED",
  next: "Ask the requester for another payment method",
});

// A refund tool that reports a fixed outcome and changes nothing: the outcome is all the test needs.
function refund(outcome: WriteOutcome, isError?: boolean): AnyTool {
  return defineTool<{ order: number }>({
    name: "refund_create",
    description: "Refund an order.",
    inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
    effect: { kind: "write", businessKey: (input) => `refund:${input.order}` },
    async execute() {
      return {
        content: [{ type: "text", text: "Refund request sent." }],
        outcome,
        ...(isError === undefined ? {} : { isError }),
      };
    },
  });
}

test("a not_applied outcome sets isError and puts the outcome sentence first in the content", async () => {
  const result = await runToolCall(call("refund_create", { order: 1 }), [refund(DECLINED)], pipelineContext());
  assert.equal(result.isError, true);
  assert.equal(result.content[0]?.type === "text" && result.content[0].text, renderOutcome(DECLINED).text);
});

test("every outcome kind except applied sets isError", async () => {
  const outcomes: Record<(typeof OUTCOME_KINDS)[number], WriteOutcome> = {
    applied: writeOutcome({
      kind: "applied",
      operation: "refund_create",
      applied: ["refund issued"],
      next: "Tell the user",
    }),
    not_applied: DECLINED,
    compensated: writeOutcome({
      kind: "compensated",
      operation: "refund_create",
      reverted: ["refund"],
      next: "Tell the user",
    }),
    partial: writeOutcome({ kind: "partial", operation: "refund_create", applied: ["half"], next: "Escalate" }),
    unknown: writeOutcome({ kind: "unknown", operation: "refund_create", next: "Check the refund's status" }),
  };
  const flags: Record<string, boolean> = {};
  for (const kind of OUTCOME_KINDS) {
    const result = await runToolCall(call("refund_create", { order: 1 }), [refund(outcomes[kind])], pipelineContext());
    flags[kind] = result.isError === true;
  }
  assert.deepEqual(flags, { applied: false, not_applied: true, compensated: true, partial: true, unknown: true });
});

test("the model-facing content carries the outcome's fields as JSON after the sentence", async () => {
  const result = await runToolCall(call("refund_create", { order: 1 }), [refund(DECLINED)], pipelineContext());
  const payload = result.content[1]?.type === "text" ? JSON.parse(result.content[1].text) : undefined;
  assert.deepEqual(payload, { outcome: renderOutcome(DECLINED).payload });
  assert.equal(textOf(result.content.slice(2)), "Refund request sent.");
});

test("an applied outcome keeps a tool's own isError", async () => {
  const applied = writeOutcome({ kind: "applied", operation: "refund_create", next: "Tell the user" });
  const result = await runToolCall(call("refund_create", { order: 1 }), [refund(applied, true)], pipelineContext());
  assert.equal(result.isError, true);
});

test("an outcome round-trips through a JSON-serialised context and renders the same sentence", async () => {
  const result = await runToolCall(call("refund_create", { order: 1 }), [refund(DECLINED)], pipelineContext());
  const message: Message = {
    role: "tool",
    callId: "call-1",
    content: [...result.content],
    isError: result.isError === true,
  };
  const context = { system: "You handle refunds.", messages: [message], results: [result] };
  const revived = JSON.parse(JSON.stringify(context)) as typeof context;
  assert.deepEqual(revived, JSON.parse(JSON.stringify(context)));
  assert.deepEqual(revived.messages, [message]);
  const outcome = revived.results[0]?.outcome as WriteOutcome;
  assert.deepEqual(outcome, DECLINED);
  assert.equal(renderOutcome(outcome).text, renderOutcome(DECLINED).text);
});

test("an outcome that breaks a rule throws an SdkError", async () => {
  const broken = { ...DECLINED, reason: "card declined" } as WriteOutcome;
  await assert.rejects(
    () => runToolCall(call("refund_create", { order: 1 }), [refund(broken)], pipelineContext()),
    (error) => isSdkError(error) && error.code === "invalid_tool_result",
  );
});
