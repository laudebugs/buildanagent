// `includeRaw` and the `raw` event: the loop forwards the gateway's raw events only when the run asks, keeps them out
// of the transcript, the interceptors, the OTel spans and recorded pairs, and leaves every retry in place. The streams
// come from ScriptedModel and from the Anthropic adapter over a mock transport, so no network is used.
import assert from "node:assert/strict";
import {
  type ContentBlock,
  createModel,
  type Model,
  type ModelCallOptions,
  type ModelEvent,
  type ModelMiddleware,
} from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { mockTransport, serverSentEvents } from "@buildanagent/gateway/testing";
import { type AgentEvent, isSdkError, type RunOptions, run } from "@buildanagent/sdk";
import { otelObserver } from "@buildanagent/sdk/otel";
import {
  fixedClock,
  type RecordedPair,
  recordPairs,
  replayPairs,
  ScriptedModel,
  type ScriptStep,
  type StreamScript,
  sequentialIds,
} from "@buildanagent/sdk/testing";
import { context, type Span, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { test } from "vitest";
import { determinism, drive, START, typesOf } from "./run-helpers.js";

const KEY = "sk-test-not-a-real-key";
const LATER = "2026-12-19T12:00:00.000Z";
// Every raw payload carries this marker, so a test can tell whether a raw event reached somewhere it must not.
const MARKER = "raw-provider-only-field";

const raw = (n: number): ModelEvent => ({ type: "raw", event: { event: "message", data: `{"${MARKER}":${n}}` } });

/** A stream script of one text block, with a raw event before each normalized event after `start`. */
function rawScript(answer = "Done."): StreamScript {
  const block: ContentBlock = { type: "text", text: answer };
  const usage = {
    uncachedInput: 5,
    cacheRead: 0,
    cacheWrite: { "5m": 0, "1h": 0 },
    output: 2,
    reasoning: 0,
    raw: null,
  };
  const message = {
    role: "assistant" as const,
    content: [block],
    model: { api: "scripted", provider: "scripted", id: "scripted-model" },
    stopReason: "stop" as const,
    usage,
    cost: { total: null, basis: "unknown" as const, currency: "USD" as const },
  };
  return {
    events: [
      { type: "start" },
      raw(1),
      { type: "text_start", index: 0 },
      raw(2),
      { type: "text_delta", index: 0, delta: answer },
      raw(3),
      { type: "text_end", index: 0, block },
      raw(4),
      { type: "done", message },
    ],
  };
}

/** A scripted model behind createModel(), with a middleware that records each call's options. */
function scriptedWithOptions(steps: ScriptStep[], retries = 0) {
  const sent: ModelCallOptions[] = [];
  const spy: ModelMiddleware = {
    transformParams(params) {
      sent.push({ ...params.options });
      return params;
    },
  };
  const adapter = new ScriptedModel(steps, { idGenerator: sequentialIds("call") });
  const model = createModel({
    adapter,
    id: "scripted-model",
    retries,
    sleep: async () => undefined,
    middleware: [spy],
  });
  return { adapter, model, sent };
}

function oneRun(model: Model, options: Partial<RunOptions> = {}) {
  return drive(run({ model, system: "You answer.", input: "Go.", ...determinism(), ...options }));
}

const rawEvents = (events: readonly AgentEvent[]) =>
  events.filter((event): event is Extract<AgentEvent, { type: "raw" }> => event.type === "raw");

/** The event log without raw events, `seq` and `timestamp`, which a raw event shifts. */
function logWithoutRaw(events: readonly AgentEvent[]): unknown[] {
  return events
    .filter((event) => event.type !== "raw")
    .map(({ seq: _seq, timestamp: _timestamp, ...rest }) => {
      if (rest.type !== "model_call_start") return rest;
      // The request records the options sent, which name includeRaw only when it is on.
      const { includeRaw: _includeRaw, ...options } = rest.request.options;
      return { ...rest, request: { ...rest.request, options } };
    });
}

test("run() with includeRaw emits each raw event unchanged, between model_call_start and model_call_end", async () => {
  const { adapter, model, sent } = scriptedWithOptions([rawScript()]);
  const { events, result } = await oneRun(model, { includeRaw: true });
  assert.equal(result.stopReason, "done");
  assert.deepEqual(
    rawEvents(events).map((event) => event.event),
    [1, 2, 3, 4].map((n) => (raw(n) as { event: unknown }).event),
  );
  const types = typesOf(events);
  const start = types.indexOf("model_call_start");
  const end = types.indexOf("model_call_end");
  assert.deepEqual(types.slice(start, end + 1), [
    "model_call_start",
    "raw",
    "text_start",
    "raw",
    "text_delta",
    "raw",
    "text_end",
    "raw",
    "model_call_end",
  ]);
  assert.equal(sent[0]?.includeRaw, true, "the model call asked for raw events");
  adapter.assertComplete();
});

test("run() without includeRaw, or with it false, asks for no raw events and emits none", async () => {
  for (const options of [{}, { includeRaw: false }]) {
    const { model, sent } = scriptedWithOptions([rawScript()]);
    const { events } = await oneRun(model, options);
    assert.deepEqual(rawEvents(events), []);
    assert.ok(!("includeRaw" in (sent[0] as object)), "the call's options are what they were before includeRaw");
  }
});

test("the run's includeRaw alone decides: one in modelOptions is ignored", async () => {
  const off = scriptedWithOptions([rawScript()]);
  const untyped = { modelOptions: { includeRaw: true } } as unknown as Partial<RunOptions>;
  assert.deepEqual(rawEvents((await oneRun(off.model, untyped)).events), []);
  assert.ok(!("includeRaw" in (off.sent[0] as object)));
  const on = scriptedWithOptions([rawScript()]);
  const overridden = { modelOptions: { includeRaw: false }, includeRaw: true } as unknown as Partial<RunOptions>;
  assert.equal(rawEvents((await oneRun(on.model, overridden)).events).length, 4);
});

test("includeRaw must be a boolean", () => {
  const { model } = scriptedWithOptions([]);
  assert.throws(
    () => run({ model, system: "", input: "x", includeRaw: "yes" as unknown as boolean }),
    (error: unknown) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("raw events change nothing else: the same run without them has the same log, transcript and usage", async () => {
  const on = await oneRun(scriptedWithOptions([rawScript()]).model, { includeRaw: true });
  const off = await oneRun(scriptedWithOptions([rawScript()]).model);
  assert.deepEqual(logWithoutRaw(on.events), logWithoutRaw(off.events));
  assert.deepEqual(on.result.messages, off.result.messages);
  assert.deepEqual(on.result.usage, off.result.usage);
  assert.ok(!JSON.stringify(on.result).includes(MARKER), "the result holds no raw payload");
});

test("a gateway retry after raw events still happens, and its retry event follows the failed attempt's raw events", async () => {
  const failed: StreamScript = {
    events: [
      { type: "start" },
      raw(0),
      {
        type: "error",
        message: {
          role: "assistant",
          content: [],
          model: { api: "scripted", provider: "scripted", id: "scripted-model" },
          stopReason: "error",
          error: { kind: "retryable", message: "overloaded" },
          usage: {
            uncachedInput: 0,
            cacheRead: 0,
            cacheWrite: { "5m": 0, "1h": 0 },
            output: 0,
            reasoning: 0,
            raw: null,
          },
          cost: { total: null, basis: "unknown", currency: "USD" },
        },
      },
    ],
  };
  const { model } = scriptedWithOptions([failed, rawScript()], 1);
  const { events, result } = await oneRun(model, { includeRaw: true });
  assert.equal(result.stopReason, "done");
  const types = typesOf(events);
  const start = types.indexOf("model_call_start");
  assert.deepEqual(types.slice(start, start + 4), ["model_call_start", "raw", "retry", "raw"]);
  const retry = events.find((event) => event.type === "retry");
  assert.ok(retry?.type === "retry" && retry.layer === "gateway");
});

test("a turn retry keeps the failed call's raw events before its model_call_end and the retry event", async () => {
  const partial: ContentBlock = { type: "text", text: "Half" };
  const cut: StreamScript = {
    events: [
      { type: "start" },
      raw(0),
      { type: "text_start", index: 0 },
      { type: "text_delta", index: 0, delta: "Half" },
      {
        type: "error",
        message: {
          role: "assistant",
          content: [partial],
          model: { api: "scripted", provider: "scripted", id: "scripted-model" },
          stopReason: "error",
          error: { kind: "retryable", message: "stream cut off" },
          usage: {
            uncachedInput: 0,
            cacheRead: 0,
            cacheWrite: { "5m": 0, "1h": 0 },
            output: 0,
            reasoning: 0,
            raw: null,
          },
          cost: { total: null, basis: "unknown", currency: "USD" },
        },
      },
    ],
  };
  const { model } = scriptedWithOptions([cut, rawScript()]);
  const { events, result } = await oneRun(model, { includeRaw: true, turnRetries: 1, sleep: async () => undefined });
  assert.equal(result.stopReason, "done");
  const types = typesOf(events);
  const firstEnd = types.indexOf("model_call_end");
  assert.deepEqual(types.slice(types.indexOf("model_call_start"), firstEnd + 2), [
    "model_call_start",
    "raw",
    "text_start",
    "text_delta",
    "model_call_end",
    "retry",
  ]);
  assert.equal(rawEvents(events).length, 5);
});

test("raw events never reach transformContext, the next call's context or the transcript", async () => {
  const seen: string[] = [];
  const { adapter, model } = scriptedWithOptions([rawScript("First."), rawScript("Second.")]);
  const { result } = await drive(
    run({
      model,
      system: "You answer.",
      input: "Go.",
      includeRaw: true,
      ...determinism(),
      interceptors: {
        transformContext: ({ messages }) => {
          seen.push(JSON.stringify(messages));
          return messages;
        },
        shouldStop: ({ stepIndex }) => (stepIndex === 0 ? { continue: "Go on." } : false),
      },
    }),
  );
  assert.equal(adapter.calls.length, 2);
  assert.ok(seen.every((messages) => !messages.includes(MARKER)));
  assert.ok(!JSON.stringify(adapter.calls).includes(MARKER));
  assert.ok(!JSON.stringify(result.messages).includes(MARKER));
});

test("raw events never reach a span attribute, even with content capture on", async () => {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
  const observer = otelObserver({
    tracer: provider.getTracer("test"),
    childContext: (parent) => trace.setSpan(context.active(), parent as Span),
    forceFlush: () => provider.forceFlush(),
    captureContent: true,
  });
  const { events } = await oneRun(scriptedWithOptions([rawScript()]).model, {
    includeRaw: true,
    observers: [observer],
  });
  assert.equal(rawEvents(events).length, 4);
  const spans = exporter.getFinishedSpans();
  assert.ok(spans.length > 0);
  assert.ok(!JSON.stringify(spans.map((span) => [span.attributes, span.events])).includes(MARKER));
});

// --- record and replay on the Anthropic adapter ----------------------------------------------------------------

const answerEvents: ({ readonly type: string } & Record<string, unknown>)[] = [
  {
    type: "message_start",
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      stop_reason: null,
      usage: { input_tokens: 20, output_tokens: 1 },
      [MARKER]: true,
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Order 42 has shipped." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
  { type: "message_stop" },
];
const answerTurn = serverSentEvents(answerEvents);

function anthropicModel(): Model {
  const transport = mockTransport("anthropic-messages", [{ body: answerTurn, chunkSize: 9 }]);
  return createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: "claude-opus-5-5", retries: 0 });
}

test("on the Anthropic adapter, includeRaw streams one raw event per wire event", async () => {
  const { events, result } = await oneRun(anthropicModel(), { includeRaw: true });
  assert.equal(result.stopReason, "done");
  assert.deepEqual(
    rawEvents(events).map((event) => (event.event as { event: string }).event),
    [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ],
  );
});

test("a recording made with includeRaw holds no raw event, and replays to the same log without them", async () => {
  const recorder = recordPairs(anthropicModel(), {
    providerVersion: "2026-10-21",
    expiresAt: LATER,
    clock: fixedClock(START),
  });
  const recorded = await oneRun(recorder.model, { includeRaw: true });
  assert.equal(rawEvents(recorded.events).length, 6);
  const pairs = JSON.parse(JSON.stringify(recorder.pairs())) as RecordedPair[];
  assert.ok(pairs[0]?.response.events.every((event) => event.type !== "raw"));
  assert.ok(!JSON.stringify(pairs).includes(MARKER));
  for (const includeRaw of [true, false]) {
    const replay = replayPairs(pairs, { clock: fixedClock(START) });
    const replayed = await oneRun(createModel({ adapter: replay, id: replay.modelId, retries: 0 }), { includeRaw });
    assert.deepEqual(rawEvents(replayed.events), []);
    assert.deepEqual(logWithoutRaw(replayed.events), logWithoutRaw(recorded.events));
    replay.assertComplete();
  }
});
