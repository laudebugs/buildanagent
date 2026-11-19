// blockingApprovals(): the run signs and emits the request before it waits, then runs or denies the call by the
// handler's answer, and every answer it can't verify denies the call.
import assert from "node:assert/strict";
import {
  type AgentEvent,
  type ApprovalHandler,
  blockingApprovals,
  composeInterceptors,
  isSdkError,
  run,
} from "@buildanagent/sdk";
import { test } from "vitest";
import { calls, processSigner, recordingTool, spyGate, toolTexts } from "./resume-helpers.js";
import { determinism, drive, scripted, text } from "./run-helpers.js";

async function blockingRun(handler: ApprovalHandler, signal?: AbortSignal) {
  const refund = recordingTool("refund");
  const { model, adapter } = scripted([calls(["refund", { order: 1 }, "c1"]), text("Done.")]);
  const driven = await drive(
    run({
      model,
      system: "You handle refunds.",
      input: "Refund order 1.",
      tools: [refund.tool],
      interceptors: composeInterceptors(spyGate().interceptors, blockingApprovals(handler)),
      signer: processSigner(),
      ...(signal === undefined ? {} : { signal }),
      ...determinism(),
    }),
  );
  return { ...driven, refund, adapter };
}

test("blockingApprovals() hands the handler the signed request and its input, then runs the allowed call", async () => {
  const asked: unknown[] = [];
  const { result, events, refund } = await blockingRun(async (request, { input }) => {
    asked.push([request.id, input]);
    return { requestId: request.id, decision: "allow" };
  });
  const request = events.find((event) => event.type === "approval_request");
  const id = request?.type === "approval_request" ? request.request.id : undefined;
  assert.deepEqual(asked, [[id, { order: 1, note: "checked by policy" }]]);
  assert.deepEqual(refund.inputs, [{ order: 1, note: "checked by policy" }]);
  const types = events.map((event) => event.type);
  assert.ok(types.indexOf("approval_request") < types.indexOf("tool_call_end"));
  assert.equal(result.stopReason, "done");
});

test("blockingApprovals() emits approval_request before it waits (event order)", async () => {
  let emittedFirst = false;
  const events: AgentEvent[] = [];
  const refund = recordingTool("refund");
  const { model } = scripted([calls(["refund", { order: 1 }, "c1"]), text("Done.")]);
  const started = run({
    model,
    system: "s",
    input: "i",
    tools: [refund.tool],
    interceptors: composeInterceptors(
      spyGate().interceptors,
      blockingApprovals(async (request) => {
        // The run can't go past this call until the handler answers, so a yield lets the stream catch up with what
        // the run emitted before it started waiting, and nothing after.
        await new Promise((resolve) => setTimeout(resolve, 0));
        emittedFirst = events.some((event) => event.type === "approval_request" && event.request.id === request.id);
        return { requestId: request.id, decision: "allow" };
      }),
    ),
    signer: processSigner(),
    ...determinism(),
  });
  const iterate = (async () => {
    for await (const event of started) events.push(event);
  })();
  await started.result;
  await iterate;
  assert.equal(emittedFirst, true);
});

test("a deny reaches the model as an error result, and the call never runs", async () => {
  const { refund, adapter } = await blockingRun((request) => ({
    requestId: request.id,
    decision: "deny",
    reason: "not today",
  }));
  assert.deepEqual(refund.inputs, []);
  assert.equal(toolTexts(adapter.calls[1]?.context.messages ?? []).c1, 'Tool call "refund" was denied: not today');
});

test("an answer for another request, an answer of the wrong kind or a throwing handler denies the call", async () => {
  const answers: ApprovalHandler[] = [
    () => ({ requestId: "other", decision: "allow" }),
    (request) => ({ requestId: request.id, answer: "yes" }),
    () => {
      throw new Error("approver offline");
    },
  ];
  for (const handler of answers) {
    const { refund, events } = await blockingRun(handler);
    assert.deepEqual(refund.inputs, []);
    assert.ok(events.some((event) => event.type === "hook_error" && event.hook === "blockingApprovals"));
  }
});

test("an abort while the run waits denies the call", async () => {
  const controller = new AbortController();
  const { refund, result } = await blockingRun(() => {
    controller.abort();
    return new Promise(() => undefined);
  }, controller.signal);
  assert.deepEqual(refund.inputs, []);
  assert.equal(result.stopReason, "aborted");
});

test("blockingApprovals() takes a function, and only one joins", () => {
  assert.throws(
    () => blockingApprovals("yes" as never),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
  const handler: ApprovalHandler = (request) => ({ requestId: request.id, decision: "allow" });
  assert.throws(
    () => composeInterceptors(blockingApprovals(handler), blockingApprovals(handler)),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
});
