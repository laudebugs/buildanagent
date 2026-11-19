// The clarification pause: a tool's question ends the run clarification_requested with a signed request of kind
// clarification, and the user's answer, passed to continueRun() in another process, reaches the model as the tool
// result.
import assert from "node:assert/strict";
import { clarificationTool, continueRun, defineTool, run, type SignedPendingRequest } from "@buildanagent/sdk";
import { test } from "vitest";
import { calls, pendingOf, processSigner, roundTrip, spyGate, toolTexts } from "./resume-helpers.js";
import { determinism, drive, scripted, text, typesOf } from "./run-helpers.js";

const SYSTEM = "You track orders.";

async function asked() {
  const { model } = scripted([calls(["ask_user", { question: "Which order?" }, "c1"])]);
  const driven = await drive(
    run({
      model,
      system: SYSTEM,
      input: "Where is my order?",
      tools: [clarificationTool()],
      signer: processSigner(),
      ...determinism(),
    }),
  );
  return { ...driven, pending: pendingOf(driven.result) };
}

test("a question ends the run clarification_requested with one signed clarification request", async () => {
  const { result, events, pending } = await asked();
  assert.equal(result.stopReason, "clarification_requested");
  const [request] = pending as [SignedPendingRequest];
  assert.equal(request.kind, "clarification");
  assert.equal(request.question, "Which order?");
  assert.equal(request.callId, "c1");
  assert.deepEqual(result.context.pendingInputs, { [request.id]: { question: "Which order?" } });
  // The asking call has no result yet, and gets no tool_call_end, only the request.
  assert.equal(result.context.messages.at(-1)?.role, "assistant");
  const types = typesOf(events);
  assert.deepEqual(types.slice(types.indexOf("tool_call_start")), [
    "tool_call_start",
    "approval_request",
    "step_end",
    "agent_settled",
    "run_end",
  ]);
});

test("the answer reaches the model as the tool result, in a fresh continueRun", async () => {
  const { result, pending } = await asked();
  const { model, adapter } = scripted([text("Order 42 has shipped.")]);
  const next = await drive(
    continueRun(roundTrip(result.context), {
      model,
      tools: [clarificationTool()],
      signer: processSigner(),
      resolutions: [{ requestId: pending[0]?.id ?? "", answer: "Order 42", by: "user" }],
      ...determinism(),
    }),
  );
  assert.equal(next.result.stopReason, "done");
  assert.equal(toolTexts(adapter.calls[0]?.context.messages ?? []).c1, "Order 42");
  assert.equal(next.result.steps, 1);
  adapter.assertComplete();
});

test("an approval decision for a clarification runs nothing and asks again", async () => {
  const { result, pending } = await asked();
  const { model, adapter } = scripted([]);
  const next = await drive(
    continueRun(roundTrip(result.context), {
      model,
      tools: [clarificationTool()],
      signer: processSigner(),
      resolutions: [{ requestId: pending[0]?.id ?? "", decision: "allow" }],
      ...determinism(),
    }),
  );
  assert.equal(adapter.calls.length, 0);
  const rejected = next.events.find((event) => event.type === "resolution_rejected");
  assert.equal(rejected?.type === "resolution_rejected" && rejected.cause, "resolution_mismatch");
  // The call asks again for an approval; once approved, the tool asks its question again.
  assert.equal(next.result.stopReason, "awaiting_approval");
  assert.equal(pendingOf(next.result)[0]?.callId, "c1");
});

test("a step with a question and an approval ends awaiting_approval, with both requests in model order", async () => {
  const refund = defineTool({
    name: "refund",
    description: "Refund an order.",
    inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
    async execute() {
      return { content: [{ type: "text", text: "refunded" }] };
    },
  });
  const { model } = scripted([calls(["ask_user", { question: "Why?" }, "c1"], ["refund", { order: 1 }, "c2"])]);
  const { result } = await drive(
    run({
      model,
      system: SYSTEM,
      input: "Refund order 1.",
      tools: [clarificationTool(), refund],
      interceptors: spyGate().interceptors,
      signer: processSigner(),
      ...determinism(),
    }),
  );
  assert.equal(result.stopReason, "awaiting_approval");
  assert.deepEqual(
    pendingOf(result).map((request) => [request.callId, request.kind]),
    [
      ["c1", "clarification"],
      ["c2", "approval"],
    ],
  );
});
