/**
 * The Anthropic Messages adapter against recorded wire fixtures, over a mock transport.
 *
 * The fixtures in `fixtures/anthropic-messages/` follow the event and error shapes in Anthropic's Streaming,
 * Messages API reference, Errors and Prefix checks pages (as of November 2026). The documented pages give the
 * shapes, not every message: the wording of the overflow, credit-balance and content-placement messages is ours.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AssistantMessage,
  assertStreamContract,
  createModel,
  createToolNameMap,
  type GatewayEvent,
  isGatewayError,
  type Message,
  type ModelContext,
  type ModelEvent,
  type RequestDump,
  type StreamOptions,
  TOOL_NAME_RULES,
} from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { markMockTransport, mockTransport, type WireResponse } from "@buildanagent/gateway/testing";
import { test } from "vitest";
import { fakeEntry, withSentHeaders } from "./fixtures.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/anthropic-messages/", import.meta.url));
const MODEL = { api: "anthropic-messages", provider: "anthropic", id: "claude-opus-5-5" };
const KEY = "sk-test-not-a-real-key";
// The caps createModel() hands the adapter for MODEL, for tests that call stream() directly.
const CAPS = createModel({
  adapter: anthropic({ apiKey: KEY, transport: mockTransport("anthropic-messages", []) }),
  id: MODEL.id,
}).caps;

function fixture(name: string): string {
  return readFileSync(`${FIXTURES}${name}`, "utf8");
}

/** A 200 stream of the named fixture, split into small chunks so events and JSON cross chunk boundaries. */
function streamed(name: string, chunkSize = 7): WireResponse {
  return { body: fixture(name), chunkSize };
}

function failed(status: number, name: string): WireResponse {
  return { status, body: fixture(name) };
}

const hello: ModelContext = {
  system: "You are terse.",
  messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
  tools: [],
};

async function run(script: WireResponse[], context: ModelContext = hello, options: StreamOptions = {}) {
  const transport = withSentHeaders(mockTransport("anthropic-messages", script));
  const adapter = anthropic({ apiKey: KEY, transport });
  const events = await assertStreamContract(adapter.stream(MODEL, context, { caps: CAPS, ...options }));
  return { events, transport, adapter, terminal: terminalOf(events) };
}

function terminalOf(events: readonly GatewayEvent[]): AssistantMessage {
  const last = events.at(-1);
  assert.ok(last?.type === "done" || last?.type === "error", "the stream ends with a terminal");
  return last.message;
}

function warnings(events: readonly ModelEvent[]) {
  return events.filter((event) => event.type === "warning");
}

function bodyOf(transport: ReturnType<typeof mockTransport>, n = 0): Record<string, unknown> {
  const body = transport.requests[n]?.body;
  assert.ok(typeof body === "object" && body !== null, `request ${n} has a JSON body`);
  return body as Record<string, unknown>;
}

// Stream contract ----------------------------------------------------------------------------------------------------

const streamFixtures = readdirSync(FIXTURES).filter((name) => name.endsWith(".sse"));

test.each(streamFixtures)("the %s fixture passes assertStreamContract at every chunk size", async (name) => {
  for (const chunkSize of [1, 3, 64, 100_000]) {
    await run([streamed(name, chunkSize)]);
  }
});

test.each(readdirSync(FIXTURES).filter((name) => name.startsWith("error-")))(
  "the %s error response passes assertStreamContract",
  async (name) => {
    // The prefix-check 400 is retried once, so every error is scripted for a retry too.
    await run([failed(400, name), failed(400, name)]);
  },
);

// Requests -----------------------------------------------------------------------------------------------------------

test("every request carries anthropic-version 2026-10-21 and the thinking-binding beta", async () => {
  const { transport } = await run([failed(400, "error-bound-to-different-conversation.json"), streamed("text.sse")]);
  assert.equal(transport.requests.length, 2);
  assert.equal(transport.sent.length, 2);
  for (const headers of transport.sent) {
    assert.equal(headers["anthropic-version"], "2026-10-21");
    assert.equal(headers["anthropic-beta"], "thinking-binding-controls-2026-08-01");
    assert.equal(headers["x-api-key"], KEY);
  }
});

test("baseURL and transport reach every request", async () => {
  const transport = mockTransport("anthropic-messages", [streamed("text.sse"), streamed("text.sse")]);
  const adapter = anthropic({ apiKey: KEY, baseURL: "http://127.0.0.1:9/proxy/", transport });
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  assert.deepEqual(
    transport.requests.map((request) => request.url),
    ["http://127.0.0.1:9/proxy/v1/messages", "http://127.0.0.1:9/proxy/v1/messages"],
  );
});

test("temperature, top_p and top_k never reach the wire, and one warning names them", async () => {
  const { events, transport } = await run([streamed("text.sse")], hello, {
    temperature: 0.2,
    providerOptions: { anthropic: { extraBody: { top_p: 0.9, top_k: 40, metadata: { user_id: "u1" } } } },
  });
  const body = bodyOf(transport);
  for (const name of ["temperature", "top_p", "top_k"]) assert.equal(name in body, false, `${name} was sent`);
  assert.deepEqual(body.metadata, { user_id: "u1" });
  const sent = warnings(events);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.code, "unsupported_option");
  assert.match(sent[0]?.message ?? "", /temperature, top_p, top_k/);
});

test("a request with no sampling option streams no warning", async () => {
  const { events } = await run([streamed("text.sse")]);
  assert.deepEqual(warnings(events), []);
});

test("extraBody cannot override the fields the adapter sets, and one warning names them", async () => {
  const { events, transport } = await run([streamed("text.sse")], hello, {
    providerOptions: {
      anthropic: {
        extraBody: { stream: false, model: "other", thinking: { type: "disabled", display: "summarized" }, x: 1 },
      },
    },
  });
  const body = bodyOf(transport);
  assert.equal(body.stream, true);
  assert.equal(body.model, MODEL.id);
  assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
  assert.equal(body.x, 1);
  const sent = warnings(events);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.code, "unsupported_option");
  assert.match(sent[0]?.message ?? "", /model, stream, thinking\.type/);
});

test("extraBody can add to thinking without a warning", async () => {
  const { events, transport } = await run([streamed("text.sse")], hello, {
    providerOptions: { anthropic: { extraBody: { thinking: { display: "summarized" } } } },
  });
  assert.deepEqual(bodyOf(transport).thinking, { type: "adaptive", display: "summarized" });
  assert.deepEqual(warnings(events), []);
});

test("the body streams, sets max_tokens from the catalog and turns on adaptive thinking", async () => {
  const { transport } = await run([streamed("text.sse")]);
  const body = bodyOf(transport);
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 128_000);
  assert.deepEqual(body.thinking, { type: "adaptive" });
});

test("maxOutputTokens sets max_tokens", async () => {
  const { transport } = await run([streamed("text.sse")], hello, { maxOutputTokens: 512 });
  assert.equal(bodyOf(transport).max_tokens, 512);
});

test("createModel hands the adapter the caps of the caller's catalog", async () => {
  const transport = mockTransport("anthropic-messages", [streamed("text.sse")]);
  const catalog = {
    models: [fakeEntry({ provider: "anthropic", id: "claude-private", maxOutputTokens: 4_096, reasoning: true })],
  };
  const model = createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: "claude-private", catalog });
  await assertStreamContract(model.stream(hello));
  assert.equal(bodyOf(transport).max_tokens, 4_096);
  assert.deepEqual(bodyOf(transport).thinking, { type: "adaptive" });
});

test("a direct stream() call without caps uses the adapter's defaultCaps, not the catalog", async () => {
  const transport = mockTransport("anthropic-messages", [streamed("text.sse")]);
  const adapter = anthropic({ apiKey: KEY, transport });
  await assertStreamContract(adapter.stream(MODEL, hello, {}));
  assert.equal(bodyOf(transport).max_tokens, adapter.defaultCaps?.maxOutputTokens);
  assert.equal("thinking" in bodyOf(transport), false);
});

test("caller headers are lower-cased, their key headers dropped and their betas merged", async () => {
  const transport = withSentHeaders(mockTransport("anthropic-messages", [streamed("text.sse")]));
  const headers = {
    "X-Api-Key": "sk-caller-header",
    Authorization: "Bearer caller",
    "Anthropic-Beta": "files-api-2025-04-14",
    "X-Trace": "t-1",
  };
  const adapter = anthropic({ apiKey: KEY, transport, headers });
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  const sent = transport.sent[0] ?? {};
  assert.equal(sent["x-api-key"], KEY);
  assert.equal("authorization" in sent, false);
  assert.equal(sent["anthropic-beta"], "files-api-2025-04-14,thinking-binding-controls-2026-08-01");
  assert.equal(sent["x-trace"], "t-1");
});

const history: Message[] = [
  { role: "user", content: [{ type: "text", text: "Weather in SF and Zürich?" }] },
  {
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "",
        signature: { api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", value: "sig-1" },
      },
      { type: "tool_call", callId: "toolu_a", name: "get_weather", input: { location: "SF" } },
      { type: "tool_call", callId: "toolu_b", name: "get_weather", input: { location: "Zürich" } },
    ],
    model: MODEL,
    stopReason: "tool_calls",
    usage: { uncachedInput: 1, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 1, reasoning: 0, raw: null },
    cost: { total: null, basis: "unknown", currency: "USD" },
  },
  { role: "tool", callId: "toolu_a", content: [{ type: "text", text: "18°C" }], isError: false },
  { role: "tool", callId: "toolu_b", content: [{ type: "text", text: "timeout" }], isError: true },
];

const weatherTool = {
  name: "get_weather",
  description: "Get the weather",
  inputSchema: {
    type: "object",
    properties: {
      location: { type: "string", minLength: 1 },
      unit: { type: "string", enum: ["celsius", "fahrenheit"] },
    },
    required: ["location"],
  },
};

test("history encodes as thinking, tool_use and one user message of tool_result blocks", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    { system: "s", messages: history, tools: [weatherTool] },
    {
      cacheRetention: "none",
    },
  );
  assert.deepEqual(bodyOf(transport).messages, [
    { role: "user", content: [{ type: "text", text: "Weather in SF and Zürich?" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig-1" },
        { type: "tool_use", id: "toolu_a", name: "get_weather", input: { location: "SF" } },
        { type: "tool_use", id: "toolu_b", name: "get_weather", input: { location: "Zürich" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_a", content: [{ type: "text", text: "18°C" }] },
        { type: "tool_result", tool_use_id: "toolu_b", content: [{ type: "text", text: "timeout" }], is_error: true },
      ],
    },
  ]);
});

test("signed thinking is replayed for a model not marked as reasoning, and no thinking field is sent", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    { system: "s", messages: history, tools: [weatherTool] },
    { caps: { ...CAPS, reasoning: false }, cacheRetention: "none" },
  );
  const body = bodyOf(transport);
  assert.equal("thinking" in body, false);
  const messages = body.messages as { content: unknown[] }[];
  assert.deepEqual(messages[1]?.content[0], { type: "thinking", thinking: "", signature: "sig-1" });
});

test("an image block encodes as a base64 image source", async () => {
  const context: ModelContext = {
    system: "",
    messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" }] }],
    tools: [],
  };
  const { transport } = await run([streamed("text.sse")], context, { cacheRetention: "none" });
  assert.deepEqual(bodyOf(transport).messages, [
    {
      role: "user",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }],
    },
  ]);
});

test("short retention puts 5-minute breakpoints on the system prompt, the last tool and the last user block", async () => {
  const { transport } = await run([streamed("text.sse")], { system: "s", messages: history, tools: [weatherTool] });
  const body = bodyOf(transport) as {
    system: { cache_control?: unknown }[];
    tools: { cache_control?: unknown }[];
    messages: { content: { cache_control?: unknown }[] }[];
  };
  const ephemeral = { type: "ephemeral" };
  assert.deepEqual(body.system[0]?.cache_control, ephemeral);
  assert.deepEqual(body.tools.at(-1)?.cache_control, ephemeral);
  assert.deepEqual(body.messages.at(-1)?.content.at(-1)?.cache_control, ephemeral);
  const marks = JSON.stringify(body).match(/cache_control/g) ?? [];
  assert.equal(marks.length, 3);
});

test("long retention asks for a 1-hour TTL", async () => {
  const { transport } = await run([streamed("text.sse")], hello, { cacheRetention: "long" });
  const body = bodyOf(transport) as { system: { cache_control?: unknown }[] };
  assert.deepEqual(body.system[0]?.cache_control, { type: "ephemeral", ttl: "1h" });
});

test("no retention sends no breakpoint", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    { system: "s", messages: history, tools: [weatherTool] },
    {
      cacheRetention: "none",
    },
  );
  assert.equal(JSON.stringify(bodyOf(transport)).includes("cache_control"), false);
});

test("a tool is sent strict, without the constraints strict mode rejects", async () => {
  const { transport } = await run([streamed("text.sse")], { ...hello, tools: [weatherTool] });
  const [tool] = bodyOf(transport).tools as Record<string, unknown>[];
  assert.equal(tool?.strict, true);
  assert.deepEqual(tool?.input_schema, {
    type: "object",
    properties: { location: { type: "string" }, unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    required: ["location"],
    additionalProperties: false,
  });
});

test("a tool whose schema allows additional properties is sent without strict", async () => {
  const open = {
    name: "tag",
    description: "",
    inputSchema: { type: "object", additionalProperties: { type: "string" } },
  };
  const { transport } = await run([streamed("text.sse")], { ...hello, tools: [open] });
  const [tool] = bodyOf(transport).tools as Record<string, unknown>[];
  assert.equal("strict" in (tool ?? {}), false);
  assert.deepEqual(tool?.input_schema, open.inputSchema);
});

test("a tool whose object schema declares no properties is sent without strict", async () => {
  const bare = { name: "note", description: "", inputSchema: { type: "object" } };
  const { transport } = await run([streamed("text.sse")], { ...hello, tools: [bare] });
  const [tool] = bodyOf(transport).tools as Record<string, unknown>[];
  assert.equal("strict" in (tool ?? {}), false);
  assert.deepEqual(tool?.input_schema, { type: "object" });
});

test("a nullable object, typed as a type array, is lowered and checked as an object", async () => {
  const nullable = {
    name: "maybe",
    description: "",
    inputSchema: {
      type: "object",
      properties: {
        open: { type: ["object", "null"], additionalProperties: { type: "string" } },
        closed: { type: ["object", "null"], properties: { a: { type: "string" } } },
      },
    },
  };
  const open = await run([streamed("text.sse")], { ...hello, tools: [nullable] });
  const [openTool] = bodyOf(open.transport).tools as Record<string, unknown>[];
  assert.equal("strict" in (openTool ?? {}), false, "an object allowing additional properties cannot be strict");

  const closedOnly = {
    ...nullable,
    inputSchema: { ...nullable.inputSchema, properties: { closed: nullable.inputSchema.properties.closed } },
  };
  const closed = await run([streamed("text.sse")], { ...hello, tools: [closedOnly] });
  type Lowered = { strict?: boolean; input_schema: { properties: { closed: { additionalProperties?: unknown } } } };
  const [closedTool] = bodyOf(closed.transport).tools as Lowered[];
  assert.equal(closedTool?.strict, true);
  assert.equal(closedTool?.input_schema.properties.closed.additionalProperties, false);
});

test("strict lowering adds no null, so an optional field the model leaves out reaches validation absent", async () => {
  const { transport, terminal } = await run([streamed("parallel-tools.sse")], { ...hello, tools: [weatherTool] });
  const [tool] = bodyOf(transport).tools as { input_schema: { properties: Record<string, { type: unknown }> } }[];
  assert.equal(JSON.stringify(tool?.input_schema).includes("null"), false);
  const [first] = terminal.content.filter((block) => block.type === "tool_call");
  assert.deepEqual(first?.type === "tool_call" ? first.input : undefined, { location: "San Francisco, CA" });
});

test("a tool name that clashes by case is sanitised on the way out and restored on the way back", async () => {
  const tools = [weatherTool, { ...weatherTool, name: "Get_Weather" }];
  const wire = createToolNameMap(TOOL_NAME_RULES.anthropicMessages, ["get_weather", "Get_Weather"]).sanitize(
    "get_weather",
  );
  assert.notEqual(wire, "get_weather");
  const sse = fixture("parallel-tools.sse").replaceAll('"name":"get_weather"', `"name":"${wire}"`);
  const { transport, terminal } = await run([{ body: sse, chunkSize: 5 }], { ...hello, tools });
  assert.deepEqual(
    (bodyOf(transport).tools as { name: string }[]).map((tool) => tool.name),
    [wire, "Get_Weather"],
  );
  const names = terminal.content.flatMap((block) => (block.type === "tool_call" ? [block.name] : []));
  assert.deepEqual(names, ["get_weather", "get_weather"]);
});

// Responses ----------------------------------------------------------------------------------------------------------

test("a text stream maps its blocks and its four token classes", async () => {
  const { terminal } = await run([streamed("text.sse", 1)]);
  assert.equal(terminal.stopReason, "stop");
  assert.deepEqual(terminal.content, [{ type: "text", text: "Héllo, wörld ✓" }]);
  assert.deepEqual(
    { ...terminal.usage, raw: undefined },
    {
      uncachedInput: 25,
      cacheRead: 4096,
      cacheWrite: { "5m": 2051, "1h": 0 },
      output: 12,
      reasoning: 0,
      raw: undefined,
    },
  );
});

test("thinking_tokens that arrive only on the last message_delta map into Usage.reasoning", async () => {
  const { terminal } = await run([streamed("reasoning.sse")]);
  assert.equal(terminal.usage.output, 318);
  assert.equal(terminal.usage.reasoning, 290);
});

test("a thinking block becomes reasoning signed for this model", async () => {
  const { terminal } = await run([streamed("reasoning.sse")]);
  assert.deepEqual(terminal.content[0], {
    type: "reasoning",
    text: "1071 = 2 × 462 + 147\n462 = 3 × 147 + 21",
    signature: {
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-opus-5-5",
      value: "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds",
    },
  });
});

test("parallel tool calls stream as two tool inputs and end with tool_calls", async () => {
  const { events, terminal } = await run([streamed("parallel-tools.sse", 3)]);
  assert.equal(terminal.stopReason, "tool_calls");
  assert.deepEqual(
    terminal.content.filter((block) => block.type === "tool_call"),
    [
      {
        type: "tool_call",
        callId: "toolu_01T1x1fJ34qAmk2tNTrN7Up6",
        name: "get_weather",
        input: { location: "San Francisco, CA" },
      },
      {
        type: "tool_call",
        callId: "toolu_02Pq9LmZ3kRwXyVb7NcHdE4s",
        name: "get_weather",
        input: { location: "Zürich", unit: "celsius" },
      },
    ],
  );
  const deltas = events.filter((event) => event.type === "tool_input_delta" && event.index === 1);
  assert.equal(
    deltas.map((event) => (event.type === "tool_input_delta" ? event.delta : "")).join(""),
    '{"location": "San Francisco, CA"}',
  );
});

test("a length stop yields stopReason length with the partial tool input", async () => {
  const { terminal } = await run([streamed("length.sse")]);
  assert.equal(terminal.stopReason, "length");
  assert.deepEqual(terminal.content, [
    {
      type: "tool_call",
      callId: "toolu_03LengthCut",
      name: "write_report",
      input: '{"title": "Q3", "body": "Revenue grew',
    },
  ]);
});

test("a partial tool input is sent back as an empty object", async () => {
  const { terminal } = await run([streamed("length.sse")]);
  const context: ModelContext = {
    ...hello,
    messages: [...hello.messages, terminal, { role: "user", content: [{ type: "text", text: "go on" }] }],
  };
  const { transport } = await run([streamed("text.sse")], context, { cacheRetention: "none" });
  const messages = bodyOf(transport).messages as { content: { type: string; input?: unknown }[] }[];
  assert.deepEqual(messages[1]?.content[0]?.input, {});
});

test("a refusal ends in a fatal error terminal that names its category", async () => {
  const { terminal } = await run([streamed("refusal.sse")]);
  assert.equal(terminal.stopReason, "error");
  assert.equal(terminal.error?.kind, "fatal");
  assert.match(terminal.error?.message ?? "", /^refusal \(cyber\): /);
});

test("a thinking_mismatch_allowed entry in a 200 response becomes a warning event", async () => {
  const { events, terminal } = await run([streamed("input-transformations.sse")]);
  assert.equal(terminal.stopReason, "stop");
  const sent = warnings(events);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.code, "thinking_mismatch_allowed");
  assert.match(sent[0]?.message ?? "", /^messages\.1\.content\.0:/);
});

test("a pause_turn stop warns that the paused turn cannot be resumed", async () => {
  const sse = fixture("text.sse").replace('"stop_reason":"end_turn"', '"stop_reason":"pause_turn"');
  const { events, terminal } = await run([{ body: sse }]);
  assert.equal(terminal.stopReason, "stop");
  const [warning] = warnings(events);
  assert.equal(warning?.code, "pause_turn");
  assert.match(warning?.message ?? "", /cannot resume the paused turn/);
});

// The prefix check ---------------------------------------------------------------------------------------------------

const DROP_BLOCK = { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } };

test("a bound-to-a-different-conversation 400 streams its typed warning and is retried with drop_block", async () => {
  const { events, transport, terminal } = await run([
    failed(400, "error-bound-to-different-conversation.json"),
    streamed("text.sse"),
  ]);
  assert.equal(terminal.stopReason, "stop");
  assert.deepEqual(
    warnings(events).map((event) => event.code),
    ["thinking_prefix_mismatch"],
  );
  assert.deepEqual(bodyOf(transport, 0).thinking, { type: "adaptive" });
  assert.deepEqual(bodyOf(transport, 1).thinking, DROP_BLOCK);
});

test("every later request of that conversation carries drop_block, and other conversations do not", async () => {
  const transport = mockTransport("anthropic-messages", [
    failed(400, "error-bound-to-different-conversation.json"),
    streamed("text.sse"),
    streamed("text.sse"),
    streamed("text.sse"),
  ]);
  const adapter = anthropic({ apiKey: KEY, transport });
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  const later: ModelContext = {
    ...hello,
    messages: [...hello.messages, { role: "user", content: [{ type: "text", text: "more" }] }],
  };
  await assertStreamContract(adapter.stream(MODEL, later, { caps: CAPS }));
  await assertStreamContract(adapter.stream(MODEL, { ...hello, system: "Another conversation." }, { caps: CAPS }));
  assert.deepEqual(bodyOf(transport, 2).thinking, DROP_BLOCK);
  assert.deepEqual(bodyOf(transport, 3).thinking, { type: "adaptive" });
});

test("a conversationId keeps drop_block across a changed first message", async () => {
  const transport = mockTransport("anthropic-messages", [
    failed(400, "error-bound-to-different-conversation.json"),
    streamed("text.sse"),
    streamed("text.sse"),
  ]);
  const adapter = anthropic({ apiKey: KEY, transport });
  const options = { caps: CAPS, providerOptions: { anthropic: { conversationId: "c-1" } } };
  await assertStreamContract(adapter.stream(MODEL, hello, options));
  const compacted: ModelContext = {
    ...hello,
    messages: [{ role: "user", content: [{ type: "text", text: "Summary." }] }],
  };
  await assertStreamContract(adapter.stream(MODEL, compacted, options));
  assert.deepEqual(bodyOf(transport, 2).thinking, DROP_BLOCK);
});

test("an image's data stays out of the conversation fingerprint", async () => {
  const transport = mockTransport("anthropic-messages", [
    failed(400, "error-bound-to-different-conversation.json"),
    streamed("text.sse"),
    streamed("text.sse"),
  ]);
  const adapter = anthropic({ apiKey: KEY, transport });
  const withImage = (data: string): ModelContext => ({
    ...hello,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Look" },
          { type: "image", mediaType: "image/png", data },
        ],
      },
    ],
  });
  await assertStreamContract(adapter.stream(MODEL, withImage("aaaa"), { caps: CAPS }));
  // Only the image data differs, so the fingerprint, which never reads it, matches the first conversation's.
  await assertStreamContract(adapter.stream(MODEL, withImage("bbbb"), { caps: CAPS }));
  assert.deepEqual(bodyOf(transport, 2).thinking, DROP_BLOCK);
});

test("each HTTP request of a drop_block retry is dumped, both under the same attempt", async () => {
  const transport = mockTransport("anthropic-messages", [
    failed(400, "error-bound-to-different-conversation.json"),
    streamed("text.sse"),
  ]);
  const dumps: RequestDump[] = [];
  const model = createModel({
    adapter: anthropic({ apiKey: KEY, transport }),
    id: MODEL.id,
    onRequest: (dump) => dumps.push(dump),
  });
  await assertStreamContract(model.stream(hello));
  assert.deepEqual(
    dumps.map((dump) => dump.attempt),
    [1, 1],
  );
  const thinking = dumps.map((dump) => (dump.body as { thinking?: unknown } | undefined)?.thinking);
  assert.deepEqual(thinking, [{ type: "adaptive" }, DROP_BLOCK]);
});

test("a sampling warning streamed before the request adds no body-less dump", async () => {
  const transport = mockTransport("anthropic-messages", [
    failed(400, "error-bound-to-different-conversation.json"),
    streamed("text.sse"),
  ]);
  const dumps: RequestDump[] = [];
  const model = createModel({
    adapter: anthropic({ apiKey: KEY, transport }),
    id: MODEL.id,
    onRequest: (dump) => dumps.push(dump),
  });
  await assertStreamContract(model.stream(hello, { temperature: 0.2 }));
  assert.equal(transport.requests.length, 2);
  assert.equal(dumps.length, 2, "one dump per HTTP request");
  for (const [i, dump] of dumps.entries()) assert.deepEqual(dump.body, bodyOf(transport, i));
});

// The memory holds 1,000 conversations, so the test streams about 2,000 mock requests. It takes under a second on a
// free machine but timed out at Vitest's 5 s default on a loaded CI runner, so it gets 30 s. The limit only catches a
// hang; the test asserts no duration.
test("the adapter remembers drop_block for the 1,000 most recently used conversations", {
  timeout: 30_000,
}, async () => {
  const mismatchThenText = [failed(400, "error-bound-to-different-conversation.json"), { body: fixture("text.sse") }];
  // 1,001 conversations that each need drop_block, then one request each for the oldest and the newest.
  const script = [...Array.from({ length: 1_001 }, () => mismatchThenText).flat(), ...mismatchThenText.slice(1, 2)];
  const transport = mockTransport("anthropic-messages", [...script, ...script.slice(-1)]);
  const adapter = anthropic({ apiKey: KEY, transport });
  const drain = async (conversationId: string) => {
    const options = { caps: CAPS, providerOptions: { anthropic: { conversationId } } };
    for await (const _ of adapter.stream(MODEL, hello, options)) {
      // Drain.
    }
  };
  for (let i = 0; i <= 1_000; i += 1) await drain(`c-${i}`);
  await drain("c-0");
  await drain("c-1000");
  const last = transport.requests.length - 1;
  assert.deepEqual(bodyOf(transport, last - 1).thinking, { type: "adaptive" }, "c-0 was forgotten");
  assert.deepEqual(bodyOf(transport, last).thinking, DROP_BLOCK, "c-1000 is remembered");
});

test("a second prefix-check 400 ends in an error terminal with code thinking_prefix_mismatch", async () => {
  const { terminal, transport } = await run([
    failed(400, "error-bound-to-different-conversation.json"),
    failed(400, "error-bound-to-different-conversation.json"),
  ]);
  assert.equal(transport.requests.length, 2);
  assert.equal(terminal.stopReason, "error");
  assert.equal(terminal.error?.kind, "fatal");
  assert.equal(terminal.error?.code, "thinking_prefix_mismatch");
  assert.equal(terminal.error?.status, 400);
});

// Errors -------------------------------------------------------------------------------------------------------------

const errorCases: [string, number, string, NonNullable<AssistantMessage["error"]>["kind"]][] = [
  ["overloaded", 529, "error-overloaded.json", "retryable"],
  ["rate limit", 429, "error-rate-limit.json", "retryable"],
  ["prompt too long", 400, "error-prompt-too-long.json", "overflow"],
  ["credit balance", 400, "error-credit-balance.json", "quota"],
  ["monthly spend limit", 429, "error-spend-limit.json", "quota"],
  ["authentication", 401, "error-authentication.json", "fatal"],
  ["document in an assistant message", 400, "error-document-in-assistant.json", "fatal"],
  ["citations on a user text block", 400, "error-citations-in-user.json", "fatal"],
];

test.each(errorCases)(
  "a %s error (HTTP %i) maps to its kind in an in-band error terminal",
  async (_, status, name, kind) => {
    const { terminal } = await run([failed(status, name)]);
    assert.equal(terminal.stopReason, "error");
    assert.equal(terminal.error?.kind, kind);
    assert.equal(terminal.error?.status, status);
  },
);

test("a document block in an assistant message reaches the wire and returns the 2026-10-21 400", async () => {
  const onPayload = (body: unknown) => {
    const wire = body as { messages: unknown[] };
    const document = { type: "document", source: { type: "text", media_type: "text/plain", data: "notes" } };
    return { ...wire, messages: [...wire.messages, { role: "assistant", content: [document] }] };
  };
  const { terminal, transport } = await run([failed(400, "error-document-in-assistant.json")], hello, { onPayload });
  const messages = bodyOf(transport).messages as { role: string; content: { type: string }[] }[];
  assert.equal(messages.at(-1)?.content[0]?.type, "document");
  assert.match(terminal.error?.message ?? "", /^invalid_request_error: messages\.1\.content\.0: document blocks/);
});

test("citations on a user text block reach the wire and return the 2026-10-21 400", async () => {
  const citation = {
    type: "char_location",
    cited_text: "x",
    document_index: 0,
    document_title: null,
    start_char_index: 0,
    end_char_index: 1,
  };
  const onPayload = (body: unknown) => {
    const wire = body as Record<string, unknown>;
    return { ...wire, messages: [{ role: "user", content: [{ type: "text", text: "Hello", citations: [citation] }] }] };
  };
  const { terminal } = await run([failed(400, "error-citations-in-user.json")], hello, { onPayload });
  assert.equal(terminal.error?.kind, "fatal");
  assert.match(terminal.error?.message ?? "", /citations are not allowed/);
});

test("an overloaded_error event mid-stream is a retryable error terminal", async () => {
  const { terminal } = await run([streamed("overloaded-mid-stream.sse")]);
  assert.equal(terminal.stopReason, "error");
  assert.equal(terminal.error?.kind, "retryable");
  assert.equal(terminal.error?.status, undefined);
});

test("createModel retries a mid-stream overload and prices the reply from the catalog", async () => {
  const transport = mockTransport("anthropic-messages", [streamed("overloaded-mid-stream.sse"), streamed("text.sse")]);
  const model = createModel({
    adapter: anthropic({ apiKey: KEY, transport }),
    id: "claude-opus-5-5",
    sleep: async () => {},
  });
  const events = await assertStreamContract(model.stream(hello));
  assert.deepEqual(events.filter((event) => event.type === "retry").length, 1);
  const message = terminalOf(events);
  assert.equal(message.stopReason, "stop");
  assert.equal(message.cost.basis, "catalog");
  assert.equal(message.usage.uncachedInput, 55);
});

test("an option warning streams once per call across two retries", async () => {
  const transport = mockTransport("anthropic-messages", [
    failed(529, "error-overloaded.json"),
    failed(529, "error-overloaded.json"),
    streamed("text.sse"),
  ]);
  const model = createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: MODEL.id, sleep: async () => {} });
  const events = await assertStreamContract(model.stream(hello, { temperature: 0.2 }));
  assert.equal(events.filter((event) => event.type === "retry").length, 2);
  assert.deepEqual(
    events.filter((event) => event.type === "warning").map((event) => event.code),
    ["unsupported_option"],
  );
});

test("a stream that ends before message_stop is a retryable error terminal with the partial content", async () => {
  const cut = fixture("text.sse").split("event: content_block_stop")[0] ?? "";
  const { terminal } = await run([{ body: cut, chunkSize: 4 }]);
  assert.equal(terminal.error?.kind, "retryable");
  assert.deepEqual(terminal.content, [{ type: "text", text: "Héllo, wörld ✓" }]);
});

test("a transport that throws ends in a retryable error terminal", async () => {
  const transport = async (): Promise<Response> => {
    throw new TypeError("fetch failed");
  };
  const adapter = anthropic({ apiKey: KEY, transport: markMockTransport(transport) });
  const terminal = terminalOf(await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS })));
  assert.equal(terminal.error?.kind, "retryable");
});

test("a transport that throws a ReferenceError fails on the first attempt", async () => {
  let calls = 0;
  const transport = async (): Promise<Response> => {
    calls += 1;
    throw new ReferenceError("config is not defined");
  };
  const adapter = anthropic({ apiKey: KEY, transport: markMockTransport(transport) });
  const model = createModel({ adapter, id: MODEL.id, sleep: async () => {} });
  const terminal = terminalOf(await assertStreamContract(model.stream(hello)));
  assert.equal(calls, 1);
  assert.equal(terminal.error?.kind, "fatal");
});

test("an abort mid-stream ends in an aborted terminal with the content so far", async () => {
  const controller = new AbortController();
  const transport = mockTransport("anthropic-messages", [streamed("text.sse", 16)]);
  const adapter = anthropic({ apiKey: KEY, transport });
  const events: ModelEvent[] = [];
  for await (const event of adapter.stream(MODEL, hello, { caps: CAPS, signal: controller.signal })) {
    events.push(event);
    if (event.type === "text_delta") controller.abort();
  }
  await assertStreamContract(
    (async function* () {
      yield* events;
    })(),
  );
  const terminal = terminalOf(events);
  assert.equal(terminal.stopReason, "aborted");
  assert.equal(terminal.content[0]?.type, "text");
});

// Configuration ------------------------------------------------------------------------------------------------------

test("a missing key throws missing_api_key before any request", () => {
  assert.throws(
    () => anthropic({ apiKey: "" }),
    (error: unknown) => isGatewayError(error) && error.code === "missing_api_key",
  );
});

test("the adapter reads no environment variable", async () => {
  const read: PropertyKey[] = [];
  const original = process.env;
  process.env = new Proxy(original, {
    get(target, key) {
      read.push(key);
      return Reflect.get(target, key);
    },
    has(target, key) {
      read.push(key);
      return Reflect.has(target, key);
    },
    ownKeys(target) {
      read.push("<ownKeys>");
      return Reflect.ownKeys(target);
    },
  });
  try {
    const transport = mockTransport("anthropic-messages", [streamed("reasoning.sse")]);
    const adapter = anthropic({ apiKey: KEY, transport });
    for await (const _ of adapter.stream(MODEL, hello, { caps: CAPS })) {
      // Drain the stream with the recording proxy in place.
    }
  } finally {
    process.env = original;
  }
  assert.deepEqual(read, []);
});

test("a request past the end of the mock script throws unexpected_request", async () => {
  const transport = mockTransport("anthropic-messages", []);
  const adapter = anthropic({ apiKey: KEY, transport });
  await assert.rejects(
    async () => {
      for await (const _ of adapter.stream(MODEL, hello, { caps: CAPS })) {
        // Drain.
      }
    },
    (error: unknown) => isGatewayError(error) && error.code === "unexpected_request",
  );
});

/** The text fixture with the usage removed from its `message_delta`, or from every event with `everywhere`. */
function textWithoutUsage(everywhere = false): string {
  return fixture("text.sse")
    .split("\n")
    .map((line) => {
      if (!line.startsWith("data: ")) return line;
      const data = JSON.parse(line.slice(6)) as { type?: string; usage?: unknown; message?: { usage?: unknown } };
      if (data.type === "message_delta") delete data.usage;
      if (everywhere && data.message) delete data.message.usage;
      return `data: ${JSON.stringify(data)}`;
    })
    .join("\n");
}

test("a finished stream whose message_delta carries no usage has unreported usage", async () => {
  const { terminal } = await run([{ body: textWithoutUsage() }]);
  assert.equal(terminal.stopReason, "stop");
  assert.equal(terminal.usage.unreported, true);
});

test("createModel prices a stream that reported no usage as unknown, not as a known zero", async () => {
  const transport = mockTransport("anthropic-messages", [{ body: textWithoutUsage(true) }]);
  const model = createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: MODEL.id });
  const message = await model.complete(hello);
  assert.equal(message.usage.unreported, true);
  assert.deepEqual(message.cost, { total: null, basis: "unknown", currency: "USD" });
});

/** The text fixture cut off after its first text delta, before `message_delta` and `message_stop`. */
function textCutOff(): string {
  const events = fixture("text.sse").split("\n\n");
  const firstDelta = events.findIndex((event) => event.includes("content_block_delta"));
  return events.slice(0, firstDelta + 1).join("\n\n");
}

test("a stream that breaks off after its output began has unreported usage", async () => {
  const { terminal } = await run([{ body: textCutOff() }]);
  assert.equal(terminal.stopReason, "error");
  assert.equal(terminal.usage.unreported, true);
  assert.equal(terminal.usage.uncachedInput, 25);
});

test("createModel prices a stream cut off mid-reply as unknown, not from message_start's output count", async () => {
  const transport = mockTransport("anthropic-messages", [{ body: textCutOff() }]);
  const model = createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: MODEL.id });
  const message = await model.complete(hello);
  assert.deepEqual(message.cost, { total: null, basis: "unknown", currency: "USD" });
});

test("a message_delta whose usage has no output_tokens leaves the usage unreported", async () => {
  const body = fixture("text.sse").replace(
    /"usage":\{"input_tokens":25,"cache_creation_input_tokens":2051,"cache_read_input_tokens":4096,"output_tokens":12,.*\}\}$/m,
    '"usage":{"input_tokens":25}}',
  );
  assert.notEqual(body, fixture("text.sse"));
  const { terminal } = await run([{ body }]);
  assert.equal(terminal.stopReason, "stop");
  assert.equal(terminal.usage.unreported, true);
});

test("an error mid-stream before any content keeps the usage message_start reported", async () => {
  const { terminal } = await run([streamed("overloaded-mid-stream.sse")]);
  assert.equal(terminal.usage.unreported, undefined);
  assert.ok(terminal.usage.uncachedInput > 0);
});

test("a 429's retry-after header becomes the error's retryAfterMs", async () => {
  const { terminal } = await run([{ ...failed(429, "error-rate-limit.json"), headers: { "retry-after": "12" } }]);
  assert.equal(terminal.error?.kind, "retryable");
  assert.equal(terminal.error?.retryAfterMs, 12_000);
});

test("a retry-after HTTP date counts from the response's date header", async () => {
  const headers = { "retry-after": "Thu, 19 Nov 2026 12:00:20 GMT", date: "Thu, 19 Nov 2026 12:00:00 GMT" };
  const { terminal } = await run([{ ...failed(529, "error-overloaded.json"), headers }]);
  assert.equal(terminal.error?.retryAfterMs, 20_000);
});

test("a 429 without retry-after has no retryAfterMs", async () => {
  const { terminal } = await run([failed(429, "error-rate-limit.json")]);
  assert.equal(terminal.error?.retryAfterMs, undefined);
});

test("includeRaw streams each wire event as it arrived, before the events it produced", async () => {
  const off = await run([streamed("parallel-tools.sse")]);
  const on = await run([streamed("parallel-tools.sse")], hello, { includeRaw: true });
  const raw = on.events.filter((event) => event.type === "raw");
  const names = [...fixture("parallel-tools.sse").matchAll(/^event: (\S+)$/gm)].map((match) => match[1]);
  assert.deepEqual(
    raw.map((event) => (event.event as { event: string }).event),
    names,
  );
  assert.equal(on.events[1]?.type, "raw", "the first wire event follows start");
  assert.deepEqual(
    on.events.filter((event) => event.type !== "raw"),
    off.events,
  );
});
