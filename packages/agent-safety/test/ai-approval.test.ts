import assert from "node:assert/strict";
import type { LanguageModelV4CallOptions, LanguageModelV4Content, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import {
  hmacSigner,
  isSafetyError,
  memoryPendingStore,
  type PendingStore,
  type Recheck,
  type SignedPendingRequest,
} from "@buildanagent/agent-safety";
import { type ApprovalRejection, settleDeniedApprovals, signedToolApproval } from "@buildanagent/agent-safety/ai";
import { testSigner } from "@buildanagent/agent-safety/testing";
import {
  generateText,
  InvalidToolApprovalSignatureError,
  isStepCount,
  jsonSchema,
  type ModelMessage,
  streamText,
  type ToolApprovalConfiguration,
  tool,
  type UIMessage,
  validateUIMessages,
} from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { test } from "vitest";
import { z } from "zod";

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const REFUND = { order: 4417, amount: 250 };
const PROMPT: ModelMessage[] = [{ role: "user", content: "Refund order 4417 ($250)." }];

type Turn = { call: string; input?: unknown } | string;

/** A model that plays `turns` in order, for generate and stream calls alike, and records every request. */
function scripted(turns: readonly Turn[]) {
  const requests: LanguageModelV4CallOptions[] = [];
  const next = (options: LanguageModelV4CallOptions) => {
    requests.push(options);
    const turn = turns[requests.length - 1];
    if (turn === undefined) throw new Error(`the script has no turn ${requests.length}`);
    const content: LanguageModelV4Content[] =
      typeof turn === "string"
        ? [{ type: "text", text: turn }]
        : [
            {
              type: "tool-call",
              toolCallId: turn.call,
              toolName: "refund",
              input: JSON.stringify(turn.input ?? REFUND),
            },
          ];
    const finishReason = { unified: typeof turn === "string" ? "stop" : "tool-calls", raw: undefined } as const;
    return { content, finishReason };
  };
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => ({ ...next(options), usage: USAGE, warnings: [] }),
    doStream: async (options) => {
      const { content, finishReason } = next(options);
      const chunks: LanguageModelV4StreamPart[] = content.flatMap((part): LanguageModelV4StreamPart[] =>
        part.type === "text"
          ? [
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: part.text },
              { type: "text-end", id: "t1" },
            ]
          : part.type === "tool-call"
            ? [part]
            : [],
      );
      chunks.push({ type: "finish", finishReason, usage: USAGE });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  return { model, requests };
}

/** A refund agent: an `execute` spy, a log of what ran in which order, and the adapter over a mutable policy. */
function refundAgent(overrides: { store?: PendingStore; recheck?: Recheck; needsApproval?: boolean } = {}) {
  const executed: unknown[] = [];
  const order: string[] = [];
  const rejections: ApprovalRejection[] = [];
  const state = { policyVersion: "v1", deny: false };
  const store = overrides.store ?? memoryPendingStore();
  const refund = tool({
    description: "Refund an order",
    inputSchema: jsonSchema<{ order: number; amount: number }>({
      type: "object",
      properties: { order: { type: "number" }, amount: { type: "number" } },
      required: ["order", "amount"],
    }),
    ...(overrides.needsApproval ? { needsApproval: true } : {}),
    execute: async (input) => {
      order.push("execute");
      executed.push(input);
      return { refunded: input.amount };
    },
  });
  const tools = { refund };
  const policy: ToolApprovalConfiguration<typeof tools, unknown> = overrides.needsApproval
    ? {}
    : {
        refund: () => {
          order.push("policy");
          return state.deny ? { type: "denied", reason: "refunds are frozen" } : "user-approval";
        },
      };
  const recheck: Recheck =
    overrides.recheck ??
    (async (pending) => {
      order.push("recheck");
      return pending.policyVersion === state.policyVersion ? "allow" : { deny: "the refund policy changed" };
    });
  const toolApproval = signedToolApproval({
    signer: testSigner(),
    store,
    policy,
    recheck,
    policyVersion: () => state.policyVersion,
    onRejected: (rejection) => rejections.push(rejection),
    generateId: () => "req_1",
    now: () => new Date("2026-11-19T12:00:00.000Z"),
  });
  return { tools, toolApproval, store, state, executed, order, rejections };
}

type Agent = ReturnType<typeof refundAgent>;

/** The messages that approve every approval request in `response`, as a client's approval response would. */
function approve(response: readonly ModelMessage[], approved = true): ModelMessage[] {
  const ids = response.flatMap((message) =>
    message.role === "assistant" && typeof message.content !== "string"
      ? message.content.flatMap((part) => (part.type === "tool-approval-request" ? [part.approvalId] : []))
      : [],
  );
  assert.ok(ids.length > 0, "the response holds an approval request");
  const content = ids.map((approvalId) => ({ type: "tool-approval-response" as const, approvalId, approved }));
  return [...response, { role: "tool", content }];
}

async function pause(agent: Agent, model: MockLanguageModelV4, prompt: ModelMessage[] = PROMPT) {
  const result = await generateText({
    model,
    messages: prompt,
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  });
  assert.equal(agent.executed.length, 0, "a call that waits for approval has not run");
  return [...prompt, ...result.response.messages];
}

async function resume(agent: Agent, model: MockLanguageModelV4, history: ModelMessage[]) {
  return generateText({
    model,
    messages: approve(history),
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  });
}

/** The tool results the model received in request `index`. */
function toolResults(requests: readonly LanguageModelV4CallOptions[], index: number) {
  return (requests[index]?.prompt ?? []).flatMap((message) =>
    message.role === "tool" ? message.content.filter((part) => part.type === "tool-result") : [],
  );
}

/** The `not_applied` outcome the model read for a denied call, parsed from the denial's reason. */
function deniedOutcome(requests: readonly LanguageModelV4CallOptions[], index: number) {
  const [result] = toolResults(requests, index);
  assert.ok(result?.type === "tool-result" && result.output.type === "execution-denied", "the call was denied");
  const reason = result.output.reason;
  assert.ok(reason !== undefined);
  return JSON.parse(reason) as { kind: string; reason: string; message: string; retry: string; next: string };
}

async function storedRequest(store: PendingStore, callId = "call_1"): Promise<SignedPendingRequest> {
  const request = await store.take(callId);
  assert.ok(request !== undefined, "the pause stored a signed request");
  return request;
}

test("a pause stores a signed request, and an approval runs the call once after toolApproval runs again", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, "Refunded."]);
  const history = await pause(agent, model);
  const request = await storedRequest(agent.store);
  assert.equal(request.tool, "refund");
  assert.equal(request.policyVersion, "v1");
  await agent.store.put(request);
  const result = await resume(agent, model, history);
  assert.deepEqual(agent.executed, [REFUND]);
  // `ai` 7.0.173 calls toolApproval again before execute: the pin this adapter rests on.
  assert.deepEqual(agent.order, ["policy", "policy", "recheck", "execute"]);
  assert.equal(result.text, "Refunded.");
  assert.equal(toolResults(requests, 1)[0]?.output.type, "json");
  assert.deepEqual(agent.rejections, []);
});

const TAMPER: Record<string, (request: SignedPendingRequest) => SignedPendingRequest> = {
  "a tampered signature": (request) => ({
    ...request,
    signature: `${request.signature[0] === "A" ? "B" : "A"}${request.signature.slice(1)}`,
  }),
  "an unknown key id": (request) => ({ ...request, keyId: "rotated-out" }),
  "a changed signed field": (request) => ({ ...request, policyVersion: "v2" }),
};

for (const [what, tamper] of Object.entries(TAMPER)) {
  test(`an approval over ${what} runs nothing and the model reads a not_applied denial`, async () => {
    const agent = refundAgent();
    const { model, requests } = scripted([{ call: "call_1" }, "It did not run."]);
    const history = await pause(agent, model);
    await agent.store.put(tamper(await storedRequest(agent.store)));
    await resume(agent, model, history);
    assert.equal(agent.executed.length, 0, "execute never ran");
    const outcome = deniedOutcome(requests, 1);
    assert.equal(outcome.kind, "not_applied");
    assert.equal(outcome.reason, "APPROVAL_NOT_VERIFIED");
    assert.match(outcome.message, /did not take effect/);
    assert.deepEqual(
      agent.rejections.map((r) => r.cause),
      ["signature_invalid"],
    );
  });
}

test("an approval whose call input changed after the pause runs nothing", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, "It did not run."]);
  const history = await pause(agent, model);
  const changed = history.map((message) =>
    message.role === "assistant" && typeof message.content !== "string"
      ? {
          ...message,
          content: message.content.map((part) =>
            part.type === "tool-call" ? { ...part, input: { ...REFUND, amount: 25000 } } : part,
          ),
        }
      : message,
  );
  await resume(agent, model, changed);
  assert.equal(agent.executed.length, 0);
  assert.equal(deniedOutcome(requests, 1).reason, "APPROVAL_NOT_VERIFIED");
  assert.deepEqual(
    agent.rejections.map((r) => r.cause),
    ["input_changed"],
  );
});

test("an approval for a request the store doesn't hold runs nothing, and a replay of a used approval is denied", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, "Refunded.", "It did not run."]);
  const history = await pause(agent, model);
  await resume(agent, model, history);
  assert.equal(agent.executed.length, 1);
  // The replay drops the call's result so `ai` collects the approval again; the request was used up.
  await resume(agent, model, history);
  assert.equal(agent.executed.length, 1, "the replay ran nothing");
  assert.equal(deniedOutcome(requests, 2).reason, "APPROVAL_NOT_VERIFIED");
  assert.deepEqual(
    agent.rejections.map((r) => r.cause),
    ["unknown_request"],
  );
});

test("a policy change between pause and resume makes recheck deny, and the model receives a not_applied outcome", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, "Policy blocked it."]);
  const history = await pause(agent, model);
  agent.state.policyVersion = "v2";
  await resume(agent, model, history);
  assert.equal(agent.executed.length, 0, "execute never ran");
  const outcome = deniedOutcome(requests, 1);
  assert.equal(outcome.kind, "not_applied");
  assert.equal(outcome.reason, "POLICY_DENIED");
  assert.equal(outcome.retry, "never");
  assert.match(outcome.next, /the refund policy changed/);
  assert.deepEqual(
    agent.rejections.map((r) => r.cause),
    ["policy_denied"],
  );
});

test("a policy that now denies the call denies it on resume without asking recheck", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, "Frozen."]);
  const history = await pause(agent, model);
  agent.state.deny = true;
  await resume(agent, model, history);
  assert.equal(agent.executed.length, 0);
  assert.deepEqual(agent.order, ["policy", "policy"]);
  assert.match(deniedOutcome(requests, 1).next, /refunds are frozen/);
});

test("a recheck that throws or answers anything but allow denies the call", async () => {
  for (const recheck of [
    async () => {
      throw new Error("policy service down");
    },
    async () => "yes" as unknown as "allow",
  ]) {
    const agent = refundAgent({ recheck });
    const { model, requests } = scripted([{ call: "call_1" }, "It did not run."]);
    await resume(agent, model, await pause(agent, model));
    assert.equal(agent.executed.length, 0);
    assert.equal(deniedOutcome(requests, 1).kind, "not_applied");
  }
});

test("the model can answer a denial with a fresh request, which then runs once approved", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, { call: "call_2" }, "Refunded."]);
  const history = await pause(agent, model);
  await agent.store.take("call_1");
  // The denial reaches the model, which calls the tool again; the new call pauses with a newly signed request.
  const denied = await generateText({
    model,
    messages: approve(history),
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  });
  assert.equal(agent.executed.length, 0);
  assert.equal(deniedOutcome(requests, 1).reason, "APPROVAL_NOT_VERIFIED");
  const fresh = await storedRequest(agent.store, "call_2");
  await agent.store.put(fresh);
  await resume(agent, model, [...approve(history), ...denied.response.messages]);
  assert.deepEqual(agent.executed, [REFUND]);
});

test("a tool that keeps the deprecated needsApproval gets the same signing and fails closed the same way", async () => {
  const agent = refundAgent({ needsApproval: true });
  const { model, requests } = scripted([{ call: "call_1" }, "It did not run."]);
  const history = await pause(agent, model);
  const request = await storedRequest(agent.store);
  await agent.store.put({ ...request, signature: request.signature.split("").reverse().join("") });
  await resume(agent, model, history);
  assert.equal(agent.executed.length, 0);
  assert.equal(deniedOutcome(requests, 1).reason, "APPROVAL_NOT_VERIFIED");
});

test("streamText runs the same check on resume", async () => {
  const agent = refundAgent();
  const { model, requests } = scripted([{ call: "call_1" }, "Refunded.", { call: "call_9" }, "It did not run."]);
  const paused = streamText({
    model,
    messages: PROMPT,
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  });
  const history = [...PROMPT, ...(await paused.response).messages];
  const approved = streamText({
    model,
    messages: approve(history),
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  });
  await approved.consumeStream();
  assert.deepEqual(agent.executed, [REFUND]);
  const second = streamText({
    model,
    messages: PROMPT,
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  });
  const secondHistory = [...PROMPT, ...(await second.response).messages];
  agent.state.policyVersion = "v2";
  await streamText({
    model,
    messages: approve(secondHistory),
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    stopWhen: isStepCount(3),
  }).consumeStream();
  assert.equal(agent.executed.length, 1, "the rechecked call never ran");
  assert.equal(deniedOutcome(requests, 3).reason, "POLICY_DENIED");
});

test("the AI SDK's own approval secret stays a second check, and throws on a changed input", async () => {
  const agent = refundAgent();
  const secret = "the AI SDK's own approval secret, kept beside the adapter";
  const { model } = scripted([{ call: "call_1" }, "Refunded."]);
  const result = await generateText({
    model,
    messages: PROMPT,
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    experimental_toolApprovalSecret: secret,
  });
  const history = [...PROMPT, ...result.response.messages];
  const changed = history.map((message) =>
    message.role === "assistant" && typeof message.content !== "string"
      ? {
          ...message,
          content: message.content.map((part) => (part.type === "tool-call" ? { ...part, input: { order: 1 } } : part)),
        }
      : message,
  );
  await assert.rejects(
    generateText({
      model,
      messages: approve(changed),
      tools: agent.tools,
      toolApproval: agent.toolApproval,
      experimental_toolApprovalSecret: secret,
    }),
    (error) => InvalidToolApprovalSignatureError.isInstance(error),
  );
  assert.equal(agent.executed.length, 0);
  await generateText({
    model,
    messages: approve(history),
    tools: agent.tools,
    toolApproval: agent.toolApproval,
    experimental_toolApprovalSecret: secret,
  });
  assert.deepEqual(agent.executed, [REFUND]);
});

test("a pause signed under a rotated-out key is denied once that key leaves the ring", async () => {
  const store = memoryPendingStore();
  const keyA = new Uint8Array(32).fill(1);
  const keyB = new Uint8Array(32).fill(2);
  const executed: unknown[] = [];
  const refund = tool({
    inputSchema: jsonSchema<{ order: number; amount: number }>({ type: "object" }),
    execute: async (input) => executed.push(input),
  });
  const withRing = (keys: Record<string, Uint8Array>, current: string) =>
    signedToolApproval({
      signer: hmacSigner({ keys, current }),
      store,
      policy: { refund: "user-approval" },
      recheck: async () => "allow",
    });
  const { model } = scripted([{ call: "call_1" }, "Refunded.", { call: "call_2" }, "It did not run."]);
  const tools = { refund };
  const first = await generateText({ model, messages: PROMPT, tools, toolApproval: withRing({ a: keyA }, "a") });
  const rotated = withRing({ a: keyA, b: keyB }, "b");
  await generateText({
    model,
    messages: approve([...PROMPT, ...first.response.messages]),
    tools,
    toolApproval: rotated,
  });
  assert.equal(executed.length, 1, "a pause under key a resumes while a is in the ring");
  const second = await generateText({ model, messages: PROMPT, tools, toolApproval: withRing({ a: keyA }, "a") });
  const pruned = withRing({ b: keyB }, "b");
  await generateText({
    model,
    messages: approve([...PROMPT, ...second.response.messages]),
    tools,
    toolApproval: pruned,
  });
  assert.equal(executed.length, 1, "once a leaves the ring, its pause fails closed");
});

test("an onRejected that throws still runs nothing: the error propagates instead of an approval", async () => {
  const agent = refundAgent();
  const { model } = scripted([{ call: "call_1" }, "unused"]);
  const history = await pause(agent, model);
  await agent.store.take("call_1");
  const toolApproval = signedToolApproval({
    signer: testSigner(),
    store: agent.store,
    policy: { refund: "user-approval" },
    recheck: async () => "allow",
    onRejected: () => {
      throw new Error("audit log unavailable");
    },
  });
  await assert.rejects(
    generateText({ model, messages: approve(history), tools: agent.tools, toolApproval }),
    /audit log unavailable/,
  );
  assert.equal(agent.executed.length, 0);
});

test("an onRejected that throws is called once, with the real cause, and its error propagates", async () => {
  const agent = refundAgent();
  const { model } = scripted([{ call: "call_1" }, "unused"]);
  const history = await pause(agent, model);
  const request = await storedRequest(agent.store);
  await agent.store.put({ ...request, signature: request.signature.split("").reverse().join("") });
  const seen: ApprovalRejection[] = [];
  const toolApproval = signedToolApproval({
    signer: testSigner(),
    store: agent.store,
    policy: { refund: "user-approval" },
    recheck: async () => "allow",
    onRejected: (rejection) => {
      seen.push(rejection);
      if (seen.length === 1) throw new Error("audit log failed once");
    },
  });
  await assert.rejects(
    generateText({ model, messages: approve(history), tools: agent.tools, toolApproval }),
    /audit log failed once/,
  );
  assert.deepEqual(
    seen.map((r) => r.cause),
    ["signature_invalid"],
    "a throwing hook is not called again as an error",
  );
  assert.equal(agent.executed.length, 0);
});

/** A refund tool whose context schema gives `limit` a default, and a policy that asks above the limit. */
function limitAgent() {
  const executed: unknown[] = [];
  const refund = tool({
    inputSchema: jsonSchema<{ order: number; amount: number }>({ type: "object" }),
    contextSchema: z.object({ limit: z.number().default(100) }),
    execute: async (input) => executed.push(input),
  });
  const tools = { refund };
  const store = memoryPendingStore();
  const toolApproval = signedToolApproval<typeof tools>({
    signer: testSigner(),
    store,
    policy: { refund: (input, { toolContext }) => (input.amount > toolContext.limit ? "user-approval" : "approved") },
    recheck: async () => "allow",
  });
  return { tools, store, toolApproval, executed };
}

test("a per-tool policy sees the tool context parsed by its contextSchema, defaults included", async () => {
  const agent = limitAgent();
  const { model } = scripted([{ call: "call_1" }, "unused"]);
  await generateText({
    model,
    messages: PROMPT,
    tools: agent.tools,
    toolsContext: { refund: {} } as never,
    toolApproval: agent.toolApproval,
  });
  assert.equal(agent.executed.length, 0, "$250 is over the default limit of 100, so the call waits");
  assert.ok((await agent.store.take("call_1")) !== undefined, "the pause was signed");
});

test("a tool context that fails its contextSchema fails the approval step, as it would without the adapter", async () => {
  const agent = limitAgent();
  const { model } = scripted([{ call: "call_1" }, "unused"]);
  await assert.rejects(
    generateText({
      model,
      messages: PROMPT,
      tools: agent.tools,
      toolsContext: { refund: { limit: "lots" } } as never,
      toolApproval: agent.toolApproval,
    }),
    (error) => isSafetyError(error) && error.code === "invalid_input",
  );
  assert.equal(agent.executed.length, 0);
});

test("settleDeniedApprovals writes parts that ai's own UI message validator accepts", async () => {
  const messages = [
    {
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-refund",
          toolCallId: "call_1",
          state: "approval-responded",
          input: REFUND,
          approval: { id: "a1", approved: true, reason: "fine by me" },
        },
      ],
    },
  ] as UIMessage[];
  const settled = settleDeniedApprovals(messages, new Set(["call_1"]));
  assert.deepEqual((settled[0]?.parts[0] as { approval?: unknown } | undefined)?.approval, {
    id: "a1",
    approved: false,
    reason: "fine by me",
  });
  await validateUIMessages({ messages: settled });
});

test("settleDeniedApprovals moves only the named approval-responded parts to output-denied", () => {
  const approval = { id: "a1", approved: true };
  const messages = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Refund it." }] },
    {
      id: "m1",
      role: "assistant",
      parts: [
        { type: "tool-refund", toolCallId: "call_1", state: "approval-responded", input: REFUND, approval },
        { type: "tool-refund", toolCallId: "call_2", state: "approval-responded", input: REFUND, approval },
        { type: "tool-refund", toolCallId: "call_3", state: "output-available", input: REFUND, output: 1 },
      ],
    },
  ] as UIMessage[];
  const settled = settleDeniedApprovals(messages, new Set(["call_1", "call_3"]));
  assert.equal(settled[0], messages[0], "an unchanged message is returned as it is");
  assert.deepEqual(
    settled[1]?.parts.map((part) => (part as { state?: string }).state),
    ["output-denied", "approval-responded", "output-available"],
  );
  assert.deepEqual(
    (settled[1]?.parts[0] as { approval?: unknown } | undefined)?.approval,
    { ...approval, approved: false },
    "the approval keeps its id and is marked denied",
  );
  assert.equal(
    (messages[1]?.parts[0] as { state?: string } | undefined)?.state,
    "approval-responded",
    "the input is unchanged",
  );
});
