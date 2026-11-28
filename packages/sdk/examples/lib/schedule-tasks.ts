// The scripted scheduling tasks that 14-cascade-with-check.ts runs: ten busy-hour lists, each with the answer the fast
// model gives, and the steps that play those answers back at 2,000 input and 200 output tokens a call.
import type { AssistantMessage } from "@buildanagent/gateway";

/** The two catalog models the cascade prices its calls with. */
export const FAST = "claude-haiku-5-5";
export const SLOW = "claude-sonnet-5-5";
export const USAGE = { uncachedInput: 2_000, output: 200 };
export const OPEN = 9;
export const CLOSE = 17;
export type Task = { busy: number[]; fast: "right" | "invalid" | "wrong" };
// Seven right, two that fail the schema, one that passes it and books a busy hour.
export const TASKS: Task[] = [
  { busy: [9, 10], fast: "right" },
  { busy: [9], fast: "invalid" },
  { busy: [10, 11], fast: "right" },
  { busy: [9, 10, 11], fast: "wrong" },
  { busy: [12], fast: "right" },
  { busy: [9, 12], fast: "right" },
  { busy: [10], fast: "invalid" },
  { busy: [13, 14], fast: "right" },
  { busy: [9, 10, 11, 12], fast: "right" },
  { busy: [11], fast: "right" },
];
export const free = (t: Task) =>
  Array.from({ length: CLOSE - OPEN }, (_, i) => OPEN + i).find((h) => !t.busy.includes(h));
const reply = (start: number | string) => [{ type: "text" as const, text: JSON.stringify({ start }) }];
const step = (content: ReturnType<typeof reply>) => ({ content, usage: USAGE });
export const fastStep = (t: Task) =>
  step(t.fast === "right" ? reply(free(t) ?? 0) : t.fast === "wrong" ? reply(t.busy[0] ?? 0) : reply("ten o'clock"));
export const slowStep = (t: Task) => step(reply(free(t) ?? 0));
export const textOf = (m: AssistantMessage) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

export const nanos = (usd: number) => Math.round(usd * 1_000_000_000);
