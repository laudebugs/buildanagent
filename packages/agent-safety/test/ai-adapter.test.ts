import assert from "node:assert/strict";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { renderOutcome, type WriteOutcome } from "@buildanagent/agent-safety";
import { toAiToolResult } from "@buildanagent/agent-safety/ai";
import { generateText, isStepCount, jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test } from "vitest";
import { SAMPLES } from "./outcome-fixtures.js";

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/** A model that asks for the refund tool once, then answers, and records every request it receives. */
function refundModel() {
  const requests: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      requests.push(options);
      if (requests.length === 1) {
        return {
          content: [{ type: "tool-call", toolCallId: "call_1", toolName: "refund", input: '{"order":4417}' }],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      if (requests.length === 2) {
        return {
          content: [{ type: "text", text: "Done." }],
          finishReason: { unified: "stop", raw: undefined },
          usage: USAGE,
          warnings: [],
        };
      }
      throw new Error(`the refund model expected two calls, got call ${requests.length}`);
    },
  });
  return { model, requests };
}

/** Runs one tool step that reports `outcome`, and returns the tool result the model received in its next request. */
async function toolResultSeenByModel(outcome: WriteOutcome) {
  const { model, requests } = refundModel();
  const refund = tool({
    description: "Refund an order",
    inputSchema: jsonSchema<{ order: number }>({ type: "object", properties: { order: { type: "number" } } }),
    execute: async () => outcome,
    toModelOutput: ({ output }) => toAiToolResult(output),
  });
  await generateText({ model, prompt: "Refund order 4417", tools: { refund }, stopWhen: isStepCount(2) });
  assert.equal(requests.length, 2);
  const parts = (requests[1]?.prompt ?? []).flatMap((message) => (message.role === "tool" ? message.content : []));
  assert.equal(parts.length, 1);
  const [part] = parts;
  assert.ok(part?.type === "tool-result", `expected a tool-result part, got ${part?.type}`);
  return part.output;
}

for (const outcome of SAMPLES) {
  const expectedType = outcome.kind === "applied" ? "json" : "error-json";
  test(`a ${outcome.kind} outcome reaches the next request as a ${expectedType} tool result`, async () => {
    const output = await toolResultSeenByModel(outcome);
    assert.equal(output.type, expectedType);
  });

  test(`a ${outcome.kind} outcome's tool result carries both the sentences and the payload`, async () => {
    const output = await toolResultSeenByModel(outcome);
    const { text, payload } = renderOutcome(outcome);
    assert.ok(output.type === "json" || output.type === "error-json");
    assert.deepEqual(output.value, { message: text, ...payload });
  });
}
