import assert from "node:assert/strict";
import { test } from "vitest";
import { lookupOrderTool } from "../examples/lookup-order-tool.js";
import { answerOrderQuestion } from "../examples/order-agent.js";
import { refundTool } from "../examples/refund-tool.js";
import { runToolCall } from "../src/tools/pipeline.js";
import { scripted, text, toolCall } from "./run-helpers.js";
import { call, pipelineContext, textOf } from "./tool-helpers.js";

test("the lookup_order example returns the order's status to the model", async () => {
  const tool = lookupOrderTool(async (id) => ({ id, status: "shipped" }));
  const result = await runToolCall(call("lookup_order", { order: 42 }), [tool], pipelineContext());
  assert.equal(textOf(result.content), "Order 42 is shipped.");
});

test("the lookup_order example rejects an order number that is not a positive integer", async () => {
  const tool = lookupOrderTool(async () => assert.fail("the lookup must not run"));
  const result = await runToolCall(call("lookup_order", { order: -1 }), [tool], pipelineContext());
  assert.equal(result.isError, true);
  assert.match(textOf(result.content), /^- \/order: /m);
});

test("the refund example reports a declined refund as a not_applied outcome", async () => {
  const tool = refundTool(async () => ({ status: "declined", code: "CARD_DECLINED" }));
  const result = await runToolCall(call("refund_create", { order: 42 }), [tool], pipelineContext());
  assert.equal(result.isError, true);
  assert.match(textOf(result.content), /^The refund_create call did not take effect, and nothing changed\./);
});

test("the refund example reports an issued refund as an applied outcome", async () => {
  const tool = refundTool(async () => ({ status: "refunded", refundId: "re_1" }));
  const result = await runToolCall(call("refund_create", { order: 42 }), [tool], pipelineContext());
  assert.equal(result.isError, false);
  assert.match(textOf(result.content), /^The refund_create call took effect\./);
});

test("the order agent example streams the answer after looking the order up", async () => {
  const { adapter, model } = scripted([toolCall("lookup_order", { order: 42 }), text("Order 42 has shipped.")]);
  let streamed = "";
  const outcome = await answerOrderQuestion(
    model,
    async (id) => ({ id, status: "shipped" }),
    "Where is 42?",
    (t) => {
      streamed += t;
    },
  );
  adapter.assertComplete();
  assert.equal(outcome, "Order 42 has shipped.");
  assert.equal(streamed, "Order 42 has shipped.");
});

test("the order agent example reports a run that reached its step cap", async () => {
  const { model } = scripted(Array.from({ length: 5 }, () => toolCall("lookup_order", { order: 42 })));
  const outcome = await answerOrderQuestion(
    model,
    async (id) => ({ id, status: "shipped" }),
    "Loop",
    () => undefined,
  );
  assert.equal(outcome, "the run stopped early: max_steps");
});

test("the offline order agent example answers from its scripted model", async () => {
  const { answerOffline } = await import("../examples/offline-order-agent.js");
  assert.equal(await answerOffline(), "Order 42 has shipped.");
});

test("the refund approval example pauses a refund and runs it after the person allows it", async () => {
  const { startRefund, resumeRefund } = await import("../examples/refund-approval.js");
  const { processSigner, pendingOf } = await import("./resume-helpers.js");
  const { drive } = await import("./run-helpers.js");
  const refunds: number[] = [];
  const issueRefund = async (order: number) => {
    refunds.push(order);
    return { status: "refunded" as const, refundId: "re_1" };
  };
  const first = scripted([toolCall("refund_create", { order: 42 }, "call-1")]);
  const paused = await drive(startRefund({ model: first.model, signer: processSigner(), issueRefund }, "Refund 42"));
  assert.equal(paused.result.stopReason, "awaiting_approval");
  assert.deepEqual(refunds, [], "the refund waits for the person");
  const [request] = pendingOf(paused.result);
  assert.ok(request);

  const second = scripted([text("Refunded.")]);
  const deps = { model: second.model, signer: processSigner(), issueRefund };
  const stored = JSON.parse(JSON.stringify(paused.result.context));
  const done = await drive(resumeRefund(deps, stored, [{ requestId: request.id, decision: "allow" }]));
  assert.equal(done.result.stopReason, "done");
  assert.deepEqual(refunds, [42]);
});

test("the make-model example binds the Anthropic adapter to one model id", async () => {
  const { makeModel } = await import("../examples/make-model.js");
  const model = makeModel("test-key");
  assert.deepEqual(model.ref, { api: "anthropic-messages", provider: "anthropic", id: "claude-opus-5-5" });
});

test("the make-model example binds the OpenAI adapter to one model id", async () => {
  const { makeOpenAiModel } = await import("../examples/make-model.js");
  const model = makeOpenAiModel("test-key");
  assert.deepEqual(model.ref, { api: "openai-chat", provider: "openai", id: "gpt-5.4-mini" });
});

test("the offline-setup example turns real model requests off", async () => {
  const { OFFLINE } = await import("../examples/offline-setup.js");
  assert.equal(OFFLINE, true);
  await assert.rejects(() => fetch("https://api.anthropic.com/v1/messages"), /blocked|disabled|loopback|not allowed/i);
});
