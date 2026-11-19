import assert from "node:assert/strict";
import { test } from "vitest";
import { lookupOrderTool } from "../examples/lookup-order-tool.js";
import { refundTool } from "../examples/refund-tool.js";
import { runToolCall } from "../src/tools/pipeline.js";
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
