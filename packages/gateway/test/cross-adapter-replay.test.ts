/**
 * The replay pass across the two wire adapters: one transcript, recorded through the Anthropic adapter, continued
 * through the OpenAI-compatible adapter and sent back, with every request checked against the shape its protocol
 * accepts. Offline, over mock transports and the adapters' recorded fixtures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AssistantMessage,
  assertStreamContract,
  createModel,
  type Message,
  type ModelAdapter,
  type ModelContext,
} from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";
import { mockTransport, type RecordedRequest, type WireApi } from "@buildanagent/gateway/testing";
import { test } from "vitest";

type Json = Record<string, unknown>;

const KEY = "sk-test-not-a-real-key";
const ID_RULE = /^[A-Za-z0-9_-]{1,64}$/;

function fixture(api: WireApi, name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${api}/${name}`, import.meta.url)), "utf8");
}

const weatherTool = {
  name: "get_weather",
  description: "Get the weather",
  inputSchema: {
    type: "object",
    properties: { location: { type: "string" }, unit: { type: "string", enum: ["celsius", "fahrenheit"] } },
    required: ["location"],
  },
};

/** Sends one call through `createModel()` over a mock transport; returns the reply and the request the mock saw. */
async function call(
  api: WireApi,
  build: (transport: ReturnType<typeof mockTransport>) => ModelAdapter,
  id: string,
  messages: Message[],
  reply: string,
): Promise<{ reply: AssistantMessage; request: RecordedRequest }> {
  const transport = mockTransport(api, [{ body: fixture(api, reply), chunkSize: 11 }]);
  const model = createModel({ adapter: build(transport), id });
  const context: ModelContext = { system: "You check the weather.", messages, tools: [weatherTool] };
  const events = await assertStreamContract(model.stream(context));
  const last = events.at(-1);
  assert.ok(last?.type === "done", `the ${api} call ends with done`);
  const request = transport.requests[0];
  assert.ok(request !== undefined);
  return { reply: last.message, request };
}

const viaAnthropic = (messages: Message[], reply: string) =>
  call("anthropic-messages", (transport) => anthropic({ apiKey: KEY, transport }), "claude-opus-5-5", messages, reply);
const viaOpenAI = (messages: Message[], reply: string) =>
  call("openai-chat", (transport) => openaiChat({ apiKey: KEY, transport }), "gpt-5.4-mini", messages, reply);

function user(text: string): Message {
  return { role: "user", content: [{ type: "text", text }] };
}

/** A text result for every tool call in the reply. */
function results(reply: AssistantMessage): Message[] {
  return reply.content.flatMap((block): Message[] =>
    block.type === "tool_call"
      ? [{ role: "tool", callId: block.callId, content: [{ type: "text", text: "18°C" }], isError: false }]
      : [],
  );
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a Chat Completions body: tool calls answered in order right after their turn, no reasoning, valid ids. */
function assertValidChatBody(body: unknown): void {
  assert.ok(isObject(body) && Array.isArray(body.messages));
  const tools = new Set((body.tools as { function: { name: string } }[]).map((tool) => tool.function.name));
  const messages = body.messages as Json[];
  assert.equal(JSON.stringify(body).match(/thinking|signature|reasoning/), null, "no reasoning reaches the wire");
  let waiting: string[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      assert.equal(message.tool_call_id, waiting.shift(), "a tool message answers the next waiting call");
      assert.equal(typeof message.content, "string");
      continue;
    }
    assert.deepEqual(waiting, [], "every call is answered before the next message");
    assert.ok(["system", "user", "assistant"].includes(String(message.role)));
    const calls = Array.isArray(message.tool_calls) ? (message.tool_calls as Json[]) : [];
    for (const toolCall of calls) {
      const fn = toolCall.function as { name: string; arguments: string };
      assert.match(String(toolCall.id), ID_RULE);
      assert.ok(tools.has(fn.name), `${fn.name} is a declared tool`);
      assert.ok(isObject(JSON.parse(fn.arguments)), "arguments are a JSON object");
    }
    waiting = calls.map((toolCall) => String(toolCall.id));
  }
  assert.deepEqual(waiting, []);
}

/** Checks a Messages body: roles alternate from a user, every tool_use is answered in the next user message first. */
function assertValidMessagesBody(body: unknown): void {
  assert.ok(isObject(body) && Array.isArray(body.messages));
  const messages = body.messages as { role: string; content: Json[] }[];
  const tools = new Set((body.tools as { name: string }[]).map((tool) => tool.name));
  messages.forEach((message, i) => {
    assert.equal(message.role, i % 2 === 0 ? "user" : "assistant", `message ${i} alternates roles`);
    if (message.role !== "assistant") return;
    for (const block of message.content) {
      if (block.type === "thinking") assert.ok(typeof block.signature === "string" && block.signature !== "");
      assert.notEqual(block.type, "reasoning");
    }
    const uses = message.content.filter((block) => block.type === "tool_use");
    for (const use of uses) {
      assert.match(String(use.id), ID_RULE);
      assert.ok(tools.has(String(use.name)));
    }
    const answers = (messages[i + 1]?.content ?? []).slice(0, uses.length);
    assert.deepEqual(
      answers.map((block) => [block.type, block.tool_use_id]),
      uses.map((use) => ["tool_result", use.id]),
      `the tool_use blocks of message ${i} are answered first in the next user message`,
    );
  });
}

test("a transcript recorded on Anthropic replays to OpenAI and back, with a valid request each way", async () => {
  // Two Anthropic turns: signed thinking with text, then two parallel tool calls.
  const first = await viaAnthropic([user("GCD of 1071 and 462?")], "reasoning.sse");
  const transcript: Message[] = [user("GCD of 1071 and 462?"), first.reply, user("Weather in SF and Zürich?")];
  const second = await viaAnthropic(transcript, "parallel-tools.sse");
  transcript.push(second.reply, ...results(second.reply));

  // OpenAI continues the conversation: Anthropic's thinking is dropped and its tool calls are sent as tool_calls.
  const third = await viaOpenAI([...transcript, user("And Paris?")], "parallel-tools.sse");
  assertValidChatBody(third.request.body);
  const chat = (third.request.body as { messages: Json[] }).messages;
  assert.equal(chat.filter((message) => message.role === "tool").length, 2);
  transcript.push(user("And Paris?"), third.reply, ...results(third.reply));

  // Back to Anthropic: its own signed thinking survives, and OpenAI's calls arrive as tool_use blocks.
  const fourth = await viaAnthropic([...transcript, user("Thanks.")], "text.sse");
  assertValidMessagesBody(fourth.request.body);
  const wire = (fourth.request.body as { messages: { content: Json[] }[] }).messages;
  const thinking = wire.flatMap((message) => message.content.filter((block) => block.type === "thinking"));
  assert.equal(thinking.length, 1, "the first turn's signed thinking is replayed to Anthropic");
  const uses = wire.flatMap((message) => message.content.filter((block) => block.type === "tool_use"));
  assert.deepEqual(
    uses.map((use) => String(use.id).slice(0, 5)),
    ["toolu", "toolu", "call_", "call_"],
  );
});

test("a compatible server's unsigned reasoning is dropped when the transcript goes to Anthropic", async () => {
  const openai = await viaOpenAI([user("GCD of 1071 and 462?")], "reasoning-content.sse");
  assert.equal(openai.reply.content[0]?.type, "reasoning");
  const back = await viaAnthropic([user("GCD of 1071 and 462?"), openai.reply, user("Why?")], "text.sse");
  assertValidMessagesBody(back.request.body);
  assert.equal(JSON.stringify(back.request.body).includes("1071 = 2"), false);
});
