// Resuming a paused context with continueRun(): a verified allow runs once without the gate and with the signed
// input, a deny reaches the model, every failed check runs nothing and asks again, and a context survives a JSON
// round trip and a rebuild by hand from stored events, checked by a second signer over the same key ring.
import assert from "node:assert/strict";
import { emptyUsage, transformMessages } from "@buildanagent/gateway";
import {
  type AgentEvent,
  type Context,
  type ContinueOptions,
  continueRun,
  defineTool,
  isSdkError,
  type Resolution,
  run,
  type SignedPendingRequest,
} from "@buildanagent/sdk";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import {
  calls,
  contextFromLog,
  otherRingSigner,
  pendingOf,
  processSigner,
  recordingTool,
  roundTrip,
  spyGate,
  toolTexts,
} from "./resume-helpers.js";
import { determinism, drive, scripted, text, typesOf } from "./run-helpers.js";

const SYSTEM = "You handle refunds.";
const INPUT = "Refund order 1.";

/** The first process: a run whose gate pauses the refund, signed with that process's own signer. */
async function pause(steps: ScriptStep[] = [calls(["lookup", { order: 1 }, "c1"], ["refund", { order: 1 }, "c2"])]) {
  const refund = recordingTool("refund");
  const lookup = recordingTool("lookup");
  const gate = spyGate();
  const { model } = scripted(steps);
  const { events, result } = await drive(
    run({
      model,
      system: SYSTEM,
      input: INPUT,
      tools: [lookup.tool, refund.tool],
      interceptors: gate.interceptors,
      signer: processSigner(),
      ...determinism(),
    }),
  );
  return { events, result, pending: pendingOf(result), context: result.context };
}

/** The second process: its own tools, gate and signer over the shared key ring, resuming from `context`. */
async function resume(
  context: Context,
  resolutions: Resolution[] | undefined,
  steps: ScriptStep[] = [text("Refunded.")],
  options: Partial<ContinueOptions> = {},
) {
  const refund = recordingTool("refund");
  const lookup = recordingTool("lookup");
  const gate = spyGate();
  const { adapter, model } = scripted(steps);
  const driven = await drive(
    continueRun(context, {
      model,
      tools: [lookup.tool, refund.tool],
      interceptors: gate.interceptors,
      signer: processSigner(),
      ...determinism(),
      ...(resolutions === undefined ? {} : { resolutions }),
      ...options,
    }),
  );
  return { ...driven, adapter, refund, lookup, gate };
}

function allow(request: SignedPendingRequest | undefined): Resolution {
  return { requestId: request?.id ?? "", decision: "allow", by: "manager" };
}

test("an allow runs the call once, with the input its request signs, and without calling beforeToolCall", async () => {
  const { context, pending } = await pause();
  const next = await resume(roundTrip(context), [allow(pending[0])]);
  assert.deepEqual(next.gate.seen, []);
  // The gate added a note before the pause; the model's own arguments had none.
  assert.deepEqual(next.refund.inputs, [{ order: 1, note: "checked by policy" }]);
  assert.equal(next.result.stopReason, "done");
  assert.match(toolTexts(next.adapter.calls[0]?.context.messages ?? []).c2 ?? "", /refund .* done/);
  assert.equal(next.adapter.calls.length, 1);
  next.adapter.assertComplete();
});

test("a deny gives the model an error result with the reason, and the call never runs", async () => {
  const { context, pending } = await pause();
  const deny: Resolution = { requestId: pending[0]?.id ?? "", decision: "deny", reason: "over the limit" };
  const next = await resume(roundTrip(context), [deny]);
  assert.deepEqual(next.refund.inputs, []);
  const sent = next.adapter.calls[0]?.context.messages ?? [];
  assert.equal(toolTexts(sent).c2, 'Tool call "refund" was denied: over the limit');
  const result = sent.find((message) => message.role === "tool" && message.callId === "c2");
  assert.equal(result?.role === "tool" && result.isError, true);
});

/** Runs nothing, makes no model call, and pauses the call again. */
async function assertAsksAgain(context: Context, resolutions: Resolution[], cause: string) {
  const next = await resume(context, resolutions, []);
  assert.deepEqual(next.refund.inputs, []);
  assert.equal(next.adapter.calls.length, 0);
  assert.equal(next.result.stopReason, "awaiting_approval");
  assert.equal(next.result.steps, 0);
  const rejected = next.events.find((event) => event.type === "resolution_rejected");
  assert.equal(rejected?.type === "resolution_rejected" && rejected.cause, cause);
  const [again] = pendingOf(next.result);
  assert.equal(again?.callId, "c2");
  return { next, again };
}

test("a tampered signature runs nothing and asks again with a new request", async () => {
  const { context, pending } = await pause();
  const [request] = pending as [SignedPendingRequest];
  const tampered = { ...roundTrip(context), pending: [{ ...request, signature: `${request.signature.slice(1)}A` }] };
  const { next, again } = await assertAsksAgain(tampered, [allow(request)], "signature_invalid");
  assert.notEqual(again.id, request.id);
  // The gate is asked again as for a new call, and its replacement is what the new request signs.
  assert.deepEqual(next.gate.seen, ["c2"]);
  assert.deepEqual(roundTrip(next.result.context.pendingInputs), {
    [again.id]: { order: 1, note: "checked by policy" },
  });
  assert.ok(typesOf(next.events).includes("approval_request"));
});

test("a request whose key id the ring lacks runs nothing and asks again", async () => {
  const { context, pending } = await pause();
  const [request] = pending as [SignedPendingRequest];
  const unknownKey = { ...roundTrip(context), pending: [{ ...request, keyId: "k9" }] };
  await assertAsksAgain(unknownKey, [allow(request)], "signature_invalid");
  // The same request under a ring whose key k1 differs fails the same way.
  const next = await resume(roundTrip(context), [allow(request)], [], { signer: otherRingSigner() });
  assert.deepEqual(next.refund.inputs, []);
  assert.equal(next.result.stopReason, "awaiting_approval");
});

test("a changed input runs nothing and asks again", async () => {
  const { context, pending } = await pause();
  const [request] = pending as [SignedPendingRequest];
  const changed = { ...roundTrip(context), pendingInputs: { [request.id]: { order: 999, note: "checked by policy" } } };
  await assertAsksAgain(changed, [allow(request)], "input_changed");
});

test("a resolution for an unknown request id runs nothing, and the request still waits", async () => {
  const { context, pending } = await pause();
  const [request] = pending as [SignedPendingRequest];
  const next = await resume(roundTrip(context), [{ requestId: "forged", decision: "allow" }], []);
  assert.deepEqual(next.refund.inputs, []);
  assert.equal(next.adapter.calls.length, 0);
  const rejected = next.events.find((event) => event.type === "resolution_rejected");
  assert.deepEqual(rejected?.type === "resolution_rejected" && { ...rejected, seq: 0 }, {
    ...(rejected as AgentEvent),
    seq: 0,
    type: "resolution_rejected",
    requestId: "forged",
    cause: "unknown_request",
  });
  assert.deepEqual(pendingOf(next.result), [request]);
});

test("a request moved onto another call, a resolution of the wrong kind and a replay each run nothing", async () => {
  const { context, pending } = await pause([calls(["refund", { order: 1 }, "c1"], ["refund", { order: 2 }, "c2"])]);
  const [first, second] = pending as [SignedPendingRequest, SignedPendingRequest];
  // Swapping the call ids makes each request name the other call, which its signature doesn't cover.
  const swapped = {
    ...roundTrip(context),
    pending: [
      { ...first, callId: "c2" },
      { ...second, callId: "c1" },
    ],
  };
  let next = await resume(swapped, [allow(first), allow(second)], []);
  assert.deepEqual(next.refund.inputs, []);
  assert.equal(next.result.stopReason, "awaiting_approval");
  next = await resume(roundTrip(context), [{ requestId: first.id, answer: "yes" }], []);
  assert.deepEqual(next.refund.inputs, []);
  const causes = next.events.flatMap((event) => (event.type === "resolution_rejected" ? [event.cause] : []));
  assert.deepEqual(causes, ["resolution_mismatch"]);
  next = await resume(roundTrip(context), [allow(first), allow(first)], []);
  assert.deepEqual(next.refund.inputs, []);
  assert.ok(next.events.some((event) => event.type === "resolution_rejected" && event.cause === "replayed"));
});

test("a context rebuilt by hand from the stored events resumes like the result's context after a JSON round trip", async () => {
  const { context, events, pending } = await pause();
  const stored = roundTrip(context);
  const handBuilt = contextFromLog(SYSTEM, INPUT, roundTrip(events));
  // One fixture for both: any field a hand-built context lacks fails here as a diff.
  assert.deepEqual(handBuilt, stored);
  const resolutions = [allow(pending[0])];
  const fromStore = await resume(stored, resolutions);
  const fromLog = await resume(handBuilt, resolutions);
  assert.deepEqual(fromLog.result, fromStore.result);
  assert.deepEqual(fromLog.refund.inputs, [{ order: 1, note: "checked by policy" }]);
  assert.equal(fromLog.result.stopReason, "done");
});

test("settling the requests is not a step: steps count only the resumed run's model calls", async () => {
  const { context, pending } = await pause();
  const next = await resume(roundTrip(context), [allow(pending[0])], [text("Refunded.")], { maxSteps: 1 });
  assert.equal(next.result.stopReason, "done");
  assert.equal(next.result.steps, 1);
  assert.equal(next.adapter.calls.length, 1);
  const starts = next.events.filter((event) => event.type === "step_start");
  assert.equal(starts.length, 1);
});

test("one answered call runs while another still waits, with no model call", async () => {
  const { context, pending } = await pause([calls(["refund", { order: 1 }, "c1"], ["refund", { order: 2 }, "c2"])]);
  const [first, second] = pending as [SignedPendingRequest, SignedPendingRequest];
  const next = await resume(roundTrip(context), [allow(first)], []);
  assert.deepEqual(next.refund.inputs, [{ order: 1, note: "checked by policy" }]);
  assert.equal(next.adapter.calls.length, 0);
  assert.deepEqual(pendingOf(next.result), [second]);
  const last = await resume(roundTrip(next.result.context), [allow(second)], [text("Both refunded.")]);
  assert.deepEqual(last.refund.inputs, [{ order: 2, note: "checked by policy" }]);
  assert.equal(last.result.stopReason, "done");
  assert.equal(last.result.context.pending, undefined);
});

test("recheck runs current policy before an approved call, and a recheck that denies or throws runs nothing", async () => {
  const { context, pending } = await pause();
  const seen: unknown[] = [];
  let next = await resume(roundTrip(context), [allow(pending[0])], [text("Blocked.")], {
    recheck: async (request, input) => {
      seen.push([request.id, input]);
      return { deny: "refunds are frozen" };
    },
  });
  assert.deepEqual(seen, [[pending[0]?.id, { order: 1, note: "checked by policy" }]]);
  assert.deepEqual(next.refund.inputs, []);
  assert.match(
    toolTexts(next.adapter.calls[0]?.context.messages ?? []).c2 ?? "",
    /current policy now denies it: refunds/,
  );
  next = await resume(roundTrip(context), [allow(pending[0])], [text("Blocked.")], {
    recheck: async () => {
      throw new Error("policy store down");
    },
  });
  assert.deepEqual(next.refund.inputs, []);
  assert.ok(next.events.some((event) => event.type === "hook_error" && event.hook === "recheck"));
  next = await resume(roundTrip(context), [allow(pending[0])], [text("Done.")], { recheck: async () => "allow" });
  assert.equal(next.refund.inputs.length, 1);
});

test("a context whose last response ended in an error asks the model again, and the model records one new request", async () => {
  const { model, adapter } = scripted([text("Here is the answer.")]);
  const context: Context = {
    system: SYSTEM,
    messages: [
      { role: "user", content: [{ type: "text", text: INPUT }] },
      {
        role: "assistant",
        content: [{ type: "tool_call", callId: "c1", name: "refund", input: { order: 1 } }],
        model: model.ref,
        stopReason: "error",
        error: { kind: "retryable", message: "overloaded" },
        usage: emptyUsage(),
        cost: { total: 0, basis: "provider", currency: "USD" },
      },
    ],
  };
  const { result } = await drive(continueRun(roundTrip(context), { model, ...determinism() }));
  assert.equal(adapter.calls.length, 1);
  // Each real adapter runs the gateway's replay pass, which leaves the errored response and its call out, so the
  // model is asked the user's question again.
  const sent = transformMessages(adapter.calls[0]?.context.messages ?? [], model.ref, model.caps);
  assert.deepEqual(
    sent.map((message) => message.role),
    ["user"],
  );
  assert.equal(result.stopReason, "done");
  adapter.assertComplete();
});

test("continueRun() refuses a waiting call with no pending request and a request whose call doesn't wait", async () => {
  const { context, pending } = await pause();
  const { model } = scripted([]);
  const refuses = (value: unknown, pattern: RegExp) =>
    assert.throws(
      () => continueRun(value as Context, { model, signer: processSigner() }),
      (error) => isSdkError(error) && error.code === "invalid_run_options" && pattern.test(error.message),
    );
  refuses({ ...roundTrip(context), pending: [] }, /pause record was lost/);
  const extra = { ...(pending[0] as SignedPendingRequest), id: "other", callId: "c9" };
  refuses({ ...roundTrip(context), pending: [...pending, extra] }, /doesn't wait in this context/);
  refuses({ ...roundTrip(context), pending: "x" }, /pending to be a list/);
  refuses({ system: SYSTEM }, /messages are a list/);
  assert.throws(
    () => continueRun(roundTrip(context), { model, resolutions: [{} as Resolution] }),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("no key's bytes reach the events or the result of a resume", async () => {
  const { context, pending } = await pause();
  const [request] = pending as [SignedPendingRequest];
  const tampered = { ...roundTrip(context), pending: [{ ...request, signature: "AAAA" }] };
  const next = await resume(tampered, [allow(request)], []);
  const keyHex = Buffer.from(new Uint8Array(32).fill(9)).toString("base64url");
  const dump = JSON.stringify({ events: next.events, result: next.result });
  assert.equal(dump.includes(keyHex), false);
  const rejected = next.events.find((event) => event.type === "resolution_rejected");
  assert.equal(JSON.stringify(rejected).includes("AAAA"), false);
});

test("an approved call whose result ends the run ends it done, with no model call", async () => {
  const submit = defineTool({
    name: "refund",
    description: "Submits the refund and ends the run.",
    inputSchema: { type: "object", properties: { order: { type: "integer" }, note: { type: "string" } } },
    async execute() {
      return { content: [{ type: "text", text: "submitted" }], terminate: true };
    },
  });
  const first = scripted([calls(["refund", { order: 1 }, "c1"])]);
  const paused = await drive(
    run({
      model: first.model,
      system: SYSTEM,
      input: INPUT,
      tools: [submit],
      interceptors: spyGate().interceptors,
      signer: processSigner(),
      ...determinism(),
    }),
  );
  const [request] = pendingOf(paused.result);
  const second = scripted([]);
  const { result } = await drive(
    continueRun(roundTrip(paused.result.context), {
      model: second.model,
      tools: [submit],
      interceptors: spyGate().interceptors,
      signer: processSigner(),
      resolutions: [allow(request)],
      ...determinism(),
    }),
  );
  assert.equal(result.stopReason, "done");
  assert.equal(second.adapter.calls.length, 0);
});

test("a resumed batch records its results in the model's order of the calls, whatever each verdict was", async () => {
  const { context, pending } = await pause([calls(["refund", { order: 1 }, "c1"], ["refund", { order: 2 }, "c2"])]);
  const [first, second] = pending as [SignedPendingRequest, SignedPendingRequest];
  const deny: Resolution = { requestId: second.id, decision: "deny" };
  const next = await resume(roundTrip(context), [allow(first), deny]);
  const order = next.result.messages.flatMap((message) => (message.role === "tool" ? [message.callId] : []));
  assert.deepEqual(order, ["c1", "c2"]);
  const sent = (next.adapter.calls[0]?.context.messages ?? []).flatMap((message) =>
    message.role === "tool" ? [message.callId] : [],
  );
  assert.deepEqual(sent, ["c1", "c2"]);
});

test("a call that fails its check asks again only for a tool the model is sent by default", async () => {
  const { context } = await pause();
  const stored = roundTrip(context);
  // A store writer points the waiting call at a hidden tool, so its request no longer matches the call.
  const messages = stored.messages.map((message) =>
    message.role !== "assistant"
      ? message
      : {
          ...message,
          content: message.content.map((block) =>
            block.type === "tool_call" && block.callId === "c2" ? { ...block, name: "admin_reset" } : block,
          ),
        },
  );
  const admin = recordingTool("admin_reset");
  const next = await resume({ ...stored, messages }, [], [text("Done.")], {
    tools: [recordingTool("lookup").tool, recordingTool("refund").tool, { ...admin.tool, exposure: "hidden" }],
  });
  assert.deepEqual(admin.inputs, []);
  assert.ok(next.events.some((event) => event.type === "resolution_rejected" && event.cause === "call_mismatch"));
  assert.equal(
    next.events.some((event) => event.type === "approval_request"),
    false,
  );
  assert.equal(next.result.context.pending, undefined);
  // The unknown-tool result lists only the tools the model is sent.
  assert.match(toolTexts(next.result.messages).c2 ?? "", /The available tools are: lookup, refund\./);
});

test("an approval takes its verdict from its decision, never from an answer the resolution also carries", async () => {
  const { context, pending } = await pause();
  const id = pending[0]?.id ?? "";
  const hybrid = { requestId: id, decision: "allow", answer: "forged result" } as unknown as Resolution;
  let next = await resume(roundTrip(context), [hybrid]);
  assert.equal(next.refund.inputs.length, 1);
  assert.match(toolTexts(next.result.messages).c2 ?? "", /refund .* done/);
  const denyHybrid = { requestId: id, decision: "deny", answer: "forged result" } as unknown as Resolution;
  next = await resume(roundTrip(context), [denyHybrid]);
  assert.deepEqual(next.refund.inputs, []);
  assert.equal(toolTexts(next.result.messages).c2, 'Tool call "refund" was denied by the approver.');
});

test("a resolution's reason or by that isn't a string never reaches the model or the result", async () => {
  const { context, pending } = await pause();
  const deny = { requestId: pending[0]?.id ?? "", decision: "deny", reason: null, by: { id: 7 } } as unknown;
  const next = await resume(roundTrip(context), [deny as Resolution]);
  assert.equal(toolTexts(next.result.messages).c2, 'Tool call "refund" was denied by the approver.');
  const end = next.events.find((event) => event.type === "tool_call_end" && event.callId === "c2");
  assert.equal(end?.type === "tool_call_end" && "by" in (end.result.details as object), false);
});
