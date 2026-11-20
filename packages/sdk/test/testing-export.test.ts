// The testing export's doubles: autoResponder() and its host-tool deny list, record and replay at the normalised
// boundary, the scripted approval and MCP doubles, and the re-exported fixed-key test signer.
import assert from "node:assert/strict";
import { createModel, type GatewayEvent, type Model, type ModelContext } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { mockTransport, serverSentEvents } from "@buildanagent/gateway/testing";
import {
  type AgentEvent,
  composeInterceptors,
  defineTool,
  hmacSigner,
  type Interceptors,
  isSdkError,
  run,
} from "@buildanagent/sdk";
import {
  autoResponder,
  DEFAULT_DENIED_TOOLS,
  fixedClock,
  type RecordedPair,
  type RecordingErrorCode,
  recordPairs,
  replayPairs,
  ScriptedModel,
  scriptedApprovals,
  scriptedMcpServer,
  sequentialIds,
  synthesizeInput,
  TEST_KEY_ID,
  testSigner,
} from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { determinism, drive, lookup, START, scripted, text } from "./run-helpers.js";

const KEY = "sk-test-not-a-real-key";
const LATER = "2026-12-19T12:00:00.000Z";

function hostTool(name: string) {
  const ran: unknown[] = [];
  const tool = defineTool({
    name,
    description: `The ${name} host tool.`,
    inputSchema: { type: "object", properties: { command: { type: "string" } } },
    async execute(input) {
      ran.push(input);
      return { content: [{ type: "text", text: "ran on the host" }] };
    },
  });
  return { tool, ran };
}

function auto(steps: number, options: Parameters<typeof autoResponder>[0] = {}) {
  const adapter = new ScriptedModel(
    Array.from({ length: steps }, () => autoResponder(options)),
    { idGenerator: sequentialIds("call") },
  );
  return { adapter, model: createModel({ adapter, id: "scripted-model", retries: 0 }) };
}

function isRecordingError(code: RecordingErrorCode) {
  return (error: unknown) => isSdkError(error) && error.name === "RecordingError" && error.code === code;
}

// --- autoResponder() -------------------------------------------------------------------------------------------

for (const name of DEFAULT_DENIED_TOOLS) {
  test(`autoResponder() answers in text when ${name} is the only tool offered`, async () => {
    const host = hostTool(name);
    const { adapter, model } = auto(1);
    const { result } = await drive(
      run({ model, system: "s", input: `use ${name}`, tools: [host.tool], ...determinism() }),
    );
    assert.equal(result.stopReason, "done");
    assert.deepEqual(host.ran, []);
    assert.deepEqual(result.messages.at(-1)?.content, [{ type: "text", text: "Auto responder: done." }]);
    adapter.assertComplete();
  });
}

test("autoResponder() matches the deny list by whole name and ignoring case", async () => {
  const host = hostTool("Bash");
  const { model } = auto(1);
  const { result } = await drive(run({ model, system: "s", input: "go", tools: [host.tool], ...determinism() }));
  assert.equal(result.stopReason, "done");
  assert.deepEqual(host.ran, []);
});

test("autoResponder() adds denyTools strings and patterns to the default list", async () => {
  const deploy = hostTool("deploy");
  const drop = hostTool("drop_table");
  const { model } = auto(1, { denyTools: ["DEPLOY", /^drop_/] });
  const { result } = await drive(
    run({ model, system: "s", input: "go", tools: [deploy.tool, drop.tool], ...determinism() }),
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual([deploy.ran, drop.ran], [[], []]);
});

test("autoResponder() calls the allowed tool with schema-built input, skips host tools, then answers", async () => {
  const bash = hostTool("bash");
  const { adapter, model } = auto(2);
  const { result } = await drive(
    run({ model, system: "s", input: "Where is my order?", tools: [bash.tool, lookup], ...determinism() }),
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(bash.ran, []);
  const call = adapter.calls[0]?.context.tools.map((tool) => tool.name);
  assert.deepEqual(call, ["bash", "lookup"]);
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.deepEqual(toolMessage?.content, [{ type: "text", text: 'order {"order":1} is shipped' }]);
  adapter.assertComplete();
});

test("autoResponder() prefers the tool the user's text names", async () => {
  const other = defineTool({ ...lookup, name: "other" });
  const { adapter, model } = auto(2);
  await drive(run({ model, system: "s", input: "please use lookup", tools: [other, lookup], ...determinism() }));
  const second = adapter.calls[1]?.context.messages[1];
  assert.ok(second?.role === "assistant");
  assert.deepEqual(
    second.content.map((block) => (block.type === "tool_call" ? block.name : block.type)),
    ["lookup"],
  );
});

test("autoResponder() picks the longest tool name the text names as a word, not one inside another name", async () => {
  const v2 = defineTool({ ...lookup, name: "lookup_v2" });
  const { adapter, model } = auto(2);
  await drive(run({ model, system: "s", input: "please use lookup_v2", tools: [lookup, v2], ...determinism() }));
  const second = adapter.calls[1]?.context.messages[1];
  assert.ok(second?.role === "assistant");
  assert.deepEqual(
    second.content.map((block) => (block.type === "tool_call" ? block.name : block.type)),
    ["lookup_v2"],
  );
});

test("autoResponder() denies host tools in any spelling, such as MultiEdit, apply-patch and str_replace_based_edit_tool", async () => {
  for (const name of ["MultiEdit", "apply-patch", "local_shell", "str_replace_based_edit_tool", "NotebookEdit"]) {
    const host = hostTool(name);
    const { model } = auto(1);
    const { result } = await drive(
      run({ model, system: "s", input: `use ${name}`, tools: [host.tool], ...determinism() }),
    );
    assert.equal(result.stopReason, "done", name);
    assert.deepEqual(host.ran, [], name);
  }
});

test("a denyTools pattern with the g or y flag denies every matching tool, on every call", async () => {
  const deploy = hostTool("deploy");
  const prod = hostTool("deploy_prod");
  const rule = /deploy/gy;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { model } = auto(1, { denyTools: [rule] });
    const { result } = await drive(
      run({ model, system: "s", input: "go", tools: [deploy.tool, prod.tool], ...determinism() }),
    );
    assert.equal(result.stopReason, "done");
  }
  assert.deepEqual([deploy.ran, prod.ran], [[], []]);
});

test("synthesizeInput() builds a value from const, enum, default, anyOf and each type", () => {
  const schema = {
    type: "object",
    properties: {
      id: { type: "integer", minimum: 5 },
      email: { type: "string", format: "email" },
      name: { type: ["null", "string"] },
      kind: { enum: ["a", "b"] },
      fixed: { const: 7 },
      limit: { type: "number", default: 10 },
      either: { anyOf: [{ type: "boolean" }, { type: "string" }] },
      tags: { type: "array", items: { type: "string" } },
      nested: { type: "object", properties: { ok: { type: "boolean" } } },
    },
  };
  assert.deepEqual(synthesizeInput(schema), {
    id: 5,
    email: "user@example.com",
    name: "example",
    kind: "a",
    fixed: 7,
    limit: 10,
    either: false,
    tags: ["example"],
    nested: { ok: false },
  });
});

// --- recordPairs() and replayPairs() ----------------------------------------------------------------------------

const MODEL_ID = "claude-opus-5-5";

function anthropicEvents(
  blocks: readonly ({ readonly type: string } & Record<string, unknown>)[],
  stopReason: string,
): string {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: MODEL_ID,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 20, output_tokens: 1 },
      },
    },
    ...blocks,
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ];
  return serverSentEvents(events);
}

const toolTurn = anthropicEvents(
  [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "check." } },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
    },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"ord' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'er": 42}' } },
    { type: "content_block_stop", index: 1 },
  ],
  "tool_use",
);
const answerTurn = anthropicEvents(
  [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Order 42 has shipped." } },
    { type: "content_block_stop", index: 0 },
  ],
  "end_turn",
);

function anthropicModel(): Model {
  const transport = mockTransport("anthropic-messages", [
    { body: toolTurn, chunkSize: 11 },
    { body: answerTurn, chunkSize: 5 },
  ]);
  return createModel({ adapter: anthropic({ apiKey: KEY, transport }), id: MODEL_ID, retries: 0 });
}

function orderRun(model: Model, input = "Where is order 42?") {
  return drive(run({ model, system: "You track orders.", input, tools: [lookup], ...determinism() }));
}

async function recorded(): Promise<{ events: AgentEvent[]; pairs: RecordedPair[] }> {
  const recorder = recordPairs(anthropicModel(), {
    providerVersion: "2026-10-21",
    expiresAt: LATER,
    clock: fixedClock(START),
  });
  const { events, result } = await orderRun(recorder.model);
  assert.equal(result.stopReason, "done");
  return { events, pairs: recorder.pairs() };
}

test("a run recorded on the Anthropic adapter replays through replayPairs() to the same event log", async () => {
  const { events, pairs } = await recorded();
  assert.equal(pairs.length, 2);
  // Written to a fixture and read back, as a committed recording would be.
  const fixture = JSON.parse(JSON.stringify(pairs)) as RecordedPair[];
  const replay = replayPairs(fixture, { clock: fixedClock(START) });
  const replayed = await orderRun(createModel({ adapter: replay, id: replay.modelId, retries: 0 }));
  assert.deepEqual(replayed.events, events);
  replay.assertComplete();
});

test("each pair is stamped with the SDK, provider and model versions and the expiry", async () => {
  const { pairs } = await recorded();
  const { stamp } = pairs[0] as RecordedPair;
  assert.equal(stamp.api, "anthropic-messages");
  assert.equal(stamp.provider, "anthropic");
  assert.equal(stamp.model, MODEL_ID);
  assert.equal(stamp.providerVersion, "2026-10-21");
  assert.match(stamp.sdkVersion, /^\d+\.\d+\.\d+/);
  assert.equal(stamp.recordedAt, START);
  assert.equal(stamp.expiresAt, LATER);
  assert.ok(pairs.every((pair) => pair.response.events.every((event) => (event.type as string) !== "retry")));
});

test("no recorded pair contains an authorization or API-key header, or the key itself", async () => {
  const { pairs: fromAdapter } = await recorded();
  const { model } = scripted([text("ok")]);
  const recorder = recordPairs(model, { providerVersion: "v1", expiresAt: LATER, clock: fixedClock(START) });
  const headers = {
    Authorization: `Bearer ${KEY}`,
    "x-api-key": KEY,
    "X-Goog-Api-Key": KEY,
    "cf-aig-authorization": KEY,
    "Proxy-Authorization": KEY,
    cookie: KEY,
    accept: "text/event-stream",
  };
  const modelOptions = { providerOptions: { headers, apiKey: KEY } };
  await drive(run({ model: recorder.model, system: "s", input: "i", modelOptions, ...determinism() }));
  for (const pairs of [fromAdapter, recorder.pairs()]) {
    const json = JSON.stringify(pairs).toLowerCase();
    assert.ok(!json.includes(KEY), "no pair holds the key");
    for (const name of ["authorization", "x-api-key", "api-key", "apikey", "cookie", "x-goog-api-key"]) {
      assert.ok(!json.includes(`"${name}"`), `no pair holds a ${name} property`);
    }
  }
  assert.deepEqual(recorder.pairs()[0]?.request.options.providerOptions, { headers: { accept: "text/event-stream" } });
});

test("a recorded pair holds no raw provider event, though the caller sees it", async () => {
  const { model: base } = scripted([text("ok")]);
  // A provider's own wire event, which may echo request fields.
  const raw: GatewayEvent = { type: "raw", event: { event: "message_start", data: JSON.stringify({ key: KEY }) } };
  const withRaw: Model = {
    ref: base.ref,
    caps: base.caps,
    price: (usage) => base.price(usage),
    complete: (context, options) => base.complete(context, options),
    async *stream(context, options) {
      for await (const event of base.stream(context, options)) {
        yield raw;
        yield event;
      }
    },
  };
  const recorder = recordPairs(withRaw, { providerVersion: "v1", expiresAt: LATER, clock: fixedClock(START) });
  const context: ModelContext = {
    system: "s",
    messages: [{ role: "user", content: [{ type: "text", text: "i" }] }],
    tools: [],
  };
  const seen: string[] = [];
  for await (const event of recorder.model.stream(context)) seen.push(event.type);
  assert.ok(seen.includes("raw"), "the caller still receives the raw event");
  const [pair] = recorder.pairs();
  assert.ok(pair !== undefined);
  assert.ok(pair.response.events.length > 0);
  assert.ok(pair.response.events.every((event) => event.type !== "raw"));
  assert.ok(!JSON.stringify(pair).includes(KEY), "no pair holds what the raw event carried");
});

test("recordPairs() records a call read through complete(), which stops at the terminal event", async () => {
  const { model } = scripted([text("ok")]);
  const recorder = recordPairs(model, { providerVersion: "v1", expiresAt: LATER, clock: fixedClock(START) });
  const context: ModelContext = {
    system: "s",
    messages: [{ role: "user", content: [{ type: "text", text: "i" }] }],
    tools: [],
  };
  const message = await recorder.model.complete(context);
  assert.equal(message.stopReason, "stop");
  const pairs = recorder.pairs();
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.response.events.at(-1)?.type, "done");
});

test("a recording keeps a tool input that holds an apiKey property, so the replay calls the tool with it", async () => {
  const input = { apiKey: "not-a-credential", order: 1 };
  const { model } = scripted([{ content: [{ type: "tool_call", callId: "", name: "lookup", input }] }, text("ok")]);
  const recorder = recordPairs(model, { providerVersion: "v1", expiresAt: LATER, clock: fixedClock(START) });
  const recordedRun = await orderRun(recorder.model);
  const pairs = JSON.parse(JSON.stringify(recorder.pairs())) as RecordedPair[];
  const done = pairs[0]?.response.events.at(-1);
  assert.ok(done?.type === "done");
  assert.deepEqual(done.message.content, [{ type: "tool_call", callId: "call-1", name: "lookup", input }]);
  const replay = replayPairs(pairs, { clock: fixedClock(START) });
  const replayed = await orderRun(createModel({ adapter: replay, id: replay.modelId, retries: 0 }));
  assert.deepEqual(replayed.events, recordedRun.events);
  replay.assertComplete();
});

test("a model built with request-changing middleware replays through createModel() without it", async () => {
  const prefix = {
    transformParams: async ({ context, options }: { context: ModelContext; options: object }) => ({
      context: { ...context, system: `PREFIX ${context.system}` },
      options,
    }),
  };
  const { model } = scripted([text("ok")], { middleware: [prefix] });
  const recorder = recordPairs(model, { providerVersion: "v1", expiresAt: LATER, clock: fixedClock(START) });
  const recordedRun = await orderRun(recorder.model);
  const replay = replayPairs(recorder.pairs(), { clock: fixedClock(START) });
  const replayed = await orderRun(createModel({ adapter: replay, id: replay.modelId, retries: 0 }));
  assert.deepEqual(replayed.events, recordedRun.events);
  replay.assertComplete();
});

test("an expired recording throws on replay", async () => {
  const { pairs } = await recorded();
  assert.throws(() => replayPairs(pairs, { clock: fixedClock(LATER) }), isRecordingError("recording_expired"));
  assert.throws(
    () => replayPairs(pairs, { clock: fixedClock("2027-01-01T00:00:00.000Z") }),
    isRecordingError("recording_expired"),
  );
});

test("replay refuses pairs whose stamps disagree, an SDK from another release line, or an unexpected stamp", async () => {
  const { pairs } = await recorded();
  const [first, second] = pairs as [RecordedPair, RecordedPair];
  const clock = fixedClock(START);
  const otherModel = [first, { ...second, stamp: { ...second.stamp, model: "claude-other" } }];
  assert.throws(() => replayPairs(otherModel, { clock }), isRecordingError("recording_mismatch"));
  const oldSdk = pairs.map((pair) => ({ ...pair, stamp: { ...pair.stamp, sdkVersion: "0.0.9" } }));
  assert.throws(() => replayPairs(oldSdk, { clock }), isRecordingError("recording_mismatch"));
  assert.throws(
    () => replayPairs(pairs, { clock, expect: { providerVersion: "2027-01-01" } }),
    isRecordingError("recording_mismatch"),
  );
  assert.doesNotThrow(() => replayPairs(pairs, { clock, expect: { provider: "anthropic", model: MODEL_ID } }));
});

test("a replayed call that sends a different request fails the run and assertComplete()", async () => {
  const { pairs } = await recorded();
  const replay = replayPairs(pairs, { clock: fixedClock(START) });
  const { result } = await orderRun(createModel({ adapter: replay, id: replay.modelId, retries: 0 }), "Order 7?");
  assert.equal(result.stopReason, "error");
  assert.throws(
    () => replay.assertComplete(),
    (error: unknown) => {
      assert.ok(isRecordingError("recording_mismatch")(error));
      assert.match((error as Error).message, /call 1 .* at \$\.context\.messages\[0\]/);
      return true;
    },
  );
});

test("replayPairs() refuses an empty or malformed recording, and recordPairs() a bad stamp", async () => {
  assert.throws(() => replayPairs([]), isRecordingError("invalid_recording"));
  assert.throws(() => replayPairs([{} as RecordedPair]), isRecordingError("invalid_recording"));
  for (const broken of [
    { stamp: null, request: {}, response: { events: [] } },
    { stamp: {}, request: null, response: { events: [] } },
  ]) {
    assert.throws(() => replayPairs([broken as unknown as RecordedPair]), isRecordingError("invalid_recording"));
  }
  const { model } = scripted([]);
  assert.throws(
    () => recordPairs(model, { providerVersion: "v1", expiresAt: "soon" }),
    isRecordingError("invalid_recording"),
  );
  assert.throws(
    () => recordPairs(model, { providerVersion: "v1", expiresAt: START, clock: fixedClock(START) }),
    isRecordingError("invalid_recording"),
  );
  assert.throws(
    () => recordPairs(model, { providerVersion: " ", expiresAt: LATER }),
    isRecordingError("invalid_recording"),
  );
});

test("a ScriptedModel stream script refuses events without one terminal at the end", async () => {
  const adapter = new ScriptedModel([{ events: [{ type: "start" }] }]);
  const message = await createModel({ adapter, id: "m", retries: 0 }).complete({ system: "", messages: [], tools: [] });
  assert.equal(message.stopReason, "error");
  assert.match(message.error?.message ?? "", /StreamScript/);
});

test("a stream script that is aborted ends with the blocks that had ended", async () => {
  const { pairs } = await recorded();
  const controller = new AbortController();
  const adapter = new ScriptedModel([pairs[0]?.response as { events: [] }], { ref: { provider: "anthropic" } });
  const context: ModelContext = { system: "", messages: [], tools: [] };
  const seen: string[] = [];
  let last: unknown;
  for await (const event of adapter.stream({ api: "a", provider: "anthropic", id: MODEL_ID }, context, {
    signal: controller.signal,
  })) {
    seen.push(event.type);
    if (event.type === "text_end") controller.abort();
    last = event;
  }
  assert.equal(seen.at(-1), "error");
  const message = (last as { message: { stopReason: string; content: unknown[] } }).message;
  assert.equal(message.stopReason, "aborted");
  assert.deepEqual(message.content, [{ type: "text", text: "Let me check." }]);
});

// --- scriptedApprovals() and testSigner() -----------------------------------------------------------------------

const askEveryCall: Interceptors = {
  beforeToolCall: () => ({ decision: "ask", reason: "a person decides" }),
};

function approvalRun(answers: Parameters<typeof scriptedApprovals>[0], calls: number) {
  const approvals = scriptedApprovals(answers);
  const steps = [
    ...Array.from({ length: calls }, (_, i) => ({
      content: [{ type: "tool_call" as const, callId: `c${i + 1}`, name: "lookup", input: { order: i + 1 } }],
    })),
    text("Done."),
  ];
  const { model } = scripted(steps);
  const started = run({
    model,
    system: "s",
    input: "i",
    tools: [lookup],
    interceptors: composeInterceptors(askEveryCall, approvals),
    signer: testSigner(),
    ...determinism(),
  });
  return { approvals, driven: drive(started) };
}

function toolTexts(messages: readonly { role: string; content: readonly unknown[] }[]): unknown[] {
  return messages.filter((message) => message.role === "tool").map((message) => message.content);
}

test("scriptedApprovals() answers each request in order, and the allowed call runs", async () => {
  const { approvals, driven } = approvalRun([{ decision: "allow" }, { decision: "deny", reason: "not today" }], 2);
  const { result } = await driven;
  assert.equal(result.stopReason, "done");
  assert.deepEqual(
    approvals.requests.map((request) => [request.callId, request.keyId]),
    [
      ["c1", TEST_KEY_ID],
      ["c2", TEST_KEY_ID],
    ],
  );
  const [allowed, denied] = toolTexts(result.messages);
  assert.deepEqual(allowed, [{ type: "text", text: 'order {"order":1} is shipped' }]);
  assert.match(JSON.stringify(denied), /not today/);
  approvals.assertComplete();
});

test("scriptedApprovals() denies a request past its script, and assertComplete() throws", async () => {
  const { approvals, driven } = approvalRun([], 1);
  const { result, events } = await driven;
  assert.equal(result.stopReason, "done");
  assert.ok(events.some((event) => event.type === "hook_error"));
  assert.throws(() => approvals.assertComplete(), /raised 1 approval requests, but the script has 0/);
});

test("scriptedApprovals() assertComplete() throws for an answer that was never used", () => {
  assert.throws(() => scriptedApprovals([{ decision: "allow" }]).assertComplete(), /1 of 1 answers were never used/);
});

test("the SDK's root entry exports no fixed-key test signer", async () => {
  const root: Record<string, unknown> = await import("@buildanagent/sdk");
  assert.ok(!("testSigner" in root) && !("TEST_KEY_ID" in root));
});

test("testSigner() signs the same payload the same way in every process, and verifies it", async () => {
  const payload = new TextEncoder().encode("payload");
  const a = await testSigner().sign(payload);
  const b = await testSigner().sign(payload);
  assert.equal(testSigner().keyId, TEST_KEY_ID);
  assert.equal(a, b);
  assert.equal(await testSigner().verify(TEST_KEY_ID, payload, a), true);
  const real = hmacSigner({ keys: { k1: new Uint8Array(32).fill(3) }, current: "k1" });
  assert.equal(await real.verify(TEST_KEY_ID, payload, a), false);
});

// --- scriptedMcpServer() ----------------------------------------------------------------------------------------

test("scriptedMcpServer() lends namespaced, third-party tools that play their scripted results", async () => {
  const server = scriptedMcpServer({
    name: "docs",
    tools: [
      {
        name: "search",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        results: [(input) => ({ content: [{ type: "text", text: `found ${JSON.stringify(input)}` }] })],
      },
    ],
  });
  const [tool] = server.tools;
  assert.equal(tool?.name, "mcp__docs__search");
  assert.equal(tool?.kind, "dynamic");
  assert.equal(tool?.firstParty, false);
  const { adapter, model } = auto(2);
  const { result } = await drive(run({ model, system: "s", input: "i", tools: server.tools, ...determinism() }));
  assert.equal(result.stopReason, "done");
  assert.deepEqual(server.calls, [{ tool: "mcp__docs__search", input: { query: "example" } }]);
  assert.deepEqual(toolTexts(result.messages), [[{ type: "text", text: 'found {"query":"example"}' }]]);
  server.assertComplete();
  adapter.assertComplete();
});

test("a scripted MCP tool called past its script returns an error result, and assertComplete() throws", async () => {
  const server = scriptedMcpServer({
    name: "docs",
    tools: [{ name: "search", inputSchema: { type: "object" }, results: [] }],
  });
  const { model } = auto(2);
  const { result } = await drive(run({ model, system: "s", input: "i", tools: server.tools, ...determinism() }));
  const toolMessage = result.messages.find((message) => message.role === "tool");
  assert.equal(toolMessage?.role === "tool" && toolMessage.isError, true);
  assert.throws(() => server.assertComplete(), /called 1 more time/);
});

test("scriptedMcpServer() refuses a tool whose namespaced name breaks the tool-name rule", () => {
  assert.throws(
    () => scriptedMcpServer({ name: "my docs", tools: [{ name: "search", inputSchema: {}, results: [] }] }),
    (error: unknown) => isSdkError(error) && error.code === "invalid_tool_definition",
  );
});
