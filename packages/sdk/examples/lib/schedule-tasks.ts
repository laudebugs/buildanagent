// The scripted scheduling tasks that 14-cascade-with-check.ts runs: ten busy-hour lists, each with the answer the fast
// model gives, and the steps that play those answers back at 2,000 input and 200 output tokens a call.
import { type AssistantMessage, defaultCatalog, findCatalogEntry, priceUsage } from "@buildanagent/gateway";

/** The catalog id the fast scripted model reports. */
export const FAST = "claude-haiku-5-5";
/** The catalog id the slow scripted model reports. */
export const SLOW = "claude-sonnet-5-5";
/** The tokens every scripted call uses. */
export const USAGE = { uncachedInput: 2_000, output: 200 };
/** One scheduling task: the busy hours, the earliest free hour, and what the fast model answers. */
export type Task = { busy: number[]; free: number; fast: "right" | "invalid" | "wrong" };
// Seven right, two that fail the schema, one that passes it and books a busy hour.
/** The ten tasks, in the order the runs ask them. */
export const TASKS: Task[] = [
  { busy: [9, 10], free: 11, fast: "right" },
  { busy: [9], free: 10, fast: "invalid" },
  { busy: [10, 11], free: 9, fast: "right" },
  { busy: [9, 10, 11], free: 12, fast: "wrong" },
  { busy: [12], free: 9, fast: "right" },
  { busy: [9, 12], free: 10, fast: "right" },
  { busy: [10], free: 9, fast: "invalid" },
  { busy: [13, 14], free: 9, fast: "right" },
  { busy: [9, 10, 11, 12], free: 13, fast: "right" },
  { busy: [11], free: 9, fast: "right" },
];
const reply = (start: number | string) => [{ type: "text" as const, text: JSON.stringify({ start }) }];
const step = (content: ReturnType<typeof reply>) => ({ content, usage: USAGE });
/** The fast model's scripted step for a task: its right, invalid or wrong answer. */
export const fastStep = (t: Task) =>
  step(t.fast === "right" ? reply(t.free) : t.fast === "wrong" ? reply(t.busy[0] ?? 0) : reply("ten o'clock"));
/** The slow model's scripted step for a task: the right answer. */
export const slowStep = (t: Task) => step(reply(t.free));
/** The text blocks of an answer, joined. */
export const textOf = (m: AssistantMessage) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
/** A dollar amount in whole nano-dollars, so sums compare exactly. */
export const nanos = (usd: number) => Math.round(usd * 1_000_000_000);
/** The catalog's price of one scripted call to the model `id`, in USD. */
export const callPrice = (id: string) =>
  priceUsage(
    { ...USAGE, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, reasoning: 0, raw: null },
    findCatalogEntry(defaultCatalog, "anthropic", id),
  ).total ?? 0;
