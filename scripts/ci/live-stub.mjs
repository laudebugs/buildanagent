// A stand-in for the Anthropic Messages API and the OpenAI Responses API on the loopback interface, for the live run's
// tests (live-run.test.mjs). It answers each request with the next turn of a script, in the provider's own JSON or
// server-sent events, and records what it received, so a test can check that the key arrived in the right header.
// Its answers carry the headers a real provider adds about the account and the request, so a test can check that
// none of them reaches a written file or a log. It never forwards a request anywhere.
import { createServer } from "node:http";

/** Identifiers a real provider would send, in the shapes redact.ts looks for. */
export const STUB_IDS = {
  requestId: "req_011CStubRequestId0123456789",
  organization: "org-StubOrganization0123456789",
  anthropicOrganization: "0d4b5ad1-3f0e-4c0a-9b1e-5f4e3d2c1b0a",
  workspace: "wrkspc_01StubWorkspace0123456789",
};

/** A turn's tool calls or text as the mock transcript's response parts give them. */
export function turnsFromTranscript(transcript) {
  return transcript.events
    .filter((event) => event.kind === "response")
    .map((event) => {
      const calls = event.message.parts.filter((part) => part.type === "tool-call");
      if (calls.length > 0) return { tools: calls.map((call) => ({ name: call.name, input: call.input })) };
      return event.message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
    });
}

const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

function anthropicAnswer(turn, body, n, tokens) {
  const content =
    typeof turn === "string"
      ? [{ type: "text", text: turn }]
      : turn.tools.map((tool, i) => ({
          type: "tool_use",
          id: `toolu_stub_${n}_${i}`,
          name: tool.name,
          input: tool.input,
        }));
  const stop = typeof turn === "string" ? "end_turn" : "tool_use";
  const usage = { input_tokens: tokens.input, output_tokens: tokens.output };
  const message = {
    id: `msg_stub_${n}`,
    type: "message",
    role: "assistant",
    model: body.model,
    content,
    stop_reason: stop,
  };
  if (!body.stream)
    return { type: "application/json", text: JSON.stringify({ ...message, stop_sequence: null, usage }) };
  const events = [
    ["message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null, usage } }],
  ];
  content.forEach((block, index) => {
    if (block.type === "text") {
      events.push([
        "content_block_start",
        { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      ]);
      events.push([
        "content_block_delta",
        { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } },
      ]);
    } else {
      events.push([
        "content_block_start",
        { type: "content_block_start", index, content_block: { ...block, input: {} } },
      ]);
      events.push([
        "content_block_delta",
        {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        },
      ]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push([
    "message_delta",
    {
      type: "message_delta",
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: tokens.output },
    },
  ]);
  events.push(["message_stop", { type: "message_stop" }]);
  return { type: "text/event-stream", text: sse(events) };
}

function openaiAnswer(turn, body, n, tokens) {
  const output =
    typeof turn === "string"
      ? [
          {
            type: "message",
            id: `msg_stub_${n}`,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: turn, annotations: [] }],
          },
        ]
      : turn.tools.map((tool, i) => ({
          type: "function_call",
          id: `fc_stub_${n}_${i}`,
          call_id: `call_stub_${n}_${i}`,
          name: tool.name,
          arguments: JSON.stringify(tool.input),
          status: "completed",
        }));
  const usage = {
    input_tokens: tokens.input,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: tokens.output,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: tokens.input + tokens.output,
  };
  const response = {
    id: `resp_stub_${n}`,
    object: "response",
    created_at: 1_763_510_400,
    status: "completed",
    model: body.model,
    output,
    usage,
    error: null,
    incomplete_details: null,
  };
  if (!body.stream) return { type: "application/json", text: JSON.stringify(response) };
  const events = [
    ["response.created", { type: "response.created", response: { ...response, status: "in_progress", output: [] } }],
  ];
  output.forEach((item, output_index) => {
    events.push(["response.output_item.added", { type: "response.output_item.added", output_index, item }]);
    events.push(["response.output_item.done", { type: "response.output_item.done", output_index, item }]);
  });
  events.push(["response.completed", { type: "response.completed", response }]);
  return { type: "text/event-stream", text: sse(events) };
}

/**
 * Starts the stub. `script(provider, body, n)` returns the n-th turn (from 0) for a provider's request: text, or
 * `{ tools: [{ name, input }] }`. `usage` sets the token counts every answer reports. `fail(provider, body)`, when
 * it returns an object, makes the stub answer with that error body and status 401 instead. Resolves with its base
 * URL, the requests it received and `close()`.
 */
export async function startStub(script, { usage = { input: 120, output: 30 }, fail } = {}) {
  const requests = [];
  const counts = { anthropic: 0, openai: 0 };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = new URL(req.url, "http://stub").pathname;
      const provider = path === "/v1/messages" ? "anthropic" : path === "/v1/responses" ? "openai" : null;
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ provider, url: req.url, headers: req.headers, body });
      if (provider === null) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: `the stub serves no ${req.url}` } }));
        return;
      }
      const failure = fail?.(provider, body, req.headers);
      if (failure) {
        res.writeHead(401, { "content-type": "application/json", "request-id": STUB_IDS.requestId });
        res.end(JSON.stringify(failure));
        return;
      }
      const n = counts[provider]++;
      const turn = script(provider, body, n);
      const answer =
        provider === "anthropic" ? anthropicAnswer(turn, body, n, usage) : openaiAnswer(turn, body, n, usage);
      res.writeHead(200, {
        "content-type": answer.type,
        "request-id": STUB_IDS.requestId,
        "x-request-id": STUB_IDS.requestId,
        "anthropic-organization-id": STUB_IDS.anthropicOrganization,
        "anthropic-workspace-id": STUB_IDS.workspace,
        "openai-organization": STUB_IDS.organization,
      });
      res.end(answer.text);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
