// Shared helpers for the verified Cloudflare Agents examples. Examples run inside workerd: each one
// exports its Agent classes and a `test(env, h)` that scripts/worker-harness.mjs calls.
import type { LanguageModelV4CallOptions, LanguageModelV4Content } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
// Attaches the transcript recorder to ai/test's mock model (scripts/transcripts/).
import "./transcript.ts";

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

/** Host helpers passed to `test()` by scripts/worker-harness.mjs. */
export interface Harness {
  /** Evict a Durable Object (Miniflare's unsafeEvictDurableObject, WebSockets hibernated). */
  evict(className: string, name: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Poll `fn` until it returns a truthy value or `ms` passes; returns the last value. */
  until<T>(fn: () => T | Promise<T>, ms?: number, every?: number): Promise<T>;
}

/** One scripted model turn: plain text, or tool calls (input given as an object). */
export type Turn = string | { tools: { name: string; input: unknown; id?: string }[] };

const usage = {
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
 * A MockLanguageModelV4 (ai/test) that plays `turns` in order, for both generate and stream calls,
 * and records every request in `requests`. Running past the script throws. Copied from
 * verify/vercel-ai-sdk/examples/lib/check.ts. Create it inside the Agent (one per instance), since
 * module state is per isolate.
 */
export function scripted(turns: Turn[] | ((n: number, req: LanguageModelV4CallOptions) => Turn)) {
  const requests: LanguageModelV4CallOptions[] = [];
  const next = (options: LanguageModelV4CallOptions) => {
    requests.push(options);
    const n = requests.length - 1;
    const turn = typeof turns === "function" ? turns(n, options) : turns[n];
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

/** Text of a UIMessage's text parts. */
export const textOf = (m?: { parts: { type: string; text?: string }[] }) =>
  (m?.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");

/** The async view of an Agent's methods, as a Durable Object RPC stub exposes them. */
export type Rpc<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
} & { fetch(input: string, init?: RequestInit): Promise<Response> };

/**
 * Type a stub from getAgentByName() by hand. workers-types' own stub type collapses to `never`
 * for AIChatAgent and Think subclasses (TS2589, "excessively deep"), so the chat examples use this.
 */
export const rpc = <T>(stub: unknown) => stub as Rpc<T>;
