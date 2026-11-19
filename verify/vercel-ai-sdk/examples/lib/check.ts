// Shared helpers for the verified AI SDK examples: an assertion helper and a scripted mock model.
import type { LanguageModelV4CallOptions, LanguageModelV4Content } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 as AiSdkMockModel } from "ai/test";
import { record, recordedModel } from "./transcript.ts";

// #region check
export function check(cond: unknown, msg: string): asserts cond {
  record({ kind: "check", message: msg, pass: Boolean(cond) });
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}
// #endregion

/** One scripted model turn: plain text, or tool calls (input given as an object). */
export type Turn = string | { tools: { name: string; input: unknown; id?: string }[] };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

/**
 * ai/test's MockLanguageModelV4 with the transcript recorder attached: each request and response it handles joins the
 * example's transcript. It changes nothing the model returns, so `scripted` below reads as it would with ai/test's
 * class.
 */
class MockLanguageModelV4 extends AiSdkMockModel {
  constructor(options: ConstructorParameters<typeof AiSdkMockModel>[0]) {
    super(options);
    recordedModel(this);
  }
}

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
 * script throws, so a test fails if the loop makes more model calls than expected.
 */
// #region scripted
export function scripted(turns: Turn[] | ((n: number) => Turn)) {
  const requests: LanguageModelV4CallOptions[] = [];
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
