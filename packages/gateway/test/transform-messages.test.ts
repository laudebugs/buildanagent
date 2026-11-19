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
const NO_REASONING: ModelCaps = { ...CAPS, reasoning: false };
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
  const transcript: Message[] = [user("Hi"), assistant(GPT, [thinking(OPUS, "Copied in.")])];
  assert.deepEqual(blocksOf(transformMessages(transcript, GPT, CAPS), "reasoning"), [
    { type: "reasoning", text: "Copied in." },
  ]);
});

test("an Anthropic target drops a block whose foreign signature it cannot send, and every older block", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(OPUS, [thinking(OPUS, "a1"), { type: "text", text: "1" }]),
    user("two"),
    assistant(OPUS, [thinking(GPT, "copied"), { type: "text", text: "2" }]),
    user("three"),
    assistant(OPUS, [thinking(OPUS, "a2"), { type: "text", text: "3" }]),
  ];
  assert.deepEqual(blocksOf(transformMessages(transcript, SONNET, CAPS), "reasoning"), [thinking(OPUS, "a2")]);
});

test("an Anthropic target drops a thinking block recorded without a signature", () => {
  const transcript: Message[] = [
    user("Hi"),
    assistant(OPUS, [
      { type: "reasoning", text: "unsigned" },
      { type: "text", text: "Hello." },
    ]),
  ];
  assert.deepEqual(blocksOf(transformMessages(transcript, SONNET, CAPS), "reasoning"), []);
});

test("an OpenAI-compatible target drops unsigned reasoning with empty text and keeps it with text", () => {
  const transcript: Message[] = [
    user("Hi"),
    assistant(GPT, [
      { type: "reasoning", text: "" },
      { type: "reasoning", text: "kept" },
      { type: "text", text: "1" },
    ]),
  ];
  assert.deepEqual(blocksOf(transformMessages(transcript, GPT, CAPS), "reasoning"), [
    { type: "reasoning", text: "kept" },
  ]);
});

test("reasoning in a user message is removed without dropping the thinking around it", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(OPUS, [thinking(OPUS, "a1"), { type: "text", text: "1" }]),
    { role: "user", content: [{ type: "text", text: "two" }, thinking(OPUS, "pasted")] },
    assistant(OPUS, [thinking(OPUS, "a2"), { type: "text", text: "2" }]),
  ];
  const output = transformMessages(transcript, SONNET, CAPS);
  assert.deepEqual(blocksOf(output, "reasoning"), [thinking(OPUS, "a1"), thinking(OPUS, "a2")]);
  assert.deepEqual(output[2], user("two"));
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

test("an OpenAI-compatible target keeps reasoning older than a dropped block", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(GPT, [thinking(GPT, "g1"), { type: "text", text: "1" }]),
    user("two"),
    assistant(OPUS, [thinking(OPUS, "a1"), { type: "text", text: "2" }]),
    user("three"),
    assistant(GPT, [thinking(GPT, "g2"), { type: "text", text: "3" }]),
  ];
  assert.deepEqual(blocksOf(transformMessages(transcript, GPT, CAPS), "reasoning"), [
    thinking(GPT, "g1"),
    thinking(GPT, "g2"),
  ]);
});

test("a target without reasoning gets no reasoning blocks, and a turn of only reasoning is dropped", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(OPUS, [thinking(OPUS, "a1"), { type: "text", text: "1" }]),
    user("two"),
    assistant(OPUS, [thinking(OPUS, "a2")]),
  ];
  assert.deepEqual(transformMessages(transcript, SONNET, NO_REASONING), [
    user("one"),
    assistant(OPUS, [{ type: "text", text: "1" }]),
    user("two"),
  ]);
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

test("a tool call in a user message is removed", () => {
  const transcript: Message[] = [
    { role: "user", content: [{ type: "text", text: "Read it." }, call("call|bad")] },
    assistant(GPT, [{ type: "text", text: "Done." }]),
  ];
  assert.deepEqual(transformMessages(transcript, GPT, CAPS), [user("Read it."), transcript[1]]);
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
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [
    {
      role: "user",
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
    },
    transcript[4],
  ]);
});

test("an aborted turn's call with a repeated id never takes the result a completed turn is waiting for", () => {
  const transcript: Message[] = [
    user("Go."),
    assistant(GPT, [call("call_0")], "tool_calls"),
    assistant(GPT, [call("call_0")], "aborted"),
    result("call_0", "real"),
  ];
  assert.deepEqual(transformMessages(transcript, GPT, CAPS), [user("Go."), transcript[1], result("call_0", "real")]);
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

test("an assistant message left with no content is dropped, and the user messages around it merge", () => {
  const transcript: Message[] = [user("Hi"), assistant(GPT, [thinking(GPT, "hmm")]), user("Hello?")];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [
    {
      role: "user",
      content: [
        { type: "text", text: "Hi" },
        { type: "text", text: "Hello?" },
      ],
    },
  ]);
});

test("a dropped empty assistant message leaves the previous turn's results paired with their calls", () => {
  const transcript: Message[] = [
    user("Read it."),
    assistant(OPUS, [call("toolu_01")], "tool_calls"),
    assistant(GPT, [thinking(GPT, "hmm")]),
    result("toolu_01", "contents"),
  ];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [
    user("Read it."),
    transcript[1],
    result("toolu_01", "contents"),
  ]);
});

test("a result recorded after a later assistant turn moves next to its call", () => {
  const transcript: Message[] = [
    user("Read it."),
    assistant(OPUS, [call("toolu_01")], "tool_calls"),
    user("Still there?"),
    assistant(OPUS, [{ type: "text", text: "Waiting for the file." }]),
    result("toolu_01", "late"),
  ];
  assert.deepEqual(transformMessages(transcript, OPUS, CAPS), [
    user("Read it."),
    transcript[1],
    result("toolu_01", "late"),
    user("Still there?"),
    transcript[3],
  ]);
});

test("a late result answers the newest turn that reused its call id", () => {
  const transcript: Message[] = [
    user("one"),
    assistant(GPT, [call("call_0")], "tool_calls"),
    user("two"),
    assistant(GPT, [call("call_0")], "tool_calls"),
    result("call_0", "late"),
  ];
  const output = transformMessages(transcript, GPT, CAPS);
  assert.deepEqual(output[2], result("call_0", "No result was recorded for this tool call.", true));
  assert.deepEqual(output.at(-1), result("call_0_2", "late"));
});

// Message shape -------------------------------------------------------------------------------------------------------

test("adjacent assistant messages merge into one, keeping the earlier message's leading thinking", () => {
  const transcript: Message[] = [
    user("Hi"),
    assistant(OPUS, [thinking(OPUS, "a1")]),
    assistant(OPUS, [thinking(OPUS, "a2"), { type: "text", text: "Hello." }]),
  ];
  assert.deepEqual(transformMessages(transcript, SONNET, CAPS), [
    user("Hi"),
    assistant(OPUS, [thinking(OPUS, "a1"), thinking(OPUS, "a2"), { type: "text", text: "Hello." }]),
  ]);
});

test("merging assistant messages drops later thinking that would follow text, and for Anthropic all older", () => {
  const transcript: Message[] = [
    user("Hi"),
    assistant(OPUS, [thinking(OPUS, "a1"), { type: "text", text: "1" }]),
    assistant(OPUS, [thinking(OPUS, "a2"), { type: "text", text: "2" }]),
  ];
  assert.deepEqual(transformMessages(transcript, SONNET, CAPS), [
    user("Hi"),
    assistant(OPUS, [
      { type: "text", text: "1" },
      { type: "text", text: "2" },
    ]),
  ]);
});

test("empty text blocks are dropped, so no message carries one", () => {
  const transcript: Message[] = [
    user("Hi"),
    assistant(GPT, [thinking(GPT, "x"), { type: "text", text: "" }]),
    {
      role: "user",
      content: [
        { type: "text", text: "" },
        { type: "text", text: "Hello?" },
      ],
    },
  ];
  const output = transformMessages(transcript, OPUS, CAPS);
  assert.deepEqual(output, [
    {
      role: "user",
      content: [
        { type: "text", text: "Hi" },
        { type: "text", text: "Hello?" },
      ],
    },
  ]);
});

test("an opening user message the pass empties is replaced by a placeholder, so the output starts with a user", () => {
  const transcript: Message[] = [
    { role: "user", content: [call("call|bad")] },
    assistant(GPT, [{ type: "text", text: "Done." }]),
  ];
  assert.deepEqual(transformMessages(transcript, GPT, CAPS), [user("(continued)"), transcript[1]]);
});

test("a transcript left with nothing to send returns an empty array", () => {
  assert.deepEqual(transformMessages([user("")], GPT, CAPS), []);
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

/** Any block, including unsigned reasoning, so assistant and user messages can both carry every kind. */
function generateBlock(random: () => number, serial: number): ContentBlock {
  const roll = random();
  const text = random() < 0.2 ? "" : `t${serial}`;
  if (roll < 0.3) return thinking(pick(random, MODELS), text, `s${serial}`);
  if (roll < 0.4) return { type: "reasoning", text };
  if (roll < 0.7) return call(pick(random, IDS));
  return { type: "text", text: random() < 0.2 ? "" : `a${serial}` };
}

function generateContent(random: () => number, serial: number): ContentBlock[] {
  const content: ContentBlock[] = [];
  for (let b = Math.floor(random() * 4); b > 0; b -= 1) content.push(generateBlock(random, serial * 10 + b));
  return content;
}

/**
 * A message of any kind. Failed turns can land anywhere, the small id pool makes ids repeat across turns, and some
 * user messages carry reasoning and tool calls the pass must strip.
 */
function generateMessage(random: () => number, serial: number): Message {
  const kind = random();
  if (kind < 0.1) return { role: "user", content: [{ type: "image", mediaType: "image/png", data: "AA==" }] };
  if (kind < 0.2) return user(`u${serial}`);
  if (kind < 0.25)
    return { role: "user", content: [{ type: "text", text: `u${serial}` }, ...generateContent(random, serial)] };
  if (kind < 0.45) return result(pick(random, IDS), `r${serial}`, random() < 0.3);
  return assistant(pick(random, MODELS), generateContent(random, serial), pick(random, STOPS));
}

function generate(random: () => number): Message[] {
  const length = 1 + Math.floor(random() * 12);
  return Array.from({ length }, (_, serial) => generateMessage(random, serial));
}

interface GeneratedRun {
  readonly run: number;
  readonly transcript: Message[];
  readonly target: ModelRef;
  readonly caps: ModelCaps;
}

/** The same 500 seeded transcripts for every property test, each paired with a target and caps. */
function generatedRuns(): GeneratedRun[] {
  const random = seededRandom(20261119);
  return Array.from({ length: 500 }, (_, run) => ({
    run,
    transcript: generate(random),
    target: MODELS[run % MODELS.length] as ModelRef,
    caps: run % 3 === 0 ? TEXT_ONLY : run % 5 === 0 ? NO_REASONING : CAPS,
  }));
}

/**
 * Throws unless every call has one result right after its turn, ids are unique and valid, no result is stray, no two
 * user or assistant messages are adjacent, user messages carry only text and images, the output opens with a user
 * message when the input had one, no text block is empty, and every reasoning block suits the target.
 */
function assertValidTranscript(
  messages: readonly Message[],
  input: readonly Message[],
  target: ModelRef,
  caps: ModelCaps,
): void {
  if (messages.length > 0 && input.some((message) => message.role === "user")) {
    assert.equal(messages[0]?.role, "user", "the output starts with a user message");
  }
  const seen = new Set<string>();
  let open: string[] = [];
  let inResults = false;
  let previous: Message["role"] | undefined;
  for (const message of messages) {
    if (message.role === "tool") {
      assert.ok(inResults, "a tool result follows its assistant turn directly");
      const index = open.indexOf(message.callId);
      assert.ok(index >= 0, `result ${message.callId} answers an open call of its turn`);
      open.splice(index, 1);
      previous = message.role;
      continue;
    }
    assert.deepEqual(open, [], "every call has a result");
    assertMessageShape(message, previous, target, caps);
    open =
      message.role === "assistant" ? message.content.flatMap((b) => (b.type === "tool_call" ? [b.callId] : [])) : [];
    for (const id of open) {
      assert.match(id, ID_RULE);
      assert.ok(!seen.has(id), `id ${id} is unique`);
      seen.add(id);
    }
    inResults = message.role === "assistant";
    previous = message.role;
    if (!caps.images) assert.equal(JSON.stringify(message).includes('"image"'), false);
  }
  assert.deepEqual(open, [], "every call has a result");
}

/** Throws unless a user or assistant message is non-empty, may be sent, and carries reasoning the target accepts. */
function assertMessageShape(
  message: Message,
  previous: Message["role"] | undefined,
  target: ModelRef,
  caps: ModelCaps,
): void {
  if (message.role === "tool") return;
  assert.ok(message.content.length > 0, "no message is empty");
  assert.ok(!message.content.some((block) => block.type === "text" && block.text === ""), "no text block is empty");
  if (message.role === "assistant") {
    assert.notEqual(previous, "assistant", "no two assistant messages are adjacent");
    assert.ok(message.stopReason !== "error" && message.stopReason !== "aborted");
  } else {
    assert.notEqual(previous, "user", "no two user messages are adjacent");
    assert.ok(message.content.every((block) => block.type === "text" || block.type === "image"));
  }
  for (const block of message.content) {
    if (block.type !== "reasoning") continue;
    assert.ok(caps.reasoning, "a target without reasoning gets none");
    if (target.api === "anthropic-messages") assert.ok(block.signature, "Anthropic gets only signed thinking");
    else assert.ok(block.signature !== undefined || block.text !== "", "unsigned reasoning has text");
  }
}

function reasoningKeys(messages: readonly Message[]): string[] {
  return blocksOf(messages, "reasoning").map((block) =>
    block.type === "reasoning" ? block.text || (block.signature?.value ?? "") : "",
  );
}

test("for generated transcripts the output is a valid transcript for the target", () => {
  for (const { run, transcript, target, caps } of generatedRuns()) {
    assert.doesNotThrow(
      () => assertValidTranscript(transformMessages(transcript, target, caps), transcript, target, caps),
      `run ${run}`,
    );
  }
});

test("for generated transcripts the input is left unchanged", () => {
  for (const { run, transcript, target, caps } of generatedRuns()) {
    const before = structuredClone(transcript);
    transformMessages(transcript, target, caps);
    assert.deepEqual(transcript, before, `run ${run} left its input unchanged`);
  }
});

test("for generated transcripts a second pass changes nothing", () => {
  for (const { run, transcript, target, caps } of generatedRuns()) {
    const once = transformMessages(transcript, target, caps);
    assert.deepEqual(transformMessages(once, target, caps), once, `run ${run} is idempotent`);
  }
});

function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let next = 0;
  for (const item of whole) if (item === part[next]) next += 1;
  return next === part.length;
}

test("for generated transcripts an Anthropic target keeps the newest unbroken run of completed turns' thinking", () => {
  for (const { run, transcript, target, caps } of generatedRuns()) {
    if (target.api !== "anthropic-messages") continue;
    const completed = transcript.filter(
      (m) => m.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted",
    );
    const all = reasoningKeys(completed);
    const kept = reasoningKeys(transformMessages(transcript, target, caps));
    assert.deepEqual(kept, all.slice(all.length - kept.length), `run ${run} keeps the newest unbroken run`);
  }
});

test("for generated transcripts any other target keeps completed turns' thinking in its original order", () => {
  for (const { run, transcript, target, caps } of generatedRuns()) {
    if (target.api === "anthropic-messages") continue;
    const completed = transcript.filter(
      (m) => m.role === "assistant" && m.stopReason !== "error" && m.stopReason !== "aborted",
    );
    const kept = reasoningKeys(transformMessages(transcript, target, caps));
    assert.ok(isSubsequence(kept, reasoningKeys(completed)), `run ${run} keeps thinking in order`);
  }
});
