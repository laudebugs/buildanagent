import assert from "node:assert/strict";
import {
  assertStreamContract,
  complete,
  createModel,
  type ModelContext,
  type ModelEvent,
  type ModelRef,
  type PriceCatalog,
} from "@buildanagent/gateway";
import { seededRandom } from "@buildanagent/gateway/testing";
import { isSdkError } from "@buildanagent/sdk";
import {
  type AssistantScript,
  fixedClock,
  ScriptedModel,
  sequentialIds,
  UnexpectedModelCallError,
} from "@buildanagent/sdk/testing";
import { test } from "vitest";

const ref: ModelRef = { api: "scripted", provider: "scripted", id: "scripted-model" };
const context = (text = "hello"): ModelContext => ({
  system: "be brief",
  messages: [{ role: "user", content: [{ type: "text", text }] }],
  tools: [{ name: "lookup", description: "Look up an order", inputSchema: { type: "object" } }],
});
const textStep = (text: string): AssistantScript => ({ content: [{ type: "text", text }] });

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

test("a script with two steps called three times throws UnexpectedModelCallError on the third call", async () => {
  const model = new ScriptedModel([textStep("one"), textStep("two")]);
  await complete(model.stream(ref, context(), {}));
  await complete(model.stream(ref, context(), {}));
  await assert.rejects(() => complete(model.stream(ref, context(), {})), UnexpectedModelCallError);
});

test("UnexpectedModelCallError is an SdkError with code unexpected_model_call", async () => {
  const model = new ScriptedModel([]);
  await assert.rejects(
    () => complete(model.stream(ref, context(), {})),
    (error: unknown) => isSdkError(error) && error.code === "unexpected_model_call",
  );
});

test("a script with two steps called once fails assertComplete()", async () => {
  const model = new ScriptedModel([textStep("one"), textStep("two")]);
  await complete(model.stream(ref, context(), {}));
  assert.throws(() => model.assertComplete(), /1 of 2 scripted steps were never called/);
});

test("a fully used script passes assertComplete()", async () => {
  const model = new ScriptedModel([textStep("one")]);
  await complete(model.stream(ref, context(), {}));
  assert.doesNotThrow(() => model.assertComplete());
});

test("mutating the context after a call leaves calls[0] unchanged", async () => {
  const model = new ScriptedModel([textStep("ok")]);
  const ctx = context("original");
  await complete(model.stream(ref, ctx, { temperature: 0.2 }));
  ctx.messages.push({ role: "user", content: [{ type: "text", text: "later" }] });
  (ctx.messages[0] as unknown as { content: [{ type: "text"; text: string }] }).content[0].text = "changed";
  ctx.system = "changed";
  const recorded = model.calls[0];
  assert.ok(recorded, "the call was recorded");
  assert.equal(recorded.context.system, "be brief");
  assert.equal(recorded.context.messages.length, 1);
  assert.deepEqual(recorded.context.messages[0], { role: "user", content: [{ type: "text", text: "original" }] });
  assert.equal(recorded.options.temperature, 0.2);
  assert.ok(Object.isFrozen(recorded) && Object.isFrozen(recorded.context.messages[0]));
  assert.throws(() => {
    (recorded.context.messages as unknown[]).push("x");
  }, TypeError);
});

test("two runs of the same script with fixedClock and sequentialIds emit deep-equal events", async () => {
  const run = async () => {
    const clock = fixedClock("2026-11-19T00:00:00.000Z", 1000);
    const nextId = sequentialIds("call");
    const model = new ScriptedModel(
      [
        (request) => ({
          content: [
            { type: "text", text: `It is ${clock.now()} and you said ${JSON.stringify(request.context.messages[0])}` },
            { type: "tool_call", callId: "", name: "lookup", input: { order: 42, note: "chunk me please" } },
          ],
        }),
        textStep("done"),
      ],
      { idGenerator: nextId },
    );
    const first = await collect(model.stream(ref, context(), {}));
    const second = await collect(model.stream(ref, context(), {}));
    return [...first, ...second];
  };
  assert.deepEqual(await run(), await run());
});

test("text and tool-input JSON arrive in chunkSize deltas, and missing call ids are generated", async () => {
  const model = new ScriptedModel(
    [
      {
        content: [
          { type: "text", text: "abcdefghij" },
          { type: "tool_call", callId: "", name: "lookup", input: { id: 7 } },
        ],
      },
    ],
    { chunkSize: 3, idGenerator: sequentialIds("c") },
  );
  const events = await collect(model.stream(ref, context(), {}));
  const textDeltas = events.filter((e) => e.type === "text_delta").map((e) => (e as { delta: string }).delta);
  assert.deepEqual(textDeltas, ["abc", "def", "ghi", "j"]);
  const toolDeltas = events.filter((e) => e.type === "tool_input_delta").map((e) => (e as { delta: string }).delta);
  assert.equal(toolDeltas.join(""), '{"id":7}');
  assert.ok(toolDeltas.every((d) => d.length <= 3));
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "done");
  if (terminal?.type === "done") {
    assert.equal(terminal.message.stopReason, "tool_calls");
    assert.deepEqual(terminal.message.content[1], {
      type: "tool_call",
      callId: "c-1",
      name: "lookup",
      input: { id: 7 },
    });
  }
});

test("aborting between chunks ends the stream with an error terminal whose stopReason is aborted", async () => {
  const controller = new AbortController();
  const model = new ScriptedModel([textStep("abcdefghijklmnop")], { chunkSize: 2 });
  const events: ModelEvent[] = [];
  for await (const event of model.stream(ref, context(), { signal: controller.signal })) {
    events.push(event);
    if (event.type === "text_delta" && events.filter((e) => e.type === "text_delta").length === 2) controller.abort();
  }
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error");
  if (terminal?.type === "error") {
    assert.equal(terminal.message.stopReason, "aborted");
    assert.deepEqual(terminal.message.content, [{ type: "text", text: "abcd" }]);
  }
  await assertStreamContract(
    (async function* () {
      yield* events;
    })(),
  );
});

test("a scripted error ends with an error terminal that complete() returns", async () => {
  const model = new ScriptedModel([
    {
      content: [{ type: "text", text: "partial" }],
      error: { kind: "retryable", message: "overloaded", status: 529 },
      usage: { uncachedInput: 5, output: 2 },
    },
  ]);
  const message = await complete(model.stream(ref, context(), {}));
  assert.equal(message.stopReason, "error");
  assert.equal(message.error?.status, 529);
  assert.equal(message.usage.uncachedInput, 5);
});

test("every ScriptedModel stream passes assertStreamContract()", async () => {
  const scripts: AssistantScript[] = [
    textStep(""),
    textStep("hi"),
    {
      content: [
        { type: "reasoning", text: "think" },
        { type: "text", text: "answer" },
      ],
    },
    { content: [{ type: "tool_call", callId: "x", name: "lookup", input: {} }] },
    { content: [{ type: "text", text: "cut" }], stopReason: "length" },
    { content: [{ type: "text", text: "oops" }], error: { kind: "fatal", message: "bad request", status: 400 } },
  ];
  for (const chunkSize of [1, 4, 100]) {
    const model = new ScriptedModel(scripts, { chunkSize });
    for (let i = 0; i < scripts.length; i++) await assertStreamContract(model.stream(ref, context(), {}));
    model.assertComplete();
  }
});

test("a responder step receives the frozen recorded request", async () => {
  const model = new ScriptedModel([
    (request) => textStep(`tools: ${request.context.tools.map((t) => t.name).join(",")}`),
  ]);
  const message = await complete(model.stream(ref, context(), {}));
  assert.deepEqual(message.content, [{ type: "text", text: "tools: lookup" }]);
});

test("fixedClock, sequentialIds and seededRandom are deterministic", () => {
  const clock = fixedClock("2026-11-19T10:00:00.000Z", 500);
  assert.deepEqual([clock.now(), clock.now()], ["2026-11-19T10:00:00.000Z", "2026-11-19T10:00:00.500Z"]);
  const ids = sequentialIds("evt");
  assert.deepEqual([ids(), ids()], ["evt-1", "evt-2"]);
  const a = seededRandom(7);
  const b = seededRandom(7);
  const valuesA = [a(), a(), a()];
  assert.deepEqual(valuesA, [b(), b(), b()]);
  assert.ok(valuesA.every((v) => v >= 0 && v < 1));
  assert.throws(() => fixedClock("not a date"), RangeError);
});

test("an abort before an image block still ends the stream with an aborted error", async () => {
  const controller = new AbortController();
  const model = new ScriptedModel([
    {
      content: [
        { type: "text", text: "a" },
        { type: "image", mediaType: "image/png", data: "AAAA" },
      ],
    },
  ]);
  const events: ModelEvent[] = [];
  for await (const event of model.stream(ref, context(), { signal: controller.signal })) {
    events.push(event);
    if (event.type === "text_end") controller.abort();
  }
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "error");
  assert.equal(terminal?.type === "error" && terminal.message.stopReason, "aborted");
});

test("an abort before a tool call draws no call id, so the next call's ids stay in sequence", async () => {
  const controller = new AbortController();
  controller.abort();
  const toolStep: AssistantScript = { content: [{ type: "tool_call", callId: "", name: "lookup", input: {} }] };
  const model = new ScriptedModel([toolStep, toolStep], { idGenerator: sequentialIds("c") });
  await collect(model.stream(ref, context(), { signal: controller.signal }));
  const events = await collect(model.stream(ref, context(), {}));
  const terminal = events.at(-1);
  assert.equal(terminal?.type, "done");
  assert.deepEqual(terminal?.type === "done" && terminal.message.content[0], {
    type: "tool_call",
    callId: "c-1",
    name: "lookup",
    input: {},
  });
});

test("ScriptedModel runs through createModel with its default caps and its strict script", async () => {
  const adapter = new ScriptedModel([textStep("hi")]);
  const model = createModel({ adapter, id: "scripted-model" });
  assert.deepEqual(model.ref, ref);
  assert.deepEqual(model.caps, { contextWindow: 200_000, maxOutputTokens: 32_000, images: true, reasoning: true });
  const events = await assertStreamContract(model.stream(context()));
  assert.equal(events.at(-1)?.type, "done");
  adapter.assertComplete();
});

test("ScriptedModel's caps option sets the caps createModel reports", () => {
  const caps = { contextWindow: 8000, maxOutputTokens: 1000, images: false, reasoning: false };
  const model = createModel({ adapter: new ScriptedModel([], { caps }), id: "scripted-model" });
  assert.deepEqual(model.caps, caps);
});

const scriptedCatalog: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: "scripted-model",
      rates: [{ upToInputTokens: null, uncachedInput: 1, cacheRead: 1, cacheWrite: { "5m": 1, "1h": 1 }, output: 1 }],
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
      asOf: "2026-11-19",
      sources: {
        rates: "https://pricing.test",
        contextWindow: "https://models.test",
        maxOutputTokens: "https://models.test",
      },
    },
  ],
};

test("a script without usage reports unreported usage, which createModel() prices as unknown", async () => {
  const model = createModel({
    adapter: new ScriptedModel([textStep("hi")]),
    id: "scripted-model",
    catalog: scriptedCatalog,
  });
  const message = await model.complete(context());
  assert.equal(message.usage.unreported, true);
  assert.deepEqual(message.cost, { total: null, basis: "unknown", currency: "USD" });
});

test("a script with usage {} reports zero tokens, which createModel() prices as a known zero", async () => {
  const adapter = new ScriptedModel([{ ...textStep("hi"), usage: {} }]);
  const message = await createModel({ adapter, id: "scripted-model", catalog: scriptedCatalog }).complete(context());
  assert.equal(message.usage.unreported, undefined);
  assert.deepEqual(message.cost, { total: 0, basis: "catalog", currency: "USD", catalogAsOf: "2026-11-19" });
});
