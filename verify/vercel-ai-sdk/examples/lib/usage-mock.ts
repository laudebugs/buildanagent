// A scripted streaming model that reports the usage it is given, for the examples that price a call.
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
// Attaches the transcript recorder to ai/test's mock model when the runner preloads it (scripts/transcripts/).
import "./transcript.ts";

/** The four token classes a provider reports for one call. */
export type TokenCounts = { noCache: number; cacheRead: number; cacheWrite: number; output: number };

/** The usage object a provider sends with its final stream part. */
export function usageOf(tokens: TokenCounts): LanguageModelV4Usage {
  const total = tokens.noCache + tokens.cacheRead + tokens.cacheWrite;
  return {
    inputTokens: { total, noCache: tokens.noCache, cacheRead: tokens.cacheRead, cacheWrite: tokens.cacheWrite },
    outputTokens: { total: tokens.output, text: tokens.output, reasoning: undefined },
  };
}

/** A mock model that streams `deltas` as one text block, then finishes with `tokens` as its usage. */
export function streamingModel(modelId: string, deltas: string[], tokens: TokenCounts) {
  return new MockLanguageModelV4({
    modelId,
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start" as const, id: "t1" },
          ...deltas.map((delta) => ({ type: "text-delta" as const, id: "t1", delta })),
          { type: "text-end" as const, id: "t1" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: usageOf(tokens),
          },
        ],
      }),
    }),
  });
}
