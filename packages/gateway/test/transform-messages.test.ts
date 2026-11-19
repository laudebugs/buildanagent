import assert from "node:assert/strict";
import {
  type AssistantMessage,
  type ContentBlock,
  emptyUsage,
  type Message,
  type ModelCaps,
  type ModelRef,
  transformMessages,
} from "@buildanagent/gateway";
import { test } from "vitest";

const OPUS: ModelRef = { api: "anthropic-messages", provider: "anthropic", id: "claude-opus-5-5" };
const SONNET: ModelRef = { api: "anthropic-messages", provider: "anthropic", id: "claude-sonnet-5-5" };
const GPT: ModelRef = { api: "openai-chat", provider: "openai", id: "gpt-5.4" };
const GPT_MINI: ModelRef = { api: "openai-chat", provider: "openai", id: "gpt-5.4-mini" };
const CAPS: ModelCaps = { contextWindow: 200_000, maxOutputTokens: 8_192, images: true, reasoning: true };
const TEXT_ONLY: ModelCaps = { ...CAPS, images: false };
const ID_RULE = /^[A-Za-z0-9_-]{1,64}$/;

function assistant(
  model: ModelRef,
  content: ContentBlock[],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    model,
    stopReason,
    usage: emptyUsage(),
    cost: { total: null, basis: "unknown", currency: "USD" },
  };
}

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

function thinking(model: ModelRef, text: string, value = `sig-${text}`): ContentBlock {
  return { type: "reasoning", text, signature: { api: model.api, provider: model.provider, model: model.id, value } };
}

function call(callId: string, name = "read_file"): ContentBlock {
  return { type: "tool_call", callId, name, input: { path: "README.md" } };
}

function result(callId: string, text = "ok", isError = false): Message {
  return { role: "tool", callId, content: [{ type: "text", text }], isError };
}

function blocksOf(messages: readonly Message[], type: ContentBlock["type"]): ContentBlock[] {
  return messages.flatMap((message) =>
    message.role === "tool" ? [] : message.content.filter((block) => block.type === type),
  );
}

// Rule: reasoning from another provider is dropped and foreign signatures are stripped -------------------------------

test("a replay to another Anthropic model keeps every thinking block and signature unchanged", () => {
  const transcript: Message[] = [
    user("Summarise the README."),
    assistant(OPUS, [thinking(OPUS, "Read it first."), call("toolu_01")], "tool_calls"),
    result("toolu_01", "# buildanagent"),
    assistant(OPUS, [thinking(OPUS, "Now summarise."), { type: "text", text: "It is an agent SDK." }]),
  ];
  const output = transformMessages(transcript, SONNET, CAPS);
  assert.deepEqual(output, transcript);
  assert.deepEqual(blocksOf(output, "reasoning"), blocksOf(transcript, "reasoning"));
});

test("a same-provider replay keeps a thinking block whose text is empty, byte for byte", () => {
  const empty = thinking(OPUS, "", "EqQBCkYIBxgCKkDredacted");
  const transcript: Message[] = [user("Hi"), assistant(OPUS, [empty, { type: "text", text: "Hello." }])];
  const [, reply] = transformMessages(transcript, SONNET, CAPS);
  assert.ok(reply?.role === "assistant");
  assert.equal(JSON.stringify(reply.content[0]), JSON.stringify(empty));
});

test("a replay to an OpenAI-compatible target strips Anthropic thinking blocks and their signatures", () => {
  const transcript: Message[] = [
    user("Summarise the README."),
    assistant(OPUS, [thinking(OPUS, "Read it first."), { type: "text", text: "It is an agent SDK." }]),
  ];
  const output = transformMessages(transcript, GPT, CAPS);
  assert.deepEqual(blocksOf(output, "reasoning"), []);
  assert.deepEqual(output[1]?.role === "assistant" && output[1].content, [
    { type: "text", text: "It is an agent SDK." },
  ]);
});

test("an OpenAI-compatible target keeps reasoning from a sibling model but strips its signature", () => {
  const transcript: Message[] = [user("Hi"), assistant(GPT_MINI, [thinking(GPT_MINI, "Greet back."), call("c1")])];
  const output = transformMessages(transcript, GPT, CAPS);
  assert.deepEqual(blocksOf(output, "reasoning"), [{ type: "reasoning", text: "Greet back." }]);
  assert.deepEqual(blocksOf(transformMessages(transcript, GPT_MINI, CAPS), "reasoning"), [
    thinking(GPT_MINI, "Greet back."),
  ]);
});

test("a signature from another provider is stripped even inside a same-provider message", () => {
  const transcript: Message[] = [user("Hi"), assistant(OPUS, [thinking(GPT, "Copied in.")])];
  assert.deepEqual(blocksOf(transformMessages(transcript, SONNET, CAPS), "reasoning"), [
    { type: "reasoning", text: "Copied in." },
  ]);
});

test("when reasoning must go, the kept thinking blocks are the newest unbroken run", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(OPUS, [thinking(OPUS, "a1"), { type: "text", text: "1" }]),
    user("two"),
    assistant(GPT, [thinking(GPT, "g1"), { type: "text", text: "2" }]),
    user("three"),
    assistant(OPUS, [thinking(OPUS, "a2"), { type: "text", text: "3" }]),
    user("four"),
    assistant(OPUS, [thinking(OPUS, "a3"), thinking(OPUS, ""), { type: "text", text: "4" }]),
  ];
  const kept = blocksOf(transformMessages(transcript, SONNET, CAPS), "reasoning");
  assert.deepEqual(kept, [thinking(OPUS, "a2"), thinking(OPUS, "a3"), thinking(OPUS, "")]);
});

// Rule: tool-call ids are remapped to the target's charset ------------------------------------------------------------

test("tool-call ids outside the charset are remapped, and their results follow", () => {
  const long = `fc_${"x".repeat(450)}|item`;
  const transcript: Message[] = [
    user("Read two files."),
    assistant(GPT, [call("call|a/b"), call(long)], "tool_calls"),
    result("call|a/b"),
    result(long),
  ];
  const output = transformMessages(transcript, OPUS, CAPS);
  const ids = blocksOf(output, "tool_call").map((block) => (block.type === "tool_call" ? block.callId : ""));
  assert.equal(ids[0], "call_a_b");
  assert.equal(ids[1]?.length, 64);
  assert.ok(ids.every((id) => ID_RULE.test(id)));
  assert.deepEqual(
    output.flatMap((message) => (message.role === "tool" ? [message.callId] : [])),
    ids,
  );
});

test("a tool-call id repeated in a later turn gets a unique id, and each result pairs with its own turn", () => {
  const transcript: Message[] = [
    user("Go."),
    assistant(GPT, [call("call_0")], "tool_calls"),
    result("call_0", "first"),
    assistant(GPT, [call("call_0")], "tool_calls"),
    result("call_0", "second"),
  ];
  const output = transformMessages(transcript, GPT, CAPS);
  assert.deepEqual(
    output.flatMap((message) => (message.role === "tool" ? [[message.callId, message.content[0]]] : [])),
    [
      ["call_0", { type: "text", text: "first" }],
      ["call_0_2", { type: "text", text: "second" }],
    ],
  );
});

// Rule: images are replaced for text-only models ---------------------------------------------------------------------

test("images become a text note for a text-only model and stay for a model that takes images", () => {
  const image: ContentBlock = { type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" };
  const transcript: Message[] = [
    { role: "user", content: [{ type: "text", text: "What is this?" }, image] },
    assistant(OPUS, [call("toolu_01", "screenshot")], "tool_calls"),
    { role: "tool", callId: "toolu_01", content: [image], isError: false },
  ];
  const textOnly = transformMessages(transcript, GPT, TEXT_ONLY);
  assert.equal(JSON.stringify(textOnly).includes("image/png"), false);
  assert.match(JSON.stringify(textOnly), /image omitted/);
  assert.deepEqual(transformMessages(transcript, GPT, CAPS), transcript);
});

// Rule: errored turns are skipped ------------------------------------------------------------------------------------

test("a trailing assistant message with stopReason error is dropped, so a resumed call re-issues it", () => {
  const transcript: Message[] = [
    user("Summarise the README."),
    assistant(OPUS, [thinking(OPUS, "Reading"), { type: "text", text: "It is" }], "error"),
  ];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [user("Summarise the README.")]);
});

test("an aborted turn in the middle is skipped together with the results of its calls", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(OPUS, [call("toolu_01")], "aborted"),
    result("toolu_01"),
    user("two"),
    assistant(OPUS, [{ type: "text", text: "Done." }]),
  ];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [user("one"), user("two"), transcript[4]]);
});

// Rule: orphaned tool calls get a synthetic error result -------------------------------------------------------------

test("a tool call with no result gains a synthetic isError result", () => {
  const transcript: Message[] = [user("Read it."), assistant(OPUS, [call("toolu_01"), call("toolu_02")], "tool_calls")];
  transcript.push(result("toolu_01"));
  const output = transformMessages(transcript, OPUS, CAPS);
  const synthetic = output.at(-1);
  assert.ok(synthetic?.role === "tool");
  assert.equal(synthetic.callId, "toolu_02");
  assert.equal(synthetic.isError, true);
});

test("results move next to their call, and a result that answers no call is dropped", () => {
  const transcript: Message[] = [
    result("stray"),
    user("Read it."),
    assistant(OPUS, [call("toolu_01")], "tool_calls"),
    user("Also, hurry."),
    result("toolu_01"),
  ];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [
    user("Read it."),
    transcript[2],
    result("toolu_01"),
    user("Also, hurry."),
  ]);
});

test("an assistant message left with no content is dropped", () => {
  const transcript: Message[] = [user("Hi"), assistant(GPT, [thinking(GPT, "hmm")]), user("Hello?")];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [user("Hi"), user("Hello?")]);
});

// Purity and idempotence ---------------------------------------------------------------------------------------------

test("the input transcript is deep-equal before and after the call", () => {
  const transcript: Message[] = [
    user("Read it."),
    assistant(GPT, [thinking(GPT, "x"), call("call|1")], "tool_calls"),
    { role: "user", content: [{ type: "image", mediaType: "image/png", data: "AA==" }] },
    assistant(OPUS, [call("toolu_01")], "error"),
  ];
  const before = structuredClone(transcript);
  transformMessages(transcript, OPUS, TEXT_ONLY);
  assert.deepEqual(transcript, before);
});

// Property-style checks over generated transcripts --------------------------------------------------------------------

/** A small seeded generator (mulberry32), so every run sees the same transcripts. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const MODELS = [OPUS, SONNET, GPT, GPT_MINI];
const IDS = ["toolu_01", "call_0", "call|weird/id", "", `fc_${"z".repeat(80)}`, "toolu_01_2"];
const STOPS: AssistantMessage["stopReason"][] = ["stop", "tool_calls", "tool_calls", "length", "error", "aborted"];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function generateBlock(random: () => number, serial: number): ContentBlock {
  const roll = random();
  if (roll < 0.4) return thinking(pick(random, MODELS), random() < 0.2 ? "" : `t${serial}`, `s${serial}`);
  if (roll < 0.7) return call(pick(random, IDS));
  return { type: "text", text: `a${serial}` };
}

function generateMessage(random: () => number, serial: number): Message {
  const kind = random();
  if (kind < 0.1) return { role: "user", content: [{ type: "image", mediaType: "image/png", data: "AA==" }] };
  if (kind < 0.25) return user(`u${serial}`);
  if (kind < 0.45) return result(pick(random, IDS), `r${serial}`, random() < 0.3);
  const content: ContentBlock[] = [];
  for (let b = Math.floor(random() * 4); b > 0; b -= 1) content.push(generateBlock(random, serial * 10 + b));
  return assistant(pick(random, MODELS), content, pick(random, STOPS));
}

function generate(random: () => number): Message[] {
  const length = 1 + Math.floor(random() * 12);
  return Array.from({ length }, (_, serial) => generateMessage(random, serial));
}

/** Throws unless every call has one result right after its turn, ids are unique and valid, and no result is stray. */
function assertValidTranscript(messages: readonly Message[], caps: ModelCaps): void {
  const seen = new Set<string>();
  let open: string[] = [];
  let inResults = false;
  for (const message of messages) {
    if (message.role === "tool") {
      assert.ok(inResults, "a tool result follows its assistant turn directly");
      const index = open.indexOf(message.callId);
      assert.ok(index >= 0, `result ${message.callId} answers an open call of its turn`);
      open.splice(index, 1);
      continue;
    }
    assert.deepEqual(open, [], "every call has a result");
    if (message.role === "assistant") {
      assert.ok(message.content.length > 0);
      assert.ok(message.stopReason !== "error" && message.stopReason !== "aborted");
    }
    open =
      message.role === "assistant" ? message.content.flatMap((b) => (b.type === "tool_call" ? [b.callId] : [])) : [];
    for (const id of open) {
      assert.match(id, ID_RULE);
      assert.ok(!seen.has(id), `id ${id} is unique`);
      seen.add(id);
    }
    inResults = message.role === "assistant";
    if (!caps.images) assert.equal(JSON.stringify(message).includes('"image"'), false);
  }
  assert.deepEqual(open, [], "every call has a result");
}

function reasoningKeys(messages: readonly Message[]): string[] {
  return blocksOf(messages, "reasoning").map((block) =>
    block.type === "reasoning" ? block.text || (block.signature?.value ?? "") : "",
  );
}

test("for generated transcripts the output is valid, idempotent, unmutated and keeps the newest thinking run", () => {
  const random = seededRandom(20261119);
  for (let run = 0; run < 500; run += 1) {
    const transcript = generate(random);
    const target = MODELS[run % MODELS.length] as ModelRef;
    const caps = run % 3 === 0 ? TEXT_ONLY : CAPS;
    const before = structuredClone(transcript);
    const once = transformMessages(transcript, target, caps);
    assert.deepEqual(transcript, before, `run ${run} left its input unchanged`);
    assertValidTranscript(once, caps);
    assert.deepEqual(transformMessages(once, target, caps), once, `run ${run} is idempotent`);
    const completed = transcript.filter(
      (m) => m.role !== "assistant" || (m.stopReason !== "error" && m.stopReason !== "aborted"),
    );
    const all = reasoningKeys(completed);
    const kept = reasoningKeys(once);
    assert.deepEqual(kept, all.slice(all.length - kept.length), `run ${run} keeps the newest unbroken run`);
  }
});
