// A stand-in for the Anthropic Messages API and OpenAI's Responses and Chat Completions APIs on the loopback interface,
// for the live run's tests (live-run.test.mjs). Our gateway's OpenAI adapter speaks Chat Completions; the verify
// harnesses speak Responses. It answers each request with the next turn of a script, in the provider's own JSON or
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
      // Two deltas, as a real stream sends many, so a check that counts them passes against the stub too.
      const cut = Math.ceil(block.text.length / 2);
      for (const text of [block.text.slice(0, cut), block.text.slice(cut)]) {
        events.push([
          "content_block_delta",
          { type: "content_block_delta", index, delta: { type: "text_delta", text } },
        ]);
      }
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
    // A real stream adds a message with no content, adds each part empty, sends the text in deltas, and holds the whole
    // item only in output_item.done.
    const message = item.type === "message";
    events.push([
      "response.output_item.added",
      { type: "response.output_item.added", output_index, item: message ? { ...item, content: [] } : item },
    ]);
    for (const [content_index, part] of (message ? item.content : []).entries()) {
      events.push([
        "response.content_part.added",
        {
          type: "response.content_part.added",
          item_id: item.id,
          output_index,
          content_index,
          part: { ...part, text: "" },
        },
      ]);
      const cut = Math.ceil(part.text.length / 2);
      for (const delta of [part.text.slice(0, cut), part.text.slice(cut)]) {
        events.push([
          "response.output_text.delta",
          { type: "response.output_text.delta", item_id: item.id, output_index, content_index, delta },
        ]);
      }
      events.push([
        "response.output_text.done",
        { type: "response.output_text.done", item_id: item.id, output_index, content_index, text: part.text },
      ]);
      events.push([
        "response.content_part.done",
        { type: "response.content_part.done", item_id: item.id, output_index, content_index, part },
      ]);
    }
    events.push(["response.output_item.done", { type: "response.output_item.done", output_index, item }]);
  });
  events.push(["response.completed", { type: "response.completed", response }]);
  return { type: "text/event-stream", text: sse(events) };
}

function chatAnswer(turn, body, n, tokens) {
  const chunk = (delta, finish = null) => ({
    id: `chatcmpl_stub_${n}`,
    object: "chat.completion.chunk",
    created: 1_763_510_400,
    model: body.model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const usage = {
    prompt_tokens: tokens.input,
    completion_tokens: tokens.output,
    total_tokens: tokens.input + tokens.output,
    prompt_tokens_details: { cached_tokens: 0 },
  };
  const chunks = [chunk({ role: "assistant", content: "" })];
  if (typeof turn === "string") {
    // Two deltas, as a real stream sends many.
    const cut = Math.ceil(turn.length / 2);
    for (const content of [turn.slice(0, cut), turn.slice(cut)]) chunks.push(chunk({ content }));
  } else {
    turn.tools.forEach((tool, index) => {
      const call = { index, id: `call_stub_${n}_${index}`, type: "function" };
      chunks.push(chunk({ tool_calls: [{ ...call, function: { name: tool.name, arguments: "" } }] }));
      chunks.push(chunk({ tool_calls: [{ index, function: { arguments: JSON.stringify(tool.input) } }] }));
    });
  }
  chunks.push(chunk({}, typeof turn === "string" ? "stop" : "tool_calls"));
  if (body.stream_options?.include_usage) chunks.push({ ...chunk({}), choices: [], usage });
  if (!body.stream) {
    const content = typeof turn === "string" ? turn : null;
    const tool_calls =
      typeof turn === "string"
        ? undefined
        : turn.tools.map((tool, i) => ({
            id: `call_stub_${n}_${i}`,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.input) },
          }));
    const message = { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) };
    const finish_reason = typeof turn === "string" ? "stop" : "tool_calls";
    const completion = { id: `chatcmpl_stub_${n}`, object: "chat.completion", model: body.model, usage };
    return {
      type: "application/json",
      text: JSON.stringify({ ...completion, choices: [{ index: 0, message, finish_reason }] }),
    };
  }
  const text = `${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")}data: [DONE]\n\n`;
  return { type: "text/event-stream", text };
}

const PATHS = { "/v1/messages": "anthropic", "/v1/responses": "openai", "/v1/chat/completions": "openai-chat" };
const ANSWERS = { anthropic: anthropicAnswer, openai: openaiAnswer, "openai-chat": chatAnswer };

/**
 * Starts the stub. `script(api, body, n)` returns the n-th turn (from 0) for a request to one API, `anthropic`,
 * `openai` (Responses) or `openai-chat` (Chat Completions): text, or `{ tools: [{ name, input }] }`. `usage` sets the token counts every answer reports. `fail(provider, body)`, when
 * it returns an object, makes the stub answer with that error body and status 401 instead. `refuse(provider, n)`, when
 * it returns `{ status, body, headers }`, answers the n-th request (from 0) to one API with that failure instead, as a
 * provider refuses a request the client may retry; a refused request takes no turn of the script. Resolves with its
 * base URL, the requests it received and `close()`.
 */
export async function startStub(script, { usage = { input: 120, output: 30 }, fail, refuse } = {}) {
  const received = { anthropic: 0, openai: 0, "openai-chat": 0 };
  const requests = [];
  const counts = { anthropic: 0, openai: 0, "openai-chat": 0 };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = new URL(req.url, "http://stub").pathname;
      const provider = PATHS[path] ?? null;
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
      const refusal = refuse?.(provider, received[provider]++);
      if (refusal) {
        res.writeHead(refusal.status, { "content-type": "application/json", ...refusal.headers });
        res.end(JSON.stringify(refusal.body));
        return;
      }
      const n = counts[provider]++;
      const turn = script(provider, body, n);
      const answer = ANSWERS[provider](turn, body, n, usage);
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
