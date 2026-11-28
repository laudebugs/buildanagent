// A small hand-written log for the unit tests: one turn from second 1 to second 9, two model calls, a summary and a
// judge call, ending as `stopReason` says, or not ended when it is undefined.
import type { Cost } from "@buildanagent/gateway";
import type { SessionEntry } from "@buildanagent/protocol";
import { tokens } from "./rows.js";

export const MODEL = { api: "scripted", provider: "scripted", id: "m" };
export const priced = (total: number | null): Cost => ({
  total,
  basis: total === null ? "unknown" : "catalog",
  currency: "USD",
});
let seq = 0;
export const at = (second: number) => `2026-11-25T09:00:${String(second).padStart(2, "0")}.000Z`;
/** One more entry after the latest `log()`, at `second` past the minute, for a test that extends the log. */
export function entry(second: number, body: Record<string, unknown>): SessionEntry {
  seq++;
  return {
    id: `e${seq}`,
    parentId: seq === 1 ? null : `e${seq - 1}`,
    seq,
    timestamp: at(second),
    origin: "harness",
    ...body,
  } as SessionEntry;
}
export function log(
  stopReason: string | undefined,
  costs: { readonly call2: number | null } = { call2: 0.02 },
): SessionEntry[] {
  seq = 0;
  const entries = [
    entry(0, {
      type: "message_block",
      messageId: "u1",
      role: "user",
      index: 0,
      block: { type: "text", text: "Fix it." },
    }),
    entry(1, { type: "turn_start", runId: "r1", mode: "run", system: "Be brief." }),
    entry(2, {
      type: "message_block",
      messageId: "a1",
      role: "assistant",
      index: 0,
      block: { type: "reasoning", text: "hm" },
    }),
    entry(2, {
      type: "message_block",
      messageId: "a1",
      role: "assistant",
      index: 1,
      block: { type: "text", text: "Looking." },
    }),
    entry(2, {
      type: "message_block",
      messageId: "a1",
      role: "assistant",
      index: 2,
      block: { type: "tool_call", callId: "c1", name: "bash", input: { command: "ls" } },
    }),
    entry(3, { type: "message_end", messageId: "a1", model: MODEL, stopReason: "tool_calls" }),
    entry(3, { type: "usage", source: "model_call", usage: tokens(100, 10), cost: priced(0.01) }),
    entry(4, {
      type: "tool_result",
      callId: "c1",
      tool: "bash",
      content: [{ type: "text", text: "a.ts" }],
      isError: false,
      trust: "trusted",
    }),
    entry(5, { type: "usage", source: "summary", usage: tokens(50, 5), cost: priced(0.005) }),
    entry(6, {
      type: "message_block",
      messageId: "a2",
      role: "assistant",
      index: 0,
      block: { type: "text", text: "Done." },
    }),
    entry(7, { type: "message_end", messageId: "a2", model: MODEL, stopReason: "stop" }),
    entry(7, { type: "usage", source: "model_call", usage: tokens(200, 20), cost: priced(costs.call2) }),
    entry(8, { type: "usage", source: "judge", usage: tokens(999, 99), cost: priced(1) }),
  ];
  if (stopReason !== undefined) entries.push(entry(9, { type: "turn_end", runId: "r1", stopReason, steps: 2 }));
  return entries;
}
