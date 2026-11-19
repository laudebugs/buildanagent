import assert from "node:assert/strict";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { type EffectStore, guardedWrite, memoryEffectStore, writeOutcome } from "@buildanagent/agent-safety";
import { repairInterruptedWrite, toAiToolResult } from "@buildanagent/agent-safety/ai";
import { generateText, isStepCount, jsonSchema, tool, type UIMessage, validateUIMessages } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test } from "vitest";

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that asks for one refund under `callId`, then answers, and records every request it receives. */
function refundModel(callId: string, requests: LanguageModelV4CallOptions[]) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      requests.push(options);
      const answered = options.prompt.some((message) => message.role === "tool");
      return {
        content: answered
          ? [{ type: "text", text: "Done." }]
          : [{ type: "tool-call", toolCallId: callId, toolName: "refund", input: '{"orderId":4417,"amount":250}' }],
        finishReason: { unified: answered ? "stop" : "tool-calls", raw: undefined },
        usage: USAGE,
        warnings: [],
      };
    },
  });
}

/** The refund tool, with its write behind `guardedWrite()` and the order id as its business key. */
function refundTool(store: EffectStore, sent: string[]) {
  return tool({
    description: "Refund an order",
    inputSchema: jsonSchema<{ orderId: number; amount: number }>({ type: "object" }),
    execute: (input, { toolCallId }) =>
      guardedWrite({
        store,
        scope: { tenant: "user-1", session: "session-1", branch: "main", toolCallId },
        businessKey: `refund:${input.orderId}`,
        operation: "refund_create",
        input,
        dedupe: "idempotency_key",
        run: async (key) => {
          sent.push(key);
          return { id: "re_1" };
        },
        toOutcome: (refund) =>
          writeOutcome({ kind: "applied", operation: "refund_create", next: `Tell the user ${refund.id} is issued` }),
      }),
    toModelOutput: ({ output }) => toAiToolResult(output),
  });
}

function toolResults(requests: LanguageModelV4CallOptions[]) {
  return requests.flatMap((request) =>
    request.prompt.flatMap((message) => (message.role === "tool" ? message.content : [])),
  );
}

test("an ai tool behind guardedWrite sends one refund when a regenerated turn asks again under a new call id", async () => {
  const store = memoryEffectStore();
  const sent: string[] = [];
  const requests: LanguageModelV4CallOptions[] = [];
  const refund = refundTool(store, sent);
  // The second turn regenerates the first, as a harness does after it loses the assistant message: a fresh call id.
  for (const callId of ["call_1", "call_regenerated"]) {
    await generateText({
      model: refundModel(callId, requests),
      prompt: "Refund order 4417 ($250).",
      tools: { refund },
      stopWhen: isStepCount(2),
    });
  }
  assert.equal(sent.length, 1, "the payment API received one request");
  const results = toolResults(requests);
  assert.deepEqual(
    results.map((part) => part.type === "tool-result" && part.toolCallId),
    ["call_1", "call_regenerated"],
  );
  for (const part of results) {
    assert.ok(part.type === "tool-result" && part.output.type === "json");
    assert.equal((part.output.value as { kind: string }).kind, "applied");
  }
});

const ORPHAN = {
  type: "tool-send_email",
  toolCallId: "call_1",
  state: "input-available",
  input: { to: "ada@example.com", body: "Your refund is on its way." },
} as const;

test("repairInterruptedWrite settles an interrupted write as an unknown outcome that ai's validator accepts", async () => {
  const repaired = repairInterruptedWrite(ORPHAN as UIMessage["parts"][number], new Set(["send_email"]));
  assert.ok(repaired !== undefined);
  const part = repaired as unknown as { state: string; output: { kind: string; retry: string; operation: string } };
  assert.equal(part.state, "output-available");
  assert.deepEqual(
    [part.output.kind, part.output.retry, part.output.operation],
    ["unknown", "reconcile_first", "send_email"],
  );
  const messages: UIMessage[] = [{ id: "a1", role: "assistant", parts: [repaired] }];
  assert.deepEqual(await validateUIMessages({ messages }), messages);
});

test("repairInterruptedWrite leaves a tool that isn't a write to the default repair", () => {
  assert.equal(repairInterruptedWrite(ORPHAN as UIMessage["parts"][number], new Set(["refund"])), undefined);
  const text = { type: "text", text: "hello" } as const;
  assert.equal(repairInterruptedWrite(text, new Set(["send_email"])), undefined);
});

test("repairInterruptedWrite leaves a part whose execute cannot have started to the default repair", () => {
  const writes = new Set(["send_email"]);
  for (const state of ["input-streaming", "approval-requested"]) {
    const part = { ...ORPHAN, state } as unknown as UIMessage["parts"][number];
    assert.equal(repairInterruptedWrite(part, writes), undefined, state);
  }
  const responded = { ...ORPHAN, state: "approval-responded" } as unknown as UIMessage["parts"][number];
  assert.ok(repairInterruptedWrite(responded, writes) !== undefined);
});

test("repairInterruptedWrite drops any error text and reads a dynamic tool by its name", () => {
  const dynamic = { ...ORPHAN, type: "dynamic-tool", toolName: "send_email", errorText: "interrupted" };
  const repaired = repairInterruptedWrite(dynamic as unknown as UIMessage["parts"][number], new Set(["send_email"]));
  assert.ok(repaired !== undefined);
  assert.equal("errorText" in repaired, false);
  assert.equal((repaired as { type: string }).type, "dynamic-tool");
});
