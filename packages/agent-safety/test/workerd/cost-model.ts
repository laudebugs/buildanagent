// The priced model and the scripted lookup loop that the cost-guard Workers share: cost-agent.ts (an `AIChatAgent`)
// and think-agent.ts (a `Think`) each run it under a cap.
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";

const SOURCE = "https://provider.test/pricing";
export const CATALOG = {
  models: [
    {
      provider: "mock",
      id: "priced",
      rates: [
        { uncachedInput: 3, cacheRead: 0.3, cacheWrite: { "5m": 3.75, "1h": 6 }, output: 15, upToInputTokens: null },
      ],
      contextWindow: 200_000,
      maxOutputTokens: 4000,
      asOf: "2026-11-01",
      sources: { rates: SOURCE, contextWindow: SOURCE, maxOutputTokens: SOURCE },
    },
  ],
};
export const STEPS = 10;

/** A model that calls `lookup` on every step but the last, with input that grows by 100 tokens a call. */
export function lookupModel(requests: LanguageModelV4CallOptions[]) {
  return new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doStream: async (options) => {
      requests.push(options);
      const n = requests.length - 1;
      const last = n === STEPS - 1;
      const body: LanguageModelV4StreamPart[] = last
        ? [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: "All shipped." },
            { type: "text-end", id: "t" },
          ]
        : [{ type: "tool-call", toolCallId: `call_${n}`, toolName: "lookup", input: JSON.stringify({ order: n }) }];
      const chunks: LanguageModelV4StreamPart[] = [
        ...body,
        {
          type: "finish",
          finishReason: { unified: last ? "stop" : "tool-calls", raw: undefined },
          usage: {
            inputTokens: {
              total: 1000 + 100 * n,
              noCache: 1000 + 100 * n,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 200, text: 200, reasoning: undefined },
          },
        },
      ];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}
