// Minimal mock of the Anthropic Messages API, served as a BYOK provider for the Copilot runtime.
// The SDK passes `provider: { type: "anthropic", baseUrl }` to the runtime, which then sends every
// model call here instead of to GitHub's Copilot API, so the real runtime loop, tool dispatch,
// permission flow, hooks and session store run against a scripted model.
//
// Scripted behaviour for each request, within the current user turn:
//   1. Call the next callable tool the prompt names, in the order the prompt names them, once each.
//      If the prompt names none, call the first callable tool once (a "mock-no-tools" line skips this).
//   2. Otherwise answer with text: the prompt's "mock-reply: <text>" line if any, else a default,
//      followed by the text of the tool results seen this turn (so tests can assert on them).
//      When the request asks for structured output (output_config.format), answer with JSON only.
// Arguments come from the tool's JSON Schema, or from a "mock-args <tool> <json>" line in the prompt.
//
// Safety: a tool is callable only if the harness allowed it (see allowTools) AND its name does not
// match BUILTIN_DENY. Built-in tools such as bash, edit or create are never called, so docs code
// cannot touch the host through the model.
// Every request is appended to `log` (JSONL) so tests can assert on what the runtime sent.

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

// Names of the runtime's host-touching built-ins (and anything shaped like one), denied by name even
// when a custom tool overrides them.
export const BUILTIN_DENY =
  /^(bash|powershell|shell|\w*_(bash|powershell|shell)|view|create|edit|str_replace\w*|apply_patch|write\w*|web_fetch|web_search|fetch|sql|grep|glob|rg|ls|find|task|read_agent|write_agent|list_agents|skill|run_dynamic_workflow|dynamic_workflows_manage|semantic_code_search|github-\w+|gh_\w+|git\w*|delete\w*|rm|mv|cp|exec\w*|run\w*_command|terminal\w*)$/i;

const allowed = new Set();
const prefixes = [];
/**
 * Allow the mock to call these tool names (custom tools and MCP tools registered by the example).
 * A name ending in "-*" allows every tool of that MCP server ("<server>-<tool>").
 */
export function allowTools(names) {
  for (const n of names) {
    if (n.endsWith("-*")) prefixes.push(n.slice(0, -1));
    else allowed.add(n);
  }
}
const isCallable = (name) =>
  (allowed.has(name) || prefixes.some((p) => name.startsWith(p))) && !BUILTIN_DENY.test(name);

let seq = 0;

function synth(schema = {}, depth = 0) {
  if (depth > 6 || typeof schema !== "object" || schema === null) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.anyOf || schema.oneOf) return synth((schema.anyOf ?? schema.oneOf)[0], depth + 1);
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  switch (t) {
    case "string":
      return schema.format === "email" ? "user@example.com" : "example";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return true;
    case "array":
      return [synth(schema.items ?? {}, depth + 1)];
    case "null":
      return null;
    default: {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = synth(v, depth + 1);
      return out;
    }
  }
}

const blocks = (m) =>
  Array.isArray(m?.content) ? m.content : typeof m?.content === "string" ? [{ type: "text", text: m.content }] : [];
const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (typeof c === "string" ? c : (c.text ?? textOf(c.content)))).join("\n")
      : "";

export function plan(body) {
  const msgs = body.messages ?? [];
  // The current turn starts at the last user message that carries text rather than tool results.
  let start = msgs.length - 1;
  while (start > 0 && !(msgs[start].role === "user" && blocks(msgs[start]).some((b) => b.type === "text"))) start--;
  const prompt = blocks(msgs[start])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const turn = msgs.slice(start + 1);
  const called = turn.flatMap((m) =>
    blocks(m)
      .filter((b) => b.type === "tool_use")
      .map((b) => b.name),
  );
  const results = turn.flatMap((m) => blocks(m).filter((b) => b.type === "tool_result"));

  const offered = (body.tools ?? []).filter((t) => isCallable(t.name));
  const named = offered
    .map((t) => ({ t, at: prompt.indexOf(t.name) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.t);
  const queue = /^mock-no-tools$/m.test(prompt) ? [] : named.length ? named : offered.slice(0, 1);
  const next = queue.find((t) => !called.includes(t.name));
  if (next) {
    const override = prompt.match(new RegExp(`^mock-args ${next.name} (\\{.*\\})\\s*$`, "m"));
    return { tool: next, input: override ? JSON.parse(override[1]) : synth(next.input_schema) };
  }
  const reply = prompt.match(/^mock-reply: (.*)$/m)?.[1] ?? "Mock model: hello from the offline mock.";
  // Structured output (Anthropic output_config.format): answer with JSON only, from mock-reply when
  // it parses, else synthesised from the schema.
  const format = body.output_config?.format;
  if (format?.type === "json_schema") {
    try {
      return { text: JSON.stringify(JSON.parse(reply)) };
    } catch {
      return { text: JSON.stringify(synth(format.schema)) };
    }
  }
  const seen = results.map((r) => textOf(r.content)).filter(Boolean);
  return { text: seen.length ? `${reply}\nTool results: ${seen.join(" | ")}` : reply };
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
}

function reply(res, body, p) {
  const id = `msg_mock_${++seq}`;
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const block = p.tool
    ? { type: "tool_use", id: `toolu_mock_${seq}`, name: p.tool.name, input: p.input }
    : { type: "text", text: p.text };
  const stop_reason = p.tool ? "tool_use" : "end_turn";
  const message = { id, type: "message", role: "assistant", model: body.model ?? "mock", content: [], usage };
  Object.assign(message, { stop_reason: null, stop_sequence: null });
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ...message, content: [block], stop_reason }));
  }
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  sse(res, "message_start", { message });
  if (p.tool) {
    sse(res, "content_block_start", { index: 0, content_block: { ...block, input: {} } });
    sse(res, "content_block_delta", {
      index: 0,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(p.input) },
    });
  } else {
    // Two text deltas, so streaming consumers see more than one chunk.
    const cut = Math.ceil(p.text.length / 2);
    sse(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    sse(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: p.text.slice(0, cut) } });
    sse(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: p.text.slice(cut) } });
  }
  sse(res, "content_block_stop", { index: 0 });
  sse(res, "message_delta", { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(res, "message_stop", {});
  res.end();
}

/** Start the mock on 127.0.0.1. Resolves to the http.Server; its port is server.address().port. */
export function startMock(port = 0, log = process.env.MOCK_LOG) {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = req.url.split("?")[0];
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {}
      const isMessages = req.method === "POST" && path.endsWith("/v1/messages");
      const p = isMessages ? plan(body) : null;
      if (log)
        appendFileSync(
          log,
          `${JSON.stringify({ method: req.method, path, tools: body.tools?.map((t) => t.name), plan: p && (p.tool ? { tool: p.tool.name, input: p.input } : { text: p.text }), body })}\n`,
        );
      if (isMessages) return reply(res, body, p);
      if (path.endsWith("/v1/messages/count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ input_tokens: 10 }));
      }
      if (path.includes("/v1/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ data: [{ id: "claude-sonnet-4.5", type: "model", display_name: "Mock" }], has_more: false }),
        );
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ type: "error", error: { type: "not_found_error", message: `mock: ${req.method} ${path}` } }),
      );
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
