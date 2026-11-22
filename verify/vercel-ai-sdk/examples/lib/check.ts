// Shared helpers for the verified AI SDK examples: an assertion helper and a scripted mock model.
import type { LanguageModelV4CallOptions, LanguageModelV4Content, LanguageModelV4Usage } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { live, liveModel } from "./live.ts";
// Attaches the transcript recorder to ai/test's mock model when the runner preloads it (scripts/transcripts/).
import "./transcript.ts";

// #region check
export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`); // book:note fail
  console.log(`ok - ${msg}`); // book:note ok
}
// #endregion

/** One scripted model turn: plain text, or tool calls (input given as an object). */
export type Turn = string | { tools: { name: string; input: unknown; id?: string }[] };

const defaultUsage: LanguageModelV4Usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

let ids = 0;
const content = (turn: Turn): LanguageModelV4Content[] =>
  typeof turn === "string"
    ? [{ type: "text", text: turn }]
    : turn.tools.map((t) => ({
        type: "tool-call",
        toolCallId: t.id ?? `call_${++ids}`,
        toolName: t.name,
        input: JSON.stringify(t.input),
      }));

/**
 * A MockLanguageModelV4 (ai/test, docs: ai-sdk-core/testing) that plays `turns` in order, for
 * both generate and stream calls, and records every request in `requests`. Running past the
 * script throws, so a test fails if the loop makes more model calls than expected. Each turn reports `options.usage`
 * (10 input and 5 output tokens by default) and the model reports `options.modelId` as its id.
 */
// #region scripted
export function scripted(
  turns: Turn[] | ((n: number) => Turn),
  options: { usage?: LanguageModelV4Usage; modelId?: string } = {},
) {
  const usage = options.usage ?? defaultUsage;
  const requests: LanguageModelV4CallOptions[] = [];
  // A live run (scripts/live/) sends the same calls to a real provider instead of playing the turns.
  if (live) return { model: liveModel(live, requests), requests };
  const next = (options: LanguageModelV4CallOptions) => {
    requests.push(options);
    const n = requests.length - 1;
    const turn = typeof turns === "function" ? turns(n) : turns[n];
    if (turn === undefined) throw new Error(`scripted model: no turn ${n + 1}`);
    return turn;
  };
  const finish = (turn: Turn) =>
    ({ unified: typeof turn === "string" ? "stop" : "tool-calls", raw: undefined }) as const;
  const model = new MockLanguageModelV4({
    ...(options.modelId === undefined ? {} : { modelId: options.modelId }),
    doGenerate: async (options) => {
      const turn = next(options);
      return { content: content(turn), finishReason: finish(turn), usage, warnings: [] };
    },
    doStream: async (options) => {
      const turn = next(options);
      const parts: any[] =
        typeof turn === "string"
          ? [
              { type: "text-start", id: "t1" },
              ...turn.split(/(?<= )/).map((delta) => ({ type: "text-delta", id: "t1", delta })),
              { type: "text-end", id: "t1" },
            ]
          : content(turn);
      return {
        stream: simulateReadableStream({ chunks: [...parts, { type: "finish", finishReason: finish(turn), usage }] }),
      };
    },
  });
  return { model, requests };
}
// #endregion

/** Text of every system message in a request. */
export const systemText = (req: LanguageModelV4CallOptions) =>
  req.prompt
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");

/** Names of the function tools offered in a request. */
export const toolNames = (req: LanguageModelV4CallOptions) => (req.tools ?? []).map((t) => t.name).sort();
