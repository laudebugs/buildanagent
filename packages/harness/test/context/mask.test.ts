// Layer 2: older tool results are masked in the request view in steps, and the log is never edited.
import assert from "node:assert/strict";
import { type ContentBlock, emptyUsage, type Message } from "@buildanagent/gateway";
import { createContextPolicy, cutoffFor, maskMessages, memorySpillStore } from "@buildanagent/harness/context";
import { describe, test } from "vitest";
import { call, runScripted } from "./helpers.js";

const done = { content: [{ type: "text" as const, text: "Done." }] };
/** An assistant message whose call stopped for tools, with the fields the request view ignores filled in. */
const assistant = (content: ContentBlock[], api = "scripted"): Message => ({
  role: "assistant",
  content,
  model: { api, provider: api, id: "m" },
  stopReason: "tool_calls",
  usage: emptyUsage(),
  cost: { total: 0, basis: "catalog", currency: "USD" },
});
const policy = () => createContextPolicy({ spill: memorySpillStore() });

/** A transcript of `steps` calls: a user message, then an assistant call and its 2,000-character result per step. */
function transcript(steps: number): Message[] {
  const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "Read them." }] }];
  for (let i = 0; i < steps; i++) {
    messages.push(assistant([{ type: "tool_call", callId: `c${i}`, name: "blob", input: { size: 2000 } }]));
    messages.push({
      role: "tool",
      callId: `c${i}`,
      content: [{ type: "text", text: `${i}`.repeat(2000) }],
      isError: false,
    });
  }
  return messages;
}

const toolTexts = (messages: readonly { role: string }[]) =>
  messages.flatMap((m) =>
    m.role === "tool"
      ? [(m as Extract<Message, { role: "tool" }>).content.map((b) => (b.type === "text" ? b.text : "")).join("")]
      : [],
  );

describe("masking", () => {
  test("the cutoff moves once every eight messages", () => {
    assert.deepEqual(
      [7, 8, 15, 16, 23, 24].map((n) => cutoffFor(n, 8)),
      [0, 0, 0, 8, 8, 16],
    );
  });

  test("a masked result keeps its first 500 characters and a pointer line", async () => {
    const { adapter } = await runScripted(
      [...Array.from({ length: 9 }, (_, i) => call(`c${i}`, 2000)), done],
      policy(),
      (id, size) => id.repeat(Math.ceil(size / id.length)).slice(0, size),
    );
    const last = adapter.calls.at(-1)?.context.messages ?? [];
    const texts = toolTexts(last);
    assert.ok(texts[0]?.startsWith("c0c0c0"));
    assert.ok(texts[0]?.includes("[older tool result masked: 2000 characters"));
    assert.ok((texts[0]?.length ?? 0) < 700);
    // The newest result is whole.
    assert.equal(texts.at(-1)?.length, 2000);
  });

  test("the view's prefix is byte-identical across the steps between two cutoff moves", () => {
    const where = (id: string) => `the full text is in the session log, call ${id}`;
    const settings = { keepChars: 500, stepMessages: 8 };
    const prefixes = new Set<string>();
    // Lengths 17 to 23 all have the cutoff at 8; the first eight messages' view must not change.
    for (const steps of [8, 9, 10, 11]) {
      const messages = transcript(steps);
      const view = maskMessages(messages, settings, where);
      prefixes.add(JSON.stringify(view.slice(0, 8)));
    }
    assert.equal(prefixes.size, 1);
  });

  test("masking leaves the log and the transcript as they were", async () => {
    const { entries } = await runScripted(
      [...Array.from({ length: 9 }, (_, i) => call(`c${i}`, 2000)), done],
      policy(),
    );
    const stored = entries.filter((e) => e.type === "tool_result");
    assert.equal(stored.length, 9);
    for (const entry of stored) {
      assert.ok(entry.type === "tool_result");
      assert.equal(entry.content.map((b) => (b.type === "text" ? b.text : "")).join("").length, 2000);
    }
  });

  test("with the layer off, the model reads every result whole", async () => {
    const { adapter } = await runScripted(
      [...Array.from({ length: 9 }, (_, i) => call(`c${i}`, 2000)), done],
      createContextPolicy({ spill: memorySpillStore(), layers: { mask: false } }),
    );
    assert.ok(toolTexts(adapter.calls.at(-1)?.context.messages ?? []).every((text) => text.length === 2000));
  });

  test("signed thinking before the loop in progress is dropped after the first masked result, and the loop's own stays", () => {
    const signed = (n: number): Message =>
      assistant(
        [
          { type: "reasoning", text: `thought ${n}`, signature: `sig${n}` as never },
          { type: "tool_call", callId: `c${n}`, name: "blob", input: { size: 2000 } },
        ],
        "anthropic-messages",
      );
    const result = (n: number, size: number): Message => ({
      role: "tool",
      callId: `c${n}`,
      content: [{ type: "text", text: "y".repeat(size) }],
      isError: false,
    });
    const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "go" }] }];
    for (let i = 0; i < 9; i++) messages.push(signed(i), result(i, 2000));
    messages.push({ role: "user", content: [{ type: "text", text: "and again" }] }, signed(9), result(9, 10));
    const view = maskMessages(messages, { keepChars: 500, stepMessages: 8 }, () => "x");
    const reasoning = view.flatMap((m, i) =>
      m.role === "assistant" ? m.content.filter((b) => b.type === "reasoning").map(() => i) : [],
    );
    // The first masked result is at index 2, so step 0's thinking (index 1) stays and the rest before the loop go; the
    // loop's own thinking (index 20) stays, because it was generated under this view.
    assert.deepEqual(reasoning, [1, 20]);
  });

  test("inside a thinking loop nothing is masked, so the loop's thinking goes back with the tool results", () => {
    const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "go" }] }];
    for (let i = 0; i < 12; i++) {
      messages.push(
        assistant(
          [
            { type: "reasoning", text: "t", signature: `sig${i}` as never },
            { type: "tool_call", callId: `c${i}`, name: "blob", input: { size: 2000 } },
          ],
          "anthropic-messages",
        ),
        { role: "tool", callId: `c${i}`, content: [{ type: "text", text: "y".repeat(2000) }], isError: false },
      );
    }
    assert.equal(
      maskMessages(messages, { keepChars: 500, stepMessages: 8 }, () => "x"),
      messages,
    );
  });

  test("a cut never leaves half of a surrogate pair", () => {
    const text = `${"a".repeat(499)}😀${"b".repeat(1500)}`;
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "go" }] },
      ...Array.from({ length: 9 }, (_, i): Message[] => [
        assistant([{ type: "tool_call", callId: `c${i}`, name: "blob", input: {} }]),
        { role: "tool", callId: `c${i}`, content: [{ type: "text", text }], isError: false },
      ]).flat(),
    ];
    const view = maskMessages(messages, { keepChars: 500, stepMessages: 8 }, () => "x");
    const first = toolTexts(view)[0] ?? "";
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(first));
  });

  test("the pointer for a call id a provider reused names that result's own spill", () => {
    const messages: Message[] = [{ role: "user", content: [{ type: "text", text: "go" }] }];
    for (let i = 0; i < 5; i++) {
      messages.push(assistant([{ type: "tool_call", callId: "dup", name: "blob", input: {} }]), {
        role: "tool",
        callId: "dup",
        content: [{ type: "text", text: `${i}`.repeat(2000) }],
        isError: false,
      });
    }
    const asked: number[] = [];
    maskMessages(messages, { keepChars: 500, stepMessages: 2 }, (_id, occurrence) => {
      asked.push(occurrence);
      return `spill ${occurrence}`;
    });
    assert.deepEqual(asked, [0, 1, 2]);
  });

  test("in a tool loop with signed thinking, every request carries the loop's thinking whole", async () => {
    const thinking = (i: number) => ({
      content: [
        { type: "reasoning" as const, text: `thought ${i}`, signature: `sig${i}` as never },
        { type: "tool_call" as const, callId: `c${i}`, name: "blob", input: { size: 2000 } },
      ],
    });
    const { adapter } = await runScripted([...Array.from({ length: 12 }, (_, i) => thinking(i)), done], policy());
    const signedIn = (messages: readonly Message[]) =>
      messages.filter(
        (m) => m.role === "assistant" && m.content.some((b) => b.type === "reasoning" && b.signature !== undefined),
      ).length;
    for (const [index, request] of adapter.calls.entries()) {
      assert.equal(signedIn(request.context.messages), index, `request ${index}`);
      assert.ok(toolTexts(request.context.messages).every((text) => text.length === 2000));
    }
  });
});
