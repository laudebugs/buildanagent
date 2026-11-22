// Hand-built logs for the cases a real run makes awkward to reach: a compaction, a code call, a crash. Each body names
// the entry's fields; the helper adds the id, parent, position, time and origin.
import type { SessionEntry } from "@buildanagent/protocol";

type Body = { readonly type: SessionEntry["type"]; readonly id?: string } & Record<string, unknown>;

const MODEL = { api: "test", provider: "scripted", id: "m1" };
const USAGE = { uncachedInput: 10, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 5, reasoning: 0, raw: null };
const COST = { total: 0.01, basis: "catalog", currency: "USD" };

/** A log from bodies, one second apart from 10:00:00. */
export function log(...bodies: Body[]): SessionEntry[] {
  return bodies.map((body, index) => ({
    id: `e${index}`,
    parentId: index === 0 ? null : `e${index - 1}`,
    seq: index,
    timestamp: new Date(Date.parse("2026-11-22T10:00:00.000Z") + index * 1000).toISOString(),
    origin: "harness",
    ...body,
  })) as SessionEntry[];
}

export const header = (): Body => ({
  type: "session_header",
  formatVersion: 1,
  harnessVersion: "0",
  sdkVersion: "0",
  defaultsHash: "d",
  capabilities: [],
  ablationHash: "a",
});
export const turnStart = (runId: string, system = "SYSTEM-PROMPT"): Body => ({
  type: "turn_start",
  runId,
  mode: "run",
  system,
});
export const turnEnd = (runId: string): Body => ({ type: "turn_end", runId, stopReason: "done", steps: 1 });
export const user = (messageId: string, text: string, id?: string): Body => ({
  type: "message_block",
  messageId,
  role: "user",
  index: 0,
  block: { type: "text", text },
  ...(id === undefined ? {} : { id }),
});
export const assistant = (messageId: string, block: unknown, id?: string): Body => ({
  type: "message_block",
  messageId,
  role: "assistant",
  index: 0,
  block,
  ...(id === undefined ? {} : { id }),
});
export const text = (value: string) => ({ type: "text", text: value });
export const call = (callId: string, name: string, input: unknown) => ({ type: "tool_call", callId, name, input });
export const messageEnd = (messageId: string, stopReason = "stop"): Body => ({
  type: "message_end",
  messageId,
  model: MODEL,
  stopReason,
});
export const usage = (source = "model_call"): Body => ({ type: "usage", source, usage: USAGE, cost: COST });
export const result = (callId: string, tool: string, value: string): Body => ({
  type: "tool_result",
  callId,
  tool,
  content: [{ type: "text", text: value }],
  isError: false,
  trust: "trusted",
});
export const codeCall = (callId: string, tool: string, input: unknown): Body => ({
  type: "code_call",
  callId,
  tool,
  input,
  inputHash: "sha256:00",
});
export const compaction = (firstKeptEntryId: string, summary: string): Body => ({
  type: "compaction",
  layer: "summarize",
  summary,
  firstKeptEntryId,
  tokensBefore: 100,
  tokensAfter: 10,
  model: MODEL,
  promptVersion: "p1",
  usageEntryId: "none",
});
