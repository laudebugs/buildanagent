/**
 * The OpenAI-compatible Chat Completions adapter against recorded wire fixtures, over a mock transport.
 *
 * The fixtures in `fixtures/openai-chat/` follow the chunk, usage and error shapes in openai-node v7.49.0's types
 * (`ChatCompletionChunk`, `CompletionUsage`, `APIError`), as of November 2026, because OpenAI's docs host could not be
 * reached. The wording of every error message, and the `reasoning_content` field of a compatible server, are ours.
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
  type StreamOptions,
  TOOL_NAME_RULES,
} from "@buildanagent/gateway";
import { type OpenAIChatConfig, openaiChat } from "@buildanagent/gateway/openai-chat";
import {
  chatCompletionEvents,
  markMockTransport,
  mockTransport,
  type WireResponse,
} from "@buildanagent/gateway/testing";
import { test } from "vitest";

const FIXTURES = fileURLToPath(new URL("./fixtures/openai-chat/", import.meta.url));
const MODEL = { api: "openai-chat", provider: "openai", id: "gpt-5.4-mini" };
const KEY = "sk-test-not-a-real-key";
// The caps createModel() hands the adapter for MODEL, for tests that call stream() directly.
const CAPS = createModel({
  adapter: openaiChat({ apiKey: KEY, transport: mockTransport("openai-chat", []) }),
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

async function run(
  script: WireResponse[],
  context: ModelContext = hello,
  options: StreamOptions = {},
  config: Omit<OpenAIChatConfig, "apiKey" | "transport"> = {},
) {
  const transport = mockTransport("openai-chat", script);
  const adapter = openaiChat({ apiKey: KEY, transport, ...config });
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

type WireMessage = { role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string };

function messagesOf(transport: ReturnType<typeof mockTransport>, n = 0): WireMessage[] {
  return bodyOf(transport, n).messages as WireMessage[];
}

type WireFunction = { name: string; parameters: Record<string, unknown>; strict?: boolean; description?: string };

function toolsOf(transport: ReturnType<typeof mockTransport>): WireFunction[] {
  return (bodyOf(transport).tools as { type: string; function: WireFunction }[]).map((tool) => {
    assert.equal(tool.type, "function");
    return tool.function;
  });
}

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

// Stream contract ----------------------------------------------------------------------------------------------------

const streamFixtures = readdirSync(FIXTURES).filter((name) => name.endsWith(".sse"));

test.each(streamFixtures)("the %s fixture passes assertStreamContract at every chunk size", async (name) => {
  for (const chunkSize of [1, 3, 64, 100_000]) {
    await run([streamed(name, chunkSize)], { ...hello, tools: [weatherTool] });
  }
});

test.each(readdirSync(FIXTURES).filter((name) => name.endsWith(".json")))(
  "the %s error response passes assertStreamContract",
  async (name) => {
    await run([failed(400, name)]);
  },
);

// Requests -----------------------------------------------------------------------------------------------------------

test("baseURL and transport reach every request", async () => {
  const transport = mockTransport("openai-chat", [streamed("text.sse"), streamed("text.sse")]);
  const adapter = openaiChat({ apiKey: KEY, baseURL: "http://127.0.0.1:9/proxy/v1/", transport });
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  assert.deepEqual(
    transport.requests.map((request) => request.url),
    ["http://127.0.0.1:9/proxy/v1/chat/completions", "http://127.0.0.1:9/proxy/v1/chat/completions"],
  );
});

test("the default base URL is OpenAI's v1 endpoint", async () => {
  const { transport } = await run([streamed("text.sse")]);
  assert.equal(transport.requests[0]?.url, "https://api.openai.com/v1/chat/completions");
});

test("the key goes out as a bearer token, and caller key headers are dropped", async () => {
  const headers = {
    Authorization: "Bearer caller",
    "Api-Key": "caller",
    "X-Api-Key": "caller",
    "OpenAI-Project": "p1",
  };
  const { transport } = await run([streamed("text.sse")], hello, {}, { headers });
  const sent = transport.requests[0]?.headers ?? {};
  assert.equal(sent.authorization, `Bearer ${KEY}`);
  assert.equal("api-key" in sent, false);
  assert.equal("x-api-key" in sent, false);
  assert.equal(sent["openai-project"], "p1");
  assert.equal(sent.accept, "text/event-stream");
});

test("the body streams, asks for usage and sets max_completion_tokens from the catalog", async () => {
  const { transport } = await run([streamed("text.sse")]);
  const body = bodyOf(transport);
  assert.equal(body.model, "gpt-5.4-mini");
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.max_completion_tokens, 128_000);
  assert.equal("max_tokens" in body, false);
  assert.deepEqual(body.messages, [
    { role: "system", content: "You are terse." },
    { role: "user", content: "Hello" },
  ]);
});

test("maxOutputTokens sets the output limit", async () => {
  const { transport } = await run([streamed("text.sse")], hello, { maxOutputTokens: 512 });
  assert.equal(bodyOf(transport).max_completion_tokens, 512);
});

test("compat flags pick max_tokens, the developer role and no usage chunk", async () => {
  const compat = { maxTokensField: "max_tokens", systemRole: "developer", streamUsage: false } as const;
  const { transport } = await run([streamed("text.sse")], hello, {}, { compat });
  const body = bodyOf(transport);
  assert.equal(body.max_tokens, 128_000);
  assert.equal("max_completion_tokens" in body, false);
  assert.equal("stream_options" in body, false);
  assert.equal(messagesOf(transport)[0]?.role, "developer");
});

test("a model's own compat entry overrides the adapter's, flag by flag", async () => {
  const transport = mockTransport("openai-chat", [streamed("text.sse"), streamed("text.sse")]);
  const adapter = openaiChat({
    apiKey: KEY,
    transport,
    compat: { maxTokensField: "max_tokens", systemRole: "developer" },
    modelCompat: { "gpt-5.4-mini": { systemRole: "system" } },
  });
  await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS }));
  await assertStreamContract(adapter.stream({ ...MODEL, id: "other" }, hello, { caps: CAPS }));
  assert.equal(messagesOf(transport, 0)[0]?.role, "system");
  assert.equal(bodyOf(transport, 0).max_tokens, 128_000);
  assert.equal(messagesOf(transport, 1)[0]?.role, "developer");
});

test("temperature is sent unless the model's compat says it is not accepted", async () => {
  const sent = await run([streamed("text.sse")], hello, { temperature: 0.2 });
  assert.equal(bodyOf(sent.transport).temperature, 0.2);
  assert.deepEqual(warnings(sent.events), []);
  const dropped = await run([streamed("text.sse")], hello, { temperature: 0.2 }, { compat: { temperature: false } });
  assert.equal("temperature" in bodyOf(dropped.transport), false);
  assert.deepEqual(
    warnings(dropped.events).map((event) => event.code),
    ["unsupported_option"],
  );
});

test("extraBody adds fields such as reasoning_effort, but cannot override the adapter's own", async () => {
  const extraBody = { reasoning_effort: "low", prompt_cache_key: "k1", stream: false, max_completion_tokens: 1 };
  const { events, transport } = await run([streamed("text.sse")], hello, {
    providerOptions: { openaiChat: { extraBody } },
  });
  const body = bodyOf(transport);
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.prompt_cache_key, "k1");
  assert.equal(body.stream, true);
  assert.equal(body.max_completion_tokens, 128_000);
  const [warning] = warnings(events);
  assert.equal(warning?.code, "unsupported_option");
  assert.match(warning?.message ?? "", /stream, max_completion_tokens/);
});

const history: Message[] = [
  { role: "user", content: [{ type: "text", text: "Weather in SF and Zürich?" }] },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "Two cities, two calls." },
      { type: "text", text: "Checking." },
      { type: "tool_call", callId: "call_a", name: "get_weather", input: { location: "SF" } },
      { type: "tool_call", callId: "call_b", name: "get_weather", input: { location: "Zürich" } },
    ],
    model: MODEL,
    stopReason: "tool_calls",
    usage: { uncachedInput: 1, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 1, reasoning: 0, raw: null },
    cost: { total: null, basis: "unknown", currency: "USD" },
  },
  { role: "tool", callId: "call_a", content: [{ type: "text", text: "18°C" }], isError: false },
  {
    role: "tool",
    callId: "call_b",
    content: [
      { type: "text", text: "radar" },
      { type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
    ],
    isError: false,
  },
];

test("history encodes as tool_calls, tool messages and a user message for the results' images", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    { system: "", messages: history, tools: [weatherTool] },
    { caps: { ...CAPS, images: true } },
  );
  assert.deepEqual(messagesOf(transport), [
    { role: "user", content: "Weather in SF and Zürich?" },
    {
      role: "assistant",
      content: "Checking.",
      tool_calls: [
        { id: "call_a", type: "function", function: { name: "get_weather", arguments: '{"location":"SF"}' } },
        { id: "call_b", type: "function", function: { name: "get_weather", arguments: '{"location":"Zürich"}' } },
      ],
    },
    { role: "tool", tool_call_id: "call_a", content: "18°C" },
    { role: "tool", tool_call_id: "call_b", content: "radar" },
    {
      role: "user",
      content: [
        { type: "text", text: "The images below are part of the tool results above." },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    },
  ]);
});

test("an image in a user message encodes as a data URL", async () => {
  const context: ModelContext = {
    system: "",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image", mediaType: "image/jpeg", data: "/9j/4AAQ" },
        ],
      },
    ],
    tools: [],
  };
  const { transport } = await run([streamed("text.sse")], context);
  assert.deepEqual(messagesOf(transport)[0]?.content, [
    { type: "text", text: "What is this?" },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,/9j/4AAQ" } },
  ]);
});

// Tools --------------------------------------------------------------------------------------------------------------

test("a tool is sent strict: every property required, optional ones nullable, rejected keywords removed", async () => {
  const { transport } = await run([streamed("text.sse")], { ...hello, tools: [weatherTool] });
  const [tool] = toolsOf(transport);
  assert.equal(tool?.name, "get_weather");
  assert.equal(tool?.strict, true);
  assert.deepEqual(tool?.parameters, {
    type: "object",
    properties: {
      location: { type: "string" },
      unit: { anyOf: [{ type: "string", enum: ["celsius", "fahrenheit"] }, { type: "null" }] },
    },
    required: ["location", "unit"],
    additionalProperties: false,
  });
});

test("an optional $ref and an optional plain type get their own null forms", async () => {
  const tool = {
    name: "plan",
    description: "",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string" }, step: { $ref: "#/$defs/step" } },
      $defs: { step: { type: "object", properties: { n: { type: "integer" } }, required: ["n"] } },
    },
  };
  const { transport } = await run([streamed("text.sse")], { ...hello, tools: [tool] });
  const [sent] = toolsOf(transport);
  assert.deepEqual(sent?.parameters.properties, {
    note: { type: ["string", "null"] },
    step: { anyOf: [{ $ref: "#/$defs/step" }, { type: "null" }] },
  });
});

test("a tool whose schema strict mode cannot express is sent as it is, without strict", async () => {
  const open = { name: "tag", description: "", inputSchema: { type: "object", additionalProperties: true } };
  const rootless = { name: "any", description: "", inputSchema: { properties: { a: { type: "string" } } } };
  const { transport } = await run([streamed("text.sse")], { ...hello, tools: [open, rootless] });
  for (const [i, tool] of toolsOf(transport).entries()) {
    assert.equal("strict" in tool, false);
    assert.deepEqual(tool.parameters, [open, rootless][i]?.inputSchema);
  }
});

test("compat strictTools false sends every tool without strict", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    { ...hello, tools: [weatherTool] },
    {},
    {
      compat: { strictTools: false },
    },
  );
  const [tool] = toolsOf(transport);
  assert.equal("strict" in (tool ?? {}), false);
  assert.deepEqual(tool?.parameters, weatherTool.inputSchema);
});

test("an optional field the model sends as the null strict lowering added reaches validation absent", async () => {
  const { terminal } = await run([streamed("parallel-tools.sse")], { ...hello, tools: [weatherTool] });
  const [first] = terminal.content.filter((block) => block.type === "tool_call");
  assert.deepEqual(first?.type === "tool_call" ? first.input : undefined, { location: "San Francisco, CA" });
});

test("a null the original schema allows is kept", async () => {
  const nullable = {
    ...weatherTool,
    inputSchema: {
      ...weatherTool.inputSchema,
      properties: { ...weatherTool.inputSchema.properties, unit: { type: ["string", "null"] } },
    },
  };
  const { terminal } = await run([streamed("parallel-tools.sse")], { ...hello, tools: [nullable] });
  const [first] = terminal.content.filter((block) => block.type === "tool_call");
  assert.deepEqual(first?.type === "tool_call" ? first.input : undefined, {
    location: "San Francisco, CA",
    unit: null,
  });
});

test("a tool sent without strict keeps the model's nulls", async () => {
  const { terminal } = await run(
    [streamed("parallel-tools.sse")],
    { ...hello, tools: [weatherTool] },
    {},
    {
      compat: { strictTools: false },
    },
  );
  const [first] = terminal.content.filter((block) => block.type === "tool_call");
  assert.deepEqual(first?.type === "tool_call" ? first.input : undefined, {
    location: "San Francisco, CA",
    unit: null,
  });
});

test("a tool name that clashes by case is sanitised on the way out and restored on the way back", async () => {
  const tools = [weatherTool, { ...weatherTool, name: "Get_Weather" }];
  const wire = createToolNameMap(TOOL_NAME_RULES.openaiChat, ["get_weather", "Get_Weather"]).sanitize("get_weather");
  assert.notEqual(wire, "get_weather");
  const sse = fixture("parallel-tools.sse").replaceAll('"name":"get_weather"', `"name":"${wire}"`);
  const { transport, terminal } = await run([{ body: sse, chunkSize: 5 }], { ...hello, tools });
  assert.deepEqual(
    toolsOf(transport).map((tool) => tool.name),
    [wire, "Get_Weather"],
  );
  const calls = terminal.content.filter((block) => block.type === "tool_call");
  assert.deepEqual(
    calls.map((block) => block.name),
    ["get_weather", "get_weather"],
  );
  assert.deepEqual(calls[0]?.input, { location: "San Francisco, CA" }, "the restored name finds the strict schema");
});

// Caching ------------------------------------------------------------------------------------------------------------

test("by default no caching field is sent, because the server caches prefixes on its own", async () => {
  for (const cacheRetention of ["none", "short", "long"] as const) {
    const { transport } = await run([streamed("text.sse")], hello, { cacheRetention });
    const body = JSON.stringify(bodyOf(transport));
    assert.equal(/prompt_cache/.test(body), false, cacheRetention);
  }
});

test("with cache breakpoints, short retention marks the system prompt and the newest user message", async () => {
  const { transport } = await run([streamed("text.sse")], hello, {}, { compat: { cacheBreakpoints: true } });
  const breakpoint = { mode: "explicit" };
  assert.deepEqual(messagesOf(transport), [
    { role: "system", content: [{ type: "text", text: "You are terse.", prompt_cache_breakpoint: breakpoint }] },
    { role: "user", content: [{ type: "text", text: "Hello", prompt_cache_breakpoint: breakpoint }] },
  ]);
  assert.equal("prompt_cache_options" in bodyOf(transport), false);
});

test("with cache breakpoints, long retention asks for 12-hour breakpoints", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    hello,
    { cacheRetention: "long" },
    {
      compat: { cacheBreakpoints: true },
    },
  );
  const breakpoint = { mode: "explicit", ttl: "12h" };
  for (const message of messagesOf(transport)) {
    assert.deepEqual(
      (message.content as { prompt_cache_breakpoint?: unknown }[]).at(-1)?.prompt_cache_breakpoint,
      breakpoint,
    );
  }
});

test("with cache breakpoints and no system prompt, only the newest user or tool message is marked", async () => {
  const context: ModelContext = { system: "", messages: history.slice(0, 3), tools: [weatherTool] };
  const { transport } = await run([streamed("text.sse")], context, {}, { compat: { cacheBreakpoints: true } });
  const marked = messagesOf(transport).filter((message) => JSON.stringify(message).includes("prompt_cache_breakpoint"));
  assert.deepEqual(
    marked.map((message) => message.role),
    ["tool"],
  );
});

test("with cache breakpoints, no retention turns the cache off with explicit mode", async () => {
  const { transport } = await run(
    [streamed("text.sse")],
    hello,
    { cacheRetention: "none" },
    {
      compat: { cacheBreakpoints: true },
    },
  );
  const body = bodyOf(transport);
  assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
  assert.equal(JSON.stringify(body).includes("prompt_cache_breakpoint"), false);
});

test("promptCacheRetention sends 24h retention for long retention only", async () => {
  const compat = { promptCacheRetention: true };
  const long = await run([streamed("text.sse")], hello, { cacheRetention: "long" }, { compat });
  assert.equal(bodyOf(long.transport).prompt_cache_retention, "24h");
  const short = await run([streamed("text.sse")], hello, { cacheRetention: "short" }, { compat });
  assert.equal("prompt_cache_retention" in bodyOf(short.transport), false);
});

// Responses ----------------------------------------------------------------------------------------------------------

test("a text stream maps its content and its four token classes", async () => {
  const { terminal } = await run([streamed("text.sse", 1)]);
  assert.equal(terminal.stopReason, "stop");
  assert.deepEqual(terminal.content, [{ type: "text", text: "Héllo, wörld ✓" }]);
  assert.deepEqual(
    { ...terminal.usage, raw: undefined },
    { uncachedInput: 52, cacheRead: 2048, cacheWrite: { "5m": 0, "1h": 0 }, output: 12, reasoning: 0, raw: undefined },
  );
  assert.equal(terminal.cost.basis, "unknown", "the response carries no billed price");
});

test("reasoning_tokens map into Usage.reasoning, inside output", async () => {
  const { terminal } = await run([streamed("reasoning.sse")]);
  assert.equal(terminal.usage.output, 320);
  assert.equal(terminal.usage.reasoning, 290);
  assert.deepEqual(terminal.content, [{ type: "text", text: "The GCD is 21." }]);
});

test("a compatible server's reasoning_content becomes an unsigned reasoning block before the text", async () => {
  const { terminal } = await run([streamed("reasoning-content.sse", 3)]);
  assert.deepEqual(terminal.content, [
    { type: "reasoning", text: "1071 = 2 × 462 + 147\n462 = 3 × 147 + 21" },
    { type: "text", text: "21" },
  ]);
});

test("cache writes count under the 5m key for short retention", async () => {
  const { terminal } = await run([streamed("cache-write.sse")]);
  assert.deepEqual(terminal.usage.cacheWrite, { "5m": 4096, "1h": 0 });
  assert.equal(terminal.usage.uncachedInput, 904);
});

test("cache writes count under the 1h key for 12-hour breakpoints", async () => {
  const { terminal } = await run(
    [streamed("cache-write.sse")],
    hello,
    { cacheRetention: "long" },
    {
      compat: { cacheBreakpoints: true },
    },
  );
  assert.deepEqual(terminal.usage.cacheWrite, { "5m": 0, "1h": 4096 });
});

test("parallel tool calls stream as two tool inputs and end with tool_calls", async () => {
  const { events, terminal } = await run([streamed("parallel-tools.sse", 3)], { ...hello, tools: [weatherTool] });
  assert.equal(terminal.stopReason, "tool_calls");
  assert.deepEqual(terminal.content, [
    { type: "tool_call", callId: "call_Ab12Cd34Ef56", name: "get_weather", input: { location: "San Francisco, CA" } },
    {
      type: "tool_call",
      callId: "call_Gh78Ij90Kl12",
      name: "get_weather",
      input: { location: "Zürich", unit: "celsius" },
    },
  ]);
  const deltas = events.filter((event) => event.type === "tool_input_delta" && event.index === 1);
  assert.equal(
    deltas.map((event) => (event.type === "tool_input_delta" ? event.delta : "")).join(""),
    '{"location": "Zürich", "unit": "celsius"}',
  );
});

test("a length stop yields stopReason length with the partial tool input", async () => {
  const { terminal } = await run([streamed("length.sse")]);
  assert.equal(terminal.stopReason, "length");
  assert.deepEqual(terminal.content, [
    {
      type: "tool_call",
      callId: "call_LengthCut01",
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
  const { transport } = await run([streamed("text.sse")], context);
  const calls = messagesOf(transport)[2]?.tool_calls as { function: { arguments: string } }[];
  assert.equal(calls[0]?.function.arguments, "{}");
});

test("a content_filter finish ends in a fatal error terminal with the partial text", async () => {
  const { terminal } = await run([streamed("content-filter.sse")]);
  assert.equal(terminal.stopReason, "error");
  assert.equal(terminal.error?.kind, "fatal");
  assert.match(terminal.error?.message ?? "", /^content_filter: /);
  assert.deepEqual(terminal.content, [{ type: "text", text: "Here is how" }]);
});

test("a refusal delta ends in a fatal error terminal that quotes it", async () => {
  const body = chatCompletionEvents([
    { choices: [{ index: 0, delta: { role: "assistant", refusal: "I can't help " }, finish_reason: null }] },
    { choices: [{ index: 0, delta: { refusal: "with that." }, finish_reason: "stop" }] },
  ]);
  const { terminal } = await run([{ body, chunkSize: 9 }]);
  assert.equal(terminal.error?.kind, "fatal");
  assert.equal(terminal.error?.message, "refusal: I can't help with that.");
});

test("a server that ends tool calls with stop still yields tool_calls", async () => {
  const body = fixture("parallel-tools.sse").replace('"finish_reason":"tool_calls"', '"finish_reason":"stop"');
  const { terminal } = await run([{ body }], { ...hello, tools: [weatherTool] });
  assert.equal(terminal.stopReason, "tool_calls");
});

test("chatCompletionEvents writes chunks the adapter reads, ending in [DONE]", async () => {
  const body = chatCompletionEvents([
    { choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } },
  ]);
  assert.ok(body.endsWith("data: [DONE]\n\n"));
  const { terminal } = await run([{ body }]);
  assert.deepEqual(terminal.content, [{ type: "text", text: "Hi" }]);
  assert.equal(terminal.usage.uncachedInput, 3);
});

// Errors -------------------------------------------------------------------------------------------------------------

const errorCases: [string, number, string, NonNullable<AssistantMessage["error"]>["kind"]][] = [
  ["rate limit", 429, "error-rate-limit.json", "retryable"],
  ["insufficient quota", 429, "error-insufficient-quota.json", "quota"],
  ["context length", 400, "error-context-length.json", "overflow"],
  ["authentication", 401, "error-authentication.json", "fatal"],
  ["invalid schema", 400, "error-invalid-schema.json", "fatal"],
  ["server error", 500, "error-server.json", "retryable"],
  ["overloaded", 503, "error-overloaded.json", "retryable"],
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

test("an error message starts with the error code", async () => {
  const { terminal } = await run([failed(429, "error-insufficient-quota.json")]);
  assert.match(terminal.error?.message ?? "", /^insufficient_quota: You exceeded your current quota/);
});

test("an error body that is not JSON keeps its text as the message", async () => {
  const { terminal } = await run([{ status: 502, body: "Bad gateway", headers: { "content-type": "text/plain" } }]);
  assert.equal(terminal.error?.kind, "retryable");
  assert.equal(terminal.error?.message, "Bad gateway");
});

test("an error chunk mid-stream is a retryable error terminal with the partial text", async () => {
  const { terminal } = await run([streamed("error-mid-stream.sse")]);
  assert.equal(terminal.stopReason, "error");
  assert.equal(terminal.error?.kind, "retryable");
  assert.equal(terminal.error?.status, undefined);
  assert.match(terminal.error?.message ?? "", /^server_error: /);
  assert.deepEqual(terminal.content, [{ type: "text", text: "Partial" }]);
});

test("an SSE event named error is an error terminal too", async () => {
  const body = 'event: error\ndata: {"message":"bad request","type":"invalid_request_error"}\n\n';
  const { terminal } = await run([{ body }]);
  assert.equal(terminal.error?.kind, "fatal");
  assert.equal(terminal.error?.message, "invalid_request_error: bad request");
});

test("createModel retries a mid-stream error and prices the reply from the catalog", async () => {
  const transport = mockTransport("openai-chat", [failed(500, "error-server.json"), streamed("text.sse")]);
  const model = createModel({ adapter: openaiChat({ apiKey: KEY, transport }), id: MODEL.id, sleep: async () => {} });
  const events = await assertStreamContract(model.stream(hello));
  assert.equal(events.filter((event) => event.type === "retry").length, 1);
  const message = terminalOf(events);
  assert.equal(message.stopReason, "stop");
  assert.equal(message.cost.basis, "catalog");
  assert.ok((message.cost.total ?? 0) > 0);
});

test("a stream that closes before [DONE] and before a finish reason is a retryable error", async () => {
  const cut = fixture("text.sse").split('"finish_reason":"stop"')[0]?.split("\n\n").slice(0, -1).join("\n\n");
  const { terminal } = await run([{ body: `${cut}\n\n`, chunkSize: 4 }]);
  assert.equal(terminal.error?.kind, "retryable");
  assert.deepEqual(terminal.content, [{ type: "text", text: "Héllo, wörld ✓" }]);
});

test("a stream that closes after its finish reason without [DONE] ends normally", async () => {
  const { terminal } = await run([{ body: fixture("text.sse").replace("data: [DONE]\n\n", "") }]);
  assert.equal(terminal.stopReason, "stop");
  assert.equal(terminal.usage.cacheRead, 2048);
});

test("malformed chunk data ends in a fatal error terminal", async () => {
  const { terminal } = await run([{ body: "data: {not json\n\n" }]);
  assert.equal(terminal.error?.kind, "fatal");
});

test("a transport that throws ends in a retryable error terminal", async () => {
  const transport = async (): Promise<Response> => {
    throw new TypeError("fetch failed");
  };
  const adapter = openaiChat({ apiKey: KEY, transport: markMockTransport(transport) });
  const terminal = terminalOf(await assertStreamContract(adapter.stream(MODEL, hello, { caps: CAPS })));
  assert.equal(terminal.error?.kind, "retryable");
});

test("an abort mid-stream ends in an aborted terminal with the content so far", async () => {
  const controller = new AbortController();
  const transport = mockTransport("openai-chat", [streamed("text.sse", 16)]);
  const adapter = openaiChat({ apiKey: KEY, transport });
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
    () => openaiChat({ apiKey: " " }),
    (error: unknown) => isGatewayError(error) && error.code === "missing_api_key",
  );
});

test("the provider name selects the catalog entry, and an unknown model gets the default caps", async () => {
  const transport = mockTransport("openai-chat", [streamed("text.sse")]);
  const adapter = openaiChat({ apiKey: KEY, transport, provider: "local-vllm" });
  assert.equal(adapter.provider, "local-vllm");
  const model = createModel({ adapter, id: "qwen-coder" });
  assert.deepEqual(model.caps, adapter.defaultCaps);
  await assertStreamContract(model.stream(hello));
  assert.equal(bodyOf(transport).max_completion_tokens, adapter.defaultCaps?.maxOutputTokens);
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
    const transport = mockTransport("openai-chat", [streamed("parallel-tools.sse")]);
    const adapter = openaiChat({ apiKey: KEY, transport });
    for await (const _ of adapter.stream(MODEL, { ...hello, tools: [weatherTool] }, { caps: CAPS })) {
      // Drain the stream with the recording proxy in place.
    }
  } finally {
    process.env = original;
  }
  assert.deepEqual(read, []);
});
