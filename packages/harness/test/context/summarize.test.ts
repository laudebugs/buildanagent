// Layer 3: between turns, an outgrown span becomes a summary in a `compaction` entry, and the originals stay.
import assert from "node:assert/strict";
import { createModel, type Message, type Model, type PriceCatalog } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import {
  type CompactionRecord,
  type ContextPolicyOptions,
  createContextPolicy,
  memorySpillStore,
  SUMMARY_PROMPT_VERSION,
  type SummarizeSettings,
} from "@buildanagent/harness/context";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, rerunFrom, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { tailStart } from "../../src/context/summarize.js";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const SOURCE = "https://provider.test/pricing";
const CATALOG: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: "priced",
      rates: [{ uncachedInput: 3, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 15, upToInputTokens: null }],
      contextWindow: 200_000,
      maxOutputTokens: 4000,
      asOf: "2026-11-01",
      sources: { rates: SOURCE, contextWindow: SOURCE, maxOutputTokens: SOURCE },
    },
  ],
};

const model = (adapter: ScriptedModel, id: string) => createModel({ adapter, id, retries: 0 }) as Model;
const reply = (text: string, reasoning?: string) => ({
  usage: {},
  content: [
    ...(reasoning === undefined ? [] : [{ type: "reasoning" as const, text: reasoning, signature: "sig-1" as never }]),
    { type: "text" as const, text },
  ],
});
const LONG = `Please remember the file src/billing/invoice.ts and the error E_INVOICE_TOTAL. ${"Background detail. ".repeat(60)}`;

async function setup(
  options: Partial<ContextPolicyOptions> = {},
  summarize: SummarizeSettings = {},
  catalog?: PriceCatalog,
) {
  const main = new ScriptedModel([reply("First answer.", "thinking about it"), reply("Second answer.")]);
  const summary = new ScriptedModel([reply("## Goal\nFix E_INVOICE_TOTAL in src/billing/invoice.ts")]);
  const records: CompactionRecord[] = [];
  const context = createContextPolicy({
    spill: memorySpillStore(),
    layers: { mask: false },
    budgetTokens: 150,
    summarize: { tailTokens: 15, model: model(summary, "summary-model"), ...summarize },
    log: (record) => records.push(record),
    ...options,
  });
  const harness = createHarness({
    registry: createToolRegistry(),
    model:
      catalog === undefined
        ? model(main, "main-model")
        : (createModel({ adapter: main, id: "priced", catalog, retries: 0 }) as Model),
    system: "You help.",
    context,
  });
  const backend = memoryBackend();
  const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
  const entries = async () => {
    const found: SessionEntry[] = [];
    for await (const entry of backend.store.load(KEY)) found.push(entry);
    return found;
  };
  return { main, summary, records, harness, session, entries };
}

const userText = (message: Message | undefined): string =>
  message?.role === "user" ? message.content.map((block) => (block.type === "text" ? block.text : "")).join("") : "";

describe("the summary layer", () => {
  test("a session that crosses the budget writes one compaction entry, and the next request holds the summary and the tail", async () => {
    const { main, summary, harness, session, entries } = await setup();
    await runTurn(session, harness, { input: LONG });
    assert.equal(summary.calls.length, 0, "nothing is summarised before the first turn's context exists");
    await runTurn(session, harness, { input: "And the second question?" });
    const found = await entries();
    const compactions = found.filter((e) => e.type === "compaction");
    assert.equal(compactions.length, 1);
    const entry = compactions[0];
    assert.ok(entry?.type === "compaction");
    assert.equal(entry.layer, "summarize");
    assert.equal(entry.promptVersion, SUMMARY_PROMPT_VERSION);
    assert.ok(entry.tokensBefore > entry.tokensAfter);
    const usage = found.find((e) => e.id === entry.usageEntryId);
    assert.ok(usage?.type === "usage" && usage.source === "summary");
    // The second request: the summary stands where the span was, then the tail, then the new input.
    const request = main.calls.at(-1)?.context.messages ?? [];
    assert.ok(userText(request[0]).includes("src/billing/invoice.ts"));
    assert.ok(!request.some((m) => userText(m).includes("Background detail.")));
    assert.equal(request[1]?.role, "assistant");
    assert.equal(userText(request.at(-1)), "And the second question?");
  });

  test("the summary request carries the whole discarded span, cache off, the recall-first template and the focus", async () => {
    const { summary, harness, session, entries } = await setup({}, { focus: "billing errors" });
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    const call = summary.calls[0];
    const asked = userText(call?.context.messages[0]);
    assert.ok(asked.includes("Background detail. ".repeat(60)), "the whole span, not its tail");
    assert.ok(asked.includes("## Next Steps"));
    assert.ok(asked.includes("Preserve exact file paths, function names, and error messages."));
    assert.ok(asked.includes("Pay particular attention to: billing errors"));
    assert.equal(call?.options.cacheRetention, "none");
    const entry = (await entries()).find((e) => e.type === "compaction");
    assert.ok(entry?.type === "compaction" && entry.focus === "billing errors");
  });

  test("a beforeCompact hook that returns a summary replaces ours, and the entry records it", async () => {
    let hooked = 0;
    const { summary, harness, session, entries } = await setup({
      hooks: {
        async beforeCompact(event) {
          assert.ok(event.span.length > 0);
          return { summary: "HOOK SUMMARY" };
        },
        async afterCompact() {
          hooked++;
        },
      },
    });
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    assert.equal(summary.calls.length, 0);
    const entry = (await entries()).find((e) => e.type === "compaction");
    assert.ok(entry?.type === "compaction");
    assert.equal(entry.summary, "HOOK SUMMARY");
    assert.equal(entry.promptVersion, "hook");
    assert.equal(hooked, 1);
  });

  test("a summary whose projected cost would pass the session cap is skipped and logged", async () => {
    const { summary, records, harness, session, entries } = await setup({}, { capUsd: 0.0001 });
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    assert.equal(summary.calls.length, 0);
    assert.equal((await entries()).filter((e) => e.type === "compaction").length, 0);
    assert.ok(records.some((r) => r.event === "skipped" && r.detail.includes("unknown")));
  });

  test("the originals stay in the file, and a re-run from an entry before the compaction sees them", async () => {
    const { harness, session, entries } = await setup();
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    const found = await entries();
    const compaction = found.findIndex((e) => e.type === "compaction");
    assert.ok(found.some((e) => e.type === "message_block" && JSON.stringify(e).includes("Background detail.")));
    const before = found.slice(0, compaction).findLast((e) => e.type === "turn_end");
    assert.ok(before !== undefined);
    const again = new ScriptedModel([reply("Third answer.")]);
    const rerunHarness = createHarness({
      registry: createToolRegistry(),
      model: model(again, "main-model"),
      system: "You help.",
    });
    await rerunFrom(session, rerunHarness, before.id, { input: "What was my first message?" });
    const request = again.calls[0]?.context.messages ?? [];
    assert.ok(userText(request[0]).includes("Background detail."));
    assert.ok(!request.some((m) => userText(m).includes("summarized to save space")));
  });

  test("after a compaction the next request carries no signed thinking from the kept tail", async () => {
    const { main, harness, session } = await setup();
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    const request = main.calls.at(-1)?.context.messages ?? [];
    // The kept tail is the first answer, which carried signed thinking when it was written.
    assert.equal(request[1]?.role, "assistant");
    const signed = request.flatMap((m: Message) =>
      m.role === "assistant" ? m.content.filter((b) => b.type === "reasoning" && b.signature !== undefined) : [],
    );
    assert.equal(signed.length, 0);
  });

  test("with the layer off, nothing is summarised", async () => {
    const { summary, harness, session, entries } = await setup({ layers: { mask: false, summarize: false } });
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    assert.equal(summary.calls.length, 0);
    assert.equal((await entries()).filter((e) => e.type === "compaction").length, 0);
  });
});

describe("the summary call's guards", () => {
  test("a priced summary whose projected cost passes the cap is skipped with the cap named", async () => {
    const summary = new ScriptedModel([reply("never asked")]);
    const priced = createModel({ adapter: summary, id: "priced", catalog: CATALOG, retries: 0 }) as Model;
    const { records, harness, session } = await setup({}, { model: priced, capUsd: 0.0000001 }, CATALOG);
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    assert.equal(summary.calls.length, 0);
    assert.ok(records.some((r) => r.event === "skipped" && r.detail.includes("past its cap")));
  });

  test("a summary the model cut off at its output limit is not stored", async () => {
    const cutOff = new ScriptedModel([{ content: [{ type: "text", text: "## Goal\nFix the" }], stopReason: "length" }]);
    const { records, harness, session, entries } = await setup({}, { model: model(cutOff, "summary-model") });
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    assert.equal((await entries()).filter((e) => e.type === "compaction").length, 0);
    assert.ok(records.some((r) => r.event === "skipped" && r.detail.includes("length")));
  });

  test("a span too long for the summary model's window is skipped before the call", async () => {
    const small = new ScriptedModel([reply("never asked")], {
      caps: { contextWindow: 200, maxOutputTokens: 100, images: false, reasoning: false },
    });
    const { records, harness, session } = await setup({}, { model: model(small, "small-window"), maxOutputTokens: 50 });
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    assert.equal(small.calls.length, 0);
    assert.ok(records.some((r) => r.event === "skipped" && r.detail.includes("window")));
  });

  test("a summary setting that is not usable is refused", () => {
    for (const summarize of [
      { tailTokens: 0 },
      { toolOutputChars: -1 },
      { maxOutputTokens: 0 },
      { capUsd: Number.NaN },
    ]) {
      assert.throws(
        () => createContextPolicy({ spill: memorySpillStore(), summarize }),
        (error: unknown) => isHarnessError(error) && error.code === "invalid_context_options",
      );
    }
  });
});

describe("the verbatim tail", () => {
  const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
  const call = (id: string): Message => ({
    role: "assistant",
    content: [{ type: "tool_call", callId: id, name: "t", input: {} }],
    model: { api: "scripted", provider: "scripted", id: "m" },
    stopReason: "tool_calls",
    usage: { uncachedInput: 0, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 0, reasoning: 0, raw: null },
    cost: { total: 0, basis: "catalog", currency: "USD" },
  });
  const result = (id: string, size: number): Message => ({
    role: "tool",
    callId: id,
    content: [{ type: "text", text: "r".repeat(size) }],
    isError: false,
  });

  test("never starts with a tool result, so a call is not split from its result", () => {
    const messages = [user("a".repeat(400)), call("c1"), result("c1", 400), user("b"), call("c2"), result("c2", 400)];
    // A tail of about 100 tokens would start at the last result; it moves back to take the call with it.
    const start = tailStart(messages, 100);
    assert.equal(messages[start]?.role, "assistant");
  });

  test("returns 0 when the tail is the whole context", () => {
    assert.equal(tailStart([user("short")], 20_000), 0);
  });
});

describe("a compaction in the log", () => {
  test("contextOf starts from the summary, then the kept tail, then what followed", async () => {
    const { harness, session, entries } = await setup();
    await runTurn(session, harness, { input: LONG });
    await runTurn(session, harness, { input: "Next?" });
    const context = await session.toContext();
    assert.ok(userText(context.messages[0]).includes("summarized to save space"));
    assert.ok(!context.messages.some((m) => userText(m).includes("Background detail.")));
    assert.ok((await entries()).length > 0);
  });
});
