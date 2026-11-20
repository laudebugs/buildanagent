/**
 * `includeRaw` and the `raw` event: both wire adapters over their recorded fixtures, `createModel()` with its
 * retries, `complete()` and the stream contract. Every stream comes from a mock transport, so no network is used.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertStreamContract,
  createModel,
  type GatewayEvent,
  type ModelAdapter,
  type ModelContext,
  type ModelEvent,
  StreamContractError,
  type StreamOptions,
} from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";
import { mockTransport, type WireApi, type WireResponse } from "@buildanagent/gateway/testing";
import { test } from "vitest";
import { readServerSentEvents, type ServerSentEvent } from "../src/sse.js";
import { message, streamOf, validEvents } from "./fixtures.js";

const KEY = "sk-test-not-a-real-key";
const hello: ModelContext = {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  tools: [],
};

interface Wire {
  readonly api: WireApi;
  readonly id: string;
  readonly folder: string;
  adapter(script: WireResponse[]): ModelAdapter;
}

const WIRES: readonly Wire[] = [
  {
    api: "anthropic-messages",
    id: "claude-opus-5-5",
    folder: "anthropic-messages",
    adapter: (script) => anthropic({ apiKey: KEY, transport: mockTransport("anthropic-messages", script) }),
  },
  {
    api: "openai-chat",
    id: "gpt-5.4-mini",
    folder: "openai-chat",
    adapter: (script) => openaiChat({ apiKey: KEY, transport: mockTransport("openai-chat", script) }),
  },
];

function fixture(wire: Wire, name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${wire.folder}/${name}`, import.meta.url)), "utf8");
}

function sseFixtures(wire: Wire): string[] {
  return readdirSync(fileURLToPath(new URL(`./fixtures/${wire.folder}/`, import.meta.url))).filter((name) =>
    name.endsWith(".sse"),
  );
}

/** The server-sent events a body holds, as the adapters' shared decoder reads them. */
async function wireEvents(body: string): Promise<ServerSentEvent[]> {
  const bytes = new TextEncoder().encode(body);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const events: ServerSentEvent[] = [];
  for await (const event of readServerSentEvents(stream)) events.push(event);
  return events;
}

/** One direct adapter call over `script`, checked against the stream contract. */
async function direct(wire: Wire, script: WireResponse[], options: StreamOptions = {}): Promise<ModelEvent[]> {
  const adapter = wire.adapter(script);
  const caps = createModel({ adapter, id: wire.id }).caps;
  const model = { api: adapter.api, provider: adapter.provider, id: wire.id };
  return assertStreamContract(adapter.stream(model, hello, { caps, ...options }));
}

/** One call through `createModel()`, whose retries skip their wait. */
async function viaModel(wire: Wire, script: WireResponse[], options: StreamOptions = {}): Promise<GatewayEvent[]> {
  const model = createModel({ adapter: wire.adapter(script), id: wire.id, sleep: async () => {} });
  return assertStreamContract(model.stream(hello, options));
}

const isRaw = (event: GatewayEvent): event is Extract<ModelEvent, { type: "raw" }> => event.type === "raw";
const withoutRaw = (events: readonly GatewayEvent[]) => events.filter((event) => !isRaw(event));
const rawOf = (events: readonly GatewayEvent[]) => events.filter(isRaw).map((event) => event.event);

for (const wire of WIRES) {
  for (const name of sseFixtures(wire)) {
    test(`${wire.api} ${name}: with includeRaw off or unset the stream is unchanged and holds no raw event`, async () => {
      const body = fixture(wire, name);
      const unset = await direct(wire, [{ body, chunkSize: 7 }]);
      const off = await direct(wire, [{ body, chunkSize: 7 }], { includeRaw: false });
      assert.equal(JSON.stringify(off), JSON.stringify(unset));
      assert.ok(unset.every((event) => event.type !== "raw"));
    });

    test(`${wire.api} ${name}: with includeRaw on, one raw event per server-sent event, in wire order`, async () => {
      const body = fixture(wire, name);
      const off = await direct(wire, [{ body, chunkSize: 7 }]);
      const on = await direct(wire, [{ body, chunkSize: 7 }], { includeRaw: true });
      // Every server-sent event up to the one that produced the terminal; the reader stops there.
      const expected = await wireEvents(body);
      const raw = rawOf(on);
      assert.deepEqual(raw, expected.slice(0, raw.length));
      assert.ok(raw.length > 0);
      // Raw events change nothing else: the normalized events and the final message, usage and cost included.
      assert.equal(JSON.stringify(withoutRaw(on)), JSON.stringify(off));
      assert.ok(!isRaw(on.at(-1) as GatewayEvent), "no raw event follows the terminal");
    });
  }

  test(`${wire.api}: each raw event comes before the normalized events its server-sent event produced`, async () => {
    const on = await direct(wire, [{ body: fixture(wire, "text.sse") }], { includeRaw: true });
    const firstText = on.findIndex((event) => event.type === "text_start");
    const before = on[firstText - 1];
    assert.ok(before !== undefined && isRaw(before), "the text block's first event follows a raw event");
    // The terminal's own server-sent event comes before the events it produced: the closing block, then the terminal.
    const last = rawOf(on).at(-1) as ServerSentEvent;
    const after = on.slice(on.findLastIndex(isRaw) + 1).map((event) => event.type);
    if (wire.api === "openai-chat") {
      assert.deepEqual(last, { event: "message", data: "[DONE]" });
      assert.deepEqual(after, ["text_end", "done"]);
    } else {
      assert.equal(last.event, "message_stop");
      assert.deepEqual(after, ["done"]);
    }
  });

  test(`${wire.api}: an HTTP error response, which has no event stream, gets no raw event`, async () => {
    const events = await direct(wire, [{ status: 400, body: fixture(wire, "error-authentication.json") }], {
      includeRaw: true,
    });
    assert.deepEqual(rawOf(events), []);
    assert.equal(events.at(-1)?.type, "error");
  });

  test(`${wire.api}: a raw event reaches the caller even when its data then fails to parse`, async () => {
    const body = 'data: {"not json\n\n';
    const events = await direct(wire, [{ body }], { includeRaw: true });
    assert.deepEqual(rawOf(events), [{ event: "message", data: '{"not json' }]);
    const last = events.at(-1);
    assert.ok(last?.type === "error");
    assert.equal(last.message.error?.kind, "fatal");
  });

  test(`${wire.api}: a 529 before any output is still retried with includeRaw on`, async () => {
    const script = (): WireResponse[] => [
      { status: 529, body: fixture(wire, "error-overloaded.json") },
      { body: fixture(wire, "text.sse"), chunkSize: 7 },
    ];
    const off = await viaModel(wire, script());
    const on = await viaModel(wire, script(), { includeRaw: true });
    assert.equal(on.filter((event) => event.type === "retry").length, 1);
    assert.equal(JSON.stringify(withoutRaw(on)), JSON.stringify(off));
    const retryAt = on.findIndex((event) => event.type === "retry");
    assert.ok(
      on.slice(0, retryAt).every((event) => !isRaw(event)),
      "the 529 itself streamed no raw event",
    );
  });

  test(`${wire.api}: complete() ignores raw events and returns the same message`, async () => {
    const script = (): WireResponse[] => [{ body: fixture(wire, "text.sse") }];
    const off = await createModel({ adapter: wire.adapter(script()), id: wire.id }).complete(hello);
    const on = await createModel({ adapter: wire.adapter(script()), id: wire.id }).complete(hello, {
      includeRaw: true,
    });
    assert.deepEqual(on, off);
  });
}

test("anthropic-messages: a stream error event gets its raw event before the error terminal", async () => {
  const [wire] = WIRES as [Wire, Wire];
  const events = await direct(wire, [{ body: fixture(wire, "overloaded-mid-stream.sse") }], { includeRaw: true });
  assert.deepEqual(
    rawOf(events).map((event) => (event as ServerSentEvent).event),
    ["message_start", "error"],
  );
  assert.deepEqual(
    events.slice(-2).map((event) => event.type),
    ["raw", "error"],
  );
});

test("openai-chat: [DONE] arrives as the raw string, and a bare-text error event as its text", async () => {
  const wire = WIRES[1] as Wire;
  const done = await direct(wire, [{ body: fixture(wire, "text.sse") }], { includeRaw: true });
  assert.deepEqual(rawOf(done).at(-1), { event: "message", data: "[DONE]" });
  const failed = await direct(wire, [{ body: "event: error\ndata: upstream exploded\n\n" }], { includeRaw: true });
  assert.deepEqual(rawOf(failed), [{ event: "error", data: "upstream exploded" }]);
  assert.deepEqual(
    failed.slice(-2).map((event) => event.type),
    ["raw", "error"],
  );
  const chunk = await direct(wire, [{ body: fixture(wire, "error-mid-stream.sse") }], { includeRaw: true });
  assert.equal(rawOf(chunk).length, 3);
  assert.equal(chunk.at(-1)?.type, "error");
});

test("a failed attempt's raw events reach the caller, and the retry event after them marks them superseded", async () => {
  const [wire] = WIRES as [Wire, Wire];
  const script = (): WireResponse[] => [
    { body: fixture(wire, "overloaded-mid-stream.sse") },
    { body: fixture(wire, "text.sse") },
  ];
  const off = await viaModel(wire, script());
  const on = await viaModel(wire, script(), { includeRaw: true });
  const retryAt = on.findIndex((event) => event.type === "retry");
  assert.ok(retryAt > 0);
  assert.deepEqual(
    rawOf(on.slice(0, retryAt)).map((event) => (event as ServerSentEvent).event),
    ["message_start", "error"],
  );
  const second = await wireEvents(fixture(wire, "text.sse"));
  assert.deepEqual(rawOf(on.slice(retryAt + 1)), second);
  // The failed attempt's raw events change neither the normalized events nor the summed usage and cost.
  assert.equal(JSON.stringify(withoutRaw(on)), JSON.stringify(off));
});

test("assertStreamContract() accepts raw events anywhere between start and the terminal", async () => {
  const events = validEvents();
  const raw: ModelEvent = { type: "raw", event: { event: "message", data: "{}" } };
  const mixed = [events[0] as ModelEvent, raw, ...events.slice(1, -1).flatMap((event) => [event, raw]), events.at(-1)];
  assert.equal((await assertStreamContract(streamOf(mixed as ModelEvent[]))).length, mixed.length);
  // A retry may follow a raw event, because a raw event is not output.
  const retried: GatewayEvent[] = [
    { type: "start" },
    raw,
    { type: "retry", attempt: 1, delayMs: 0, error: "overloaded" },
    { type: "done", message: message("stop") },
  ];
  await assertStreamContract(streamOf(retried));
});

test("assertStreamContract() still rejects two terminals, a raw event before start and one after the terminal", async () => {
  const raw: ModelEvent = { type: "raw", event: "x" };
  const done: ModelEvent = { type: "done", message: message("stop") };
  const cases: [ModelEvent[], RegExp][] = [
    [[{ type: "start" }, raw, done, raw, done], /followed the terminal/],
    [[raw, { type: "start" }, done], /must begin with start/],
    [[{ type: "start" }, done, raw], /followed the terminal/],
  ];
  for (const [events, pattern] of cases) {
    await assert.rejects(
      () => assertStreamContract(streamOf(events)),
      (error: unknown) => error instanceof StreamContractError && pattern.test(error.message),
    );
  }
});
