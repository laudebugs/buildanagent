// Layer 4: inside a turn, the first model call that would push the context past 90% of the window compacts once.
import assert from "node:assert/strict";
import { createModel, type Message, type Model } from "@buildanagent/gateway";
import { type CompactionRecord, createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const caps = (contextWindow: number) => ({ contextWindow, maxOutputTokens: 1000, images: false, reasoning: true });
const model = (adapter: ScriptedModel, id: string) => createModel({ adapter, id, retries: 0 }) as Model;
// Each call reports the size of the context it saw: the input, then 1,000 tokens more for each 4,000-character result.
const call = (callId: string, input: number) => ({
  usage: { uncachedInput: input },
  content: [
    { type: "reasoning" as const, text: `thought ${callId}`, signature: `sig-${callId}` as never },
    { type: "tool_call" as const, callId, name: "blob", input: {} },
  ],
});
const done = { usage: {}, content: [{ type: "text" as const, text: "All read." }] };

/** A 4,000-character result per call, so a few calls fill a window of a few thousand tokens. */
function registry() {
  const tools = createToolRegistry();
  tools.register({
    name: "blob",
    source: "builtin",
    definition: defineTool({
      name: "blob",
      description: "Returns a block of text.",
      inputSchema: { type: "object", properties: {} },
      async execute(_input, ctx) {
        return { content: [{ type: "text", text: `${ctx.callId}: ${"x".repeat(4000)}` }] };
      },
    }) as never,
  });
  return tools;
}

async function run(window: number, layers: Record<string, boolean> = {}) {
  const main = new ScriptedModel([call("c1", 20), call("c2", 1050), call("c3", 2080), call("c4", 1200), done], {
    caps: caps(window),
  });
  const summary = new ScriptedModel([{ usage: {}, content: [{ type: "text", text: "## Goal\nRead the blobs" }] }]);
  const records: CompactionRecord[] = [];
  const harness = createHarness({
    registry: registry(),
    model: model(main, "main-model"),
    system: "You read blobs.",
    context: createContextPolicy({
      spill: memorySpillStore(),
      layers: { mask: false, summarize: false, ...layers },
      summarize: { tailTokens: 1100, model: model(summary, "summary-model") },
      log: (record) => records.push(record),
    }),
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  const result = await runTurn(session, harness, { input: "Read them all." });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  return { main, summary, records, result, entries, session };
}

const text = (message: Message | undefined): string =>
  message === undefined || message.role === "assistant"
    ? ""
    : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

describe("mid-turn compaction", () => {
  test("a 3,000-token window compacts mid-turn once when the context crosses 90%, and later calls read the summary", async () => {
    const { main, summary, entries, result } = await run(3000);
    assert.equal(result.stopReason, "done");
    assert.equal(summary.calls.length, 1);
    const compactions = entries.filter((e) => e.type === "compaction");
    assert.equal(compactions.length, 1);
    assert.ok(compactions[0]?.type === "compaction" && compactions[0].layer === "mid_turn");
    // Before the crossing a request holds the run's own messages; after it, the first message is the summary.
    const first = main.calls[0]?.context.messages ?? [];
    assert.ok(text(first[0]).includes("Read them all."));
    const last = main.calls.at(-1)?.context.messages ?? [];
    assert.ok(text(last[0]).includes("summarized to save space"));
    assert.ok(!last.some((m) => text(m).includes("c1: x")), "the first result is in the summary's span");
  });

  test("a 1M-token window does not compact mid-turn by default", async () => {
    const { summary, entries } = await run(1_000_000);
    assert.equal(summary.calls.length, 0);
    assert.equal(entries.filter((e) => e.type === "compaction").length, 0);
  });

  test("with the layer switched off, a small window does not compact mid-turn", async () => {
    const { summary } = await run(3000, { mid_turn: false });
    assert.equal(summary.calls.length, 0);
  });

  test("the retried view carries no signed thinking from before the compaction, and keeps what the run wrote after it", async () => {
    const { main } = await run(3000);
    const last = main.calls.at(-1)?.context.messages ?? [];
    const signed = last.flatMap((m) =>
      m.role === "assistant" ? m.content.filter((b) => b.type === "reasoning" && b.signature !== undefined) : [],
    );
    // The call made after the compaction wrote its own thinking, which stays; the ones before it are gone.
    assert.deepEqual(
      signed.map((b) => (b.type === "reasoning" ? String(b.signature) : "")),
      ["sig-c4"],
    );
  });

  test("a later turn rebuilds the compacted view from the log", async () => {
    const { session } = await run(3000);
    const context = await session.toContext();
    assert.ok(text(context.messages[0]).includes("summarized to save space"));
  });
});
