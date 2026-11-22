// Layer 5: when the provider says a request is too large, the policy compacts once and the turn goes on.
import assert from "node:assert/strict";
import { createModel, type Message, type Model } from "@buildanagent/gateway";
import { type CompactionRecord, createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const model = (adapter: ScriptedModel, id: string) => createModel({ adapter, id, retries: 0 }) as Model;
const LONG = `Please remember the file src/billing/invoice.ts. ${"Background detail. ".repeat(60)}`;
const first = {
  usage: {},
  content: [
    { type: "reasoning" as const, text: "thinking", signature: "sig-1" as never },
    { type: "text" as const, text: "First answer." },
  ],
};
const tooBig = { usage: {}, content: [], error: { kind: "overflow" as const, message: "prompt is too long" } };
const recovered = { usage: {}, content: [{ type: "text" as const, text: "Recovered." }] };

async function run(steps: ConstructorParameters<typeof ScriptedModel>[0], layers: Record<string, boolean> = {}) {
  const main = new ScriptedModel(steps);
  const summary = new ScriptedModel([{ usage: {}, content: [{ type: "text", text: "## Goal\nFix invoice.ts" }] }]);
  const records: CompactionRecord[] = [];
  const harness = createHarness({
    registry: createToolRegistry(),
    model: model(main, "main-model"),
    system: "You help.",
    context: createContextPolicy({
      spill: memorySpillStore(),
      layers: { mask: false, ...layers },
      budgetTokens: 1_000_000,
      summarize: { tailTokens: 15, model: model(summary, "summary-model") },
      log: (record) => records.push(record),
    }),
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  await runTurn(session, harness, { input: LONG });
  const result = await runTurn(session, harness, { input: "And now?" });
  const entries: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) entries.push(entry);
  return { main, summary, records, result, entries };
}

const text = (message: Message | undefined): string =>
  message === undefined || message.role === "assistant"
    ? ""
    : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");

describe("the overflow retry", () => {
  test("an overflow error leads to exactly one compaction and one retry", async () => {
    const { main, summary, entries, result } = await run([first, tooBig, recovered]);
    assert.equal(result.stopReason, "done");
    assert.equal(summary.calls.length, 1);
    const compactions = entries.filter((e) => e.type === "compaction");
    assert.equal(compactions.length, 1);
    assert.ok(compactions[0]?.type === "compaction" && compactions[0].layer === "overflow_retry");
    assert.equal(main.calls.length, 3);
    // The retried request starts from the summary, and the failed attempt's request did not.
    assert.ok(text(main.calls[2]?.context.messages[0]).includes("summarized to save space"));
    assert.ok(!(main.calls[1]?.context.messages ?? []).some((m) => text(m).includes("summarized")));
  });

  test("a second overflow ends the turn with an error and no second compaction", async () => {
    const { summary, entries, result } = await run([first, tooBig, tooBig]);
    assert.equal(result.stopReason, "error");
    assert.ok(result.stopReason === "error" && result.error.kind === "overflow");
    assert.equal(summary.calls.length, 1);
    assert.equal(entries.filter((e) => e.type === "compaction").length, 1);
  });

  test("the retried request carries no signed thinking from before the edit", async () => {
    const { main } = await run([first, tooBig, recovered]);
    const retried = main.calls[2]?.context.messages ?? [];
    const signed = retried.flatMap((m) =>
      m.role === "assistant" ? m.content.filter((b) => b.type === "reasoning" && b.signature !== undefined) : [],
    );
    assert.equal(signed.length, 0);
  });

  test("with the layer off, an overflow ends the turn as it did before", async () => {
    const { summary, entries, result } = await run([first, tooBig], { overflow_retry: false });
    assert.equal(result.stopReason, "error");
    assert.equal(summary.calls.length, 0);
    assert.equal(entries.filter((e) => e.type === "compaction").length, 0);
  });

  test("an overflow with nothing to summarise ends the turn with the error", async () => {
    const main = new ScriptedModel([tooBig]);
    const harness = createHarness({
      registry: createToolRegistry(),
      model: model(main, "main-model"),
      system: "You help.",
      context: createContextPolicy({ spill: memorySpillStore() }),
    });
    const backend = memoryBackend();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    const result = await runTurn(session, harness, { input: "Hi" });
    assert.equal(result.stopReason, "error");
  });
});
