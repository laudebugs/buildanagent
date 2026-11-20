// Signed pauses in the loop: a gate's `ask` ends the run awaiting_approval with one signed request per paused call,
// in the result and in the context, and createPendingRequest() and the safety package's signPending() write the same
// bytes for the same fields.
import assert from "node:assert/strict";
import * as safety from "@buildanagent/agent-safety";
import { testSigner } from "@buildanagent/agent-safety/testing";
import {
  type AgentEvent,
  type ApprovalSigner,
  type AwaitingApprovalResult,
  composeInterceptors,
  continueRun,
  createPendingRequest,
  defineTool,
  hmacSigner,
  type Interceptors,
  isSafetyError,
  isSdkError,
  outputTool,
  type RunOptions,
  type RunResult,
  run,
  type SignedPendingRequest,
} from "@buildanagent/sdk";
import { otelObserver, type SpanLike } from "@buildanagent/sdk/otel";
import type { ScriptStep } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { z } from "zod";
import { pendingPayload } from "../src/vendor/agent-safety/pending.js";
import { determinism, drive, START, scripted, text, typesOf } from "./run-helpers.js";

const SIGNER = hmacSigner({ keys: { k1: new Uint8Array(32).fill(7) }, current: "k1" });
const ASK_REFUNDS: Interceptors = {
  beforeToolCall: async (e) =>
    e.tool === "refund"
      ? { decision: "ask", reason: "refunds need a manager", policyVersion: "policy-3" }
      : { decision: "allow" },
};

function recordingTool(name: string) {
  const inputs: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: { order: { type: "integer" } }, required: ["order"] },
    async execute(input) {
      inputs.push(input);
      return { content: [{ type: "text", text: `${name} ${JSON.stringify(input)} done` }] };
    },
  });
  return { tool, inputs };
}

function calls(...entries: [string, unknown, string][]): ScriptStep {
  return { content: entries.map(([name, input, callId]) => ({ type: "tool_call" as const, callId, name, input })) };
}

async function pausedRun(steps: ScriptStep[], options: Partial<RunOptions> = {}) {
  const refund = recordingTool("refund");
  const lookup = recordingTool("lookup");
  const { adapter, model } = scripted(steps);
  const started = run({
    model,
    system: "You handle refunds.",
    input: "Refund order 1.",
    tools: [refund.tool, lookup.tool],
    interceptors: ASK_REFUNDS,
    signer: SIGNER,
    ...determinism(),
    ...options,
  });
  const driven = await drive(started);
  return { ...driven, adapter, refund, lookup };
}

function awaiting(result: RunResult): AwaitingApprovalResult {
  assert.equal(result.stopReason, "awaiting_approval");
  return result as AwaitingApprovalResult;
}

test("a gate that asks ends the run awaiting_approval with one signed request, in the result and the context", async () => {
  const { result, refund, adapter } = await pausedRun([calls(["refund", { order: 1 }, "c1"])]);
  const paused = awaiting(result);
  assert.equal(refund.inputs.length, 0);
  assert.equal(paused.pending.length, 1);
  assert.deepEqual(paused.context.pending, paused.pending);
  const [request] = paused.pending as [SignedPendingRequest];
  assert.deepEqual(
    { ...request, signature: "-" },
    {
      id: "run-2",
      kind: "approval",
      callId: "c1",
      tool: "refund",
      inputHash: await safety.canonicalInputHash({ order: 1 }),
      policyVersion: "policy-3",
      reason: "refunds need a manager",
      keyId: "k1",
      signature: "-",
      createdAt: request.createdAt,
    },
  );
  assert.equal(await SIGNER.verify(request.keyId, pendingPayload(request), request.signature), true);
  // The paused call has no result, so the transcript ends with the model's call and a resume can still answer it.
  assert.equal(paused.context.messages.at(-1)?.role, "assistant");
  assert.equal(paused.steps, 1);
  adapter.assertComplete();
});

test("a pause emits approval_request after its tool_call_start, and its call gets no tool_call_end", async () => {
  const { events, result } = await pausedRun([calls(["refund", { order: 1 }, "c1"])]);
  const types = typesOf(events);
  assert.deepEqual(types.slice(types.indexOf("tool_call_start")), [
    "tool_call_start",
    "approval_request",
    "step_end",
    "agent_settled",
    "run_end",
  ]);
  const event = events.find((e) => e.type === "approval_request");
  assert.deepEqual(event?.type === "approval_request" && event.request, awaiting(result).pending[0]);
});

test("the step's other calls run or are denied as usual, and every paused call gets its own request", async () => {
  const { result, refund, lookup } = await pausedRun([
    calls(["lookup", { order: 1 }, "c1"], ["refund", { order: 1 }, "c2"], ["refund", { order: 2 }, "c3"]),
  ]);
  const paused = awaiting(result);
  assert.deepEqual(lookup.inputs, [{ order: 1 }]);
  assert.deepEqual(refund.inputs, []);
  assert.deepEqual(
    paused.pending.map((request) => request.callId),
    ["c2", "c3"],
  );
  assert.notEqual(paused.pending[0]?.id, paused.pending[1]?.id);
  const toolResults = paused.context.messages.filter((message) => message.role === "tool");
  assert.deepEqual(
    toolResults.map((message) => message.role === "tool" && message.callId),
    ["c1"],
  );
});

test("a pause wins over an output tool that answered in the same step", async () => {
  const answer = outputTool({ name: "answer", schema: z.object({ total: z.number() }) });
  const { result } = await pausedRun([calls(["refund", { order: 1 }, "c1"], ["answer", { total: 3 }, "c2"])], {
    output: answer as never,
  });
  assert.equal(awaiting(result).pending.length, 1);
});

test("the loop, createPendingRequest() and the safety package's signPending() sign byte-identical payloads", async () => {
  const { result } = await pausedRun([calls(["refund", { order: 1 }, "c1"])]);
  const [fromLoop] = awaiting(result).pending as [SignedPendingRequest];
  const fields = {
    kind: "approval" as const,
    callId: "c1",
    tool: "refund",
    input: { order: 1 },
    policyVersion: "policy-3",
    reason: "refunds need a manager",
  };
  const fixed = { generateId: () => fromLoop.id, now: () => new Date(fromLoop.createdAt) };
  const fromSdk = await createPendingRequest(fields, SIGNER, fixed);
  // The package's own copy, with a signer of the package's own copy over the same key.
  const packageSigner = safety.hmacSigner({ keys: { k1: new Uint8Array(32).fill(7) }, current: "k1" });
  const fromPackage = await safety.signPending(fields, packageSigner, fixed);
  assert.deepEqual(fromSdk, fromLoop);
  assert.deepEqual(fromPackage, fromLoop);
  assert.deepEqual(pendingPayload(fromSdk), pendingPayload(fromLoop));
  assert.deepEqual(safety.pendingPayload(fromPackage), pendingPayload(fromLoop));
  assert.equal(await SIGNER.verify(fromSdk.keyId, pendingPayload(fromSdk), fromSdk.signature), true);
  assert.equal(await packageSigner.verify(fromLoop.keyId, safety.pendingPayload(fromLoop), fromLoop.signature), true);
});

test("a pause signed with the safety package's test signer is the same record createPendingRequest() writes", async () => {
  const { result } = await pausedRun([calls(["refund", { order: 1 }, "c1"])], { signer: testSigner() });
  const [fromLoop] = awaiting(result).pending as [SignedPendingRequest];
  assert.equal(fromLoop.keyId, "test-fixed-key");
  const fromSdk = await createPendingRequest(
    {
      kind: "approval",
      callId: "c1",
      tool: "refund",
      input: { order: 1 },
      policyVersion: "policy-3",
      reason: "refunds need a manager",
    },
    testSigner(),
    { generateId: () => fromLoop.id, now: () => new Date(fromLoop.createdAt) },
  );
  assert.deepEqual(fromSdk, fromLoop);
});

test("createPendingRequest() signs the input's canonical hash, so key order does not change the signature", async () => {
  const fixed = { generateId: () => "req-1", now: () => new Date(START) };
  const one = await createPendingRequest(
    { kind: "approval", callId: "c1", tool: "t", input: { a: 1, b: 2 } },
    SIGNER,
    fixed,
  );
  const two = await createPendingRequest(
    { kind: "approval", callId: "c1", tool: "t", input: { b: 2, a: 1 } },
    SIGNER,
    fixed,
  );
  assert.equal(one.signature, two.signature);
  assert.equal(one.createdAt, START);
  assert.equal("policyVersion" in one, false);
});

test("createPendingRequest() refuses a kind other than approval, a non-signer and a blank field", async () => {
  const fields = { kind: "approval" as const, callId: "c1", tool: "t", input: {} };
  await assert.rejects(
    createPendingRequest({ ...fields, kind: "clarification" } as never, SIGNER),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
  await assert.rejects(
    createPendingRequest(fields, {} as ApprovalSigner),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
  await assert.rejects(
    createPendingRequest({ ...fields, callId: "" }, SIGNER),
    (error) => isSafetyError(error) && error.code === "invalid_pending",
  );
});

test("a pause that can't be signed blocks its call, and no report carries the signer's own message", async () => {
  const broken: ApprovalSigner = {
    keyId: "broken",
    sign: async () => {
      throw new Error("leaked key 0xDEADBEEF");
    },
    verify: async () => false,
  };
  const { result, events, refund, adapter } = await pausedRun(
    [calls(["refund", { order: 1 }, "c1"]), text("I couldn't refund it.")],
    { signer: broken },
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(refund.inputs, []);
  assert.equal(
    events.some((event) => event.type === "approval_request"),
    false,
  );
  const failure = events.find((event) => event.type === "hook_error");
  assert.deepEqual(failure?.type === "hook_error" && [failure.hook, failure.error], [
    "signer",
    "the approval request could not be signed (signer_failed)",
  ]);
  assert.equal(JSON.stringify({ events, result }).includes("DEADBEEF"), false);
  const blocked = result.messages.find((message) => message.role === "tool");
  assert.equal(blocked?.role === "tool" && blocked.isError, true);
  adapter.assertComplete();
});

test("a generator that repeats one id still pauses every call, each under its own request id", async () => {
  // A host may tie the run to its session with a fixed id; that once made only the run id, so it must not block pauses.
  const started = run({
    model: scripted([calls(["refund", { order: 1 }, "c1"], ["refund", { order: 2 }, "c2"])]).model,
    system: "You handle refunds.",
    input: "Refund orders 1 and 2.",
    tools: [recordingTool("refund").tool],
    interceptors: ASK_REFUNDS,
    signer: SIGNER,
    clock: determinism().clock,
    idGenerator: () => "session-1",
  });
  const { result, events } = await drive(started);
  const paused = awaiting(result);
  assert.equal(started.id, "session-1");
  assert.deepEqual(
    paused.pending.map((request) => request.callId),
    ["c1", "c2"],
  );
  const ids = paused.pending.map((request) => request.id);
  assert.equal(new Set([...ids, "session-1"]).size, 3);
  assert.equal(
    events.some((event) => event.type === "hook_error"),
    false,
  );
});

test("a request id that names an Object.prototype member still maps to its own input", async () => {
  // A generator is the host's code, so an id such as "__proto__" must not rewrite the record's prototype.
  const ids = ["run-1", "__proto__"];
  const { result } = await drive(
    run({
      model: scripted([calls(["refund", { order: 7 }, "c1"])]).model,
      system: "You handle refunds.",
      input: "Refund order 7.",
      tools: [recordingTool("refund").tool],
      interceptors: ASK_REFUNDS,
      signer: SIGNER,
      clock: determinism().clock,
      idGenerator: () => ids.shift() ?? "later",
    }),
  );
  const paused = awaiting(result);
  assert.equal(paused.pending[0]?.id, "__proto__");
  const inputs = paused.context.pendingInputs ?? {};
  assert.equal(Object.hasOwn(inputs, "__proto__"), true);
  assert.deepEqual(Object.getOwnPropertyDescriptor(inputs, "__proto__")?.value, { order: 7 });
});

test("a pause signs the coerced input the call would run with, and the context and event hold that input", async () => {
  const { result, events } = await pausedRun([calls(["refund", { order: "5" }, "c1"])]);
  const paused = awaiting(result);
  const [request] = paused.pending as [SignedPendingRequest];
  assert.equal(request.inputHash, await safety.canonicalInputHash({ order: 5 }));
  assert.deepEqual(paused.context.pendingInputs, { [request.id]: { order: 5 } });
  const event = events.find((e) => e.type === "approval_request");
  assert.deepEqual(event?.type === "approval_request" && event.input, { order: 5 });
  const check = await safety.verifyResolution(
    request,
    { requestId: request.id, decision: "allow" },
    { signer: SIGNER, call: { callId: "c1", tool: "refund", input: paused.context.pendingInputs?.[request.id] } },
  );
  assert.equal(check.ok, true);
});

test("composed gates pause over an earlier gate's replacement, the input the asking gate saw", async () => {
  const seen: unknown[] = [];
  const interceptors = composeInterceptors(
    { beforeToolCall: () => ({ decision: "allow", input: { order: 99 } }) },
    {
      beforeToolCall: (e) => {
        seen.push(e.input);
        return { decision: "ask", reason: "refunds need a manager" };
      },
    },
  );
  const { result, refund } = await pausedRun([calls(["refund", { order: 1 }, "c1"])], { interceptors });
  const paused = awaiting(result);
  const [request] = paused.pending as [SignedPendingRequest];
  assert.deepEqual(seen, [{ order: 99 }]);
  assert.equal(request.inputHash, await safety.canonicalInputHash({ order: 99 }));
  assert.deepEqual(paused.context.pendingInputs?.[request.id], { order: 99 });
  assert.deepEqual(refund.inputs, []);
});

test("an ask whose own input fails the tool's schema is a programmer error, not a pause", async () => {
  await assert.rejects(
    pausedRun([calls(["refund", { order: 1 }, "c1"])], {
      interceptors: { beforeToolCall: () => ({ decision: "ask", input: { order: "x" } }) },
    }),
    (error) => isSdkError(error) && error.code === "invalid_hook_result",
  );
});

test("an ask with a blank reason pauses without one, and a bad policyVersion is the gate's error", async () => {
  const { result } = await pausedRun([calls(["refund", { order: 1 }, "c1"])], {
    interceptors: { beforeToolCall: () => ({ decision: "ask", reason: "" }) },
  });
  assert.equal("reason" in ((awaiting(result).pending as [SignedPendingRequest])[0] ?? {}), false);
  await assert.rejects(
    pausedRun([calls(["refund", { order: 1 }, "c1"])], {
      interceptors: { beforeToolCall: () => ({ decision: "ask", policyVersion: "" }) },
    }),
    (error) => isSdkError(error) && error.code === "invalid_hook_result",
  );
});

test("a step that fails while its calls are checked reports no pause for a call it then gives a result", async () => {
  const broken = defineTool({
    name: "broken",
    description: "A tool whose resource key throws.",
    inputSchema: { type: "object", properties: {} },
    resourceKey: () => {
      throw new Error("no key");
    },
    async execute() {
      return { content: [{ type: "text", text: "never" }] };
    },
  });
  const refund = recordingTool("refund");
  const started = run({
    model: scripted([calls(["refund", { order: 1 }, "c1"], ["broken", {}, "c2"])]).model,
    system: "You handle refunds.",
    input: "Refund order 1.",
    tools: [refund.tool, broken],
    interceptors: ASK_REFUNDS,
    signer: SIGNER,
    ...determinism(),
  });
  const events: AgentEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of started) events.push(event);
  }, /resourceKey threw/);
  assert.ok(events.some((event) => event.type === "tool_call_end" && event.callId === "c1"));
  assert.equal(
    events.some((event) => event.type === "approval_request"),
    false,
  );
});

test("a forged safety error's code never reaches a report", async () => {
  const forged: ApprovalSigner = {
    keyId: "forged",
    sign: async () => {
      throw Object.assign(new Error("x"), {
        [Symbol.for("buildanagent.agent-safety.SafetyError")]: true,
        code: "leaked key 0xDEADBEEF",
      });
    },
    verify: async () => false,
  };
  const { result, events } = await pausedRun([calls(["refund", { order: 1 }, "c1"]), text("I couldn't.")], {
    signer: forged,
  });
  assert.equal(JSON.stringify({ events, result }).includes("DEADBEEF"), false);
  const failure = events.find((event) => event.type === "hook_error");
  assert.match(failure?.type === "hook_error" ? failure.error : "", /\(signer_failed\)/);
});

test("continueRun() refuses a paused context stored without its pending requests", async () => {
  const { result } = await pausedRun([calls(["refund", { order: 1 }, "c1"])]);
  const { model } = scripted([]);
  const { pending: _pending, pendingInputs: _inputs, ...lost } = result.context;
  assert.throws(
    () => continueRun(lost, { model, signer: SIGNER }),
    (error) => isSdkError(error) && error.code === "invalid_run_options" && /pause record was lost/.test(error.message),
  );
});

test("the OTel observer ends a paused call's span without marking it failed", async () => {
  const spans: { name: string; status?: unknown; ended: boolean }[] = [];
  const tracer = {
    startSpan(name: string): SpanLike {
      const record: { name: string; status?: unknown; ended: boolean } = { name, ended: false };
      spans.push(record);
      return {
        setAttribute: () => undefined,
        setStatus: (status) => {
          record.status = status;
        },
        end: () => {
          record.ended = true;
        },
      };
    },
  };
  await pausedRun([calls(["refund", { order: 1 }, "c1"])], {
    observers: [otelObserver({ tracer, childContext: () => undefined })],
  });
  const tool = spans.find((span) => span.name === "execute_tool refund");
  assert.deepEqual(tool, { name: "execute_tool refund", ended: true });
});
