// Minimal mock of the Anthropic Messages API, for running Agent SDK examples offline.
// The SDK spawns the Claude Code CLI, which honours ANTHROPIC_BASE_URL, so pointing that here
// exercises the real agent loop, tool dispatch, hooks and permissions with a scripted model.
//
// Scripted behaviour per request:
//   1. If the last user turn contains tool_result blocks -> reply with final text (end_turn).
//   2. Else, if a StructuredOutput tool is offered -> call it with values synthesised from its schema.
//   3. Else, if the prompt carries a "[use-skill:<name>]" marker and the Skill tool is offered -> call
//      Skill once with that name (reads a SKILL.md, a read-only file in the example's temp directory).
//   4. Else, if an MCP/custom tool (name starts with "mcp__") is offered -> call one with
//      schema-synthesised arguments (preferring a tool the prompt names). Deferred MCP tools are
//      first loaded with ToolSearch("select:<name>"), as a real model would.
//   5. Else -> reply with plain text.
// Every request is appended to $MOCK_LOG (JSONL) so tests can assert on what the CLI sent.
//
// Usage: node scripts/mock-anthropic.mjs [port]   (or import { startMock })

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

let seq = 0;

function synth(schema = {}, depth = 0) {
  if (depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (schema.anyOf || schema.oneOf) return synth((schema.anyOf ?? schema.oneOf)[0], depth + 1);
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
    default: {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = synth(v, depth + 1);
      return out;
    }
  }
}

// Name of the tool each tool_use id called, across the whole conversation.
function toolNamesById(msgs) {
  const map = {};
  for (const m of msgs)
    for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === "tool_use") map[b.id] = b.name;
  return map;
}

function plan(body) {
  const msgs = body.messages ?? [];
  const last = msgs.at(-1);
  const lastContent = Array.isArray(last?.content) ? last.content : [];
  const tools = body.tools ?? [];
  const names = toolNamesById(msgs);
  const results = lastContent.filter((b) => b.type === "tool_result");
  const calledSoFar = new Set(Object.values(names));

  // A skill the prompt asks for by marker is read once, the way a model reads a skill it recognises.
  const skillTool = tools.find((t) => t.name === "Skill");
  const skillName = JSON.stringify(msgs).match(/\[use-skill:([A-Za-z0-9_:-]+)\]/)?.[1];
  if (skillTool && skillName && !calledSoFar.has("Skill")) return { tool: skillTool, input: { skill: skillName } };

  const structured = tools.find((t) => t.name === "StructuredOutput");
  const ranRealTool = results.some((b) => !["ToolSearch", "StructuredOutput"].includes(names[b.tool_use_id]));
  // Use one custom tool before answering: one the prompt names (as a model would follow), else the first.
  const convo = JSON.stringify({ system: body.system, messages: msgs });
  const customs = tools.filter((t) => t.name?.startsWith("mcp__") && !calledSoFar.has(t.name));
  const custom = customs.find((t) => convo.includes(t.name.split("__").at(-1))) ?? customs[0];
  if (custom && !ranRealTool && ![...calledSoFar].some((n) => n.startsWith("mcp__"))) {
    return { tool: custom, input: synth(custom.input_schema) };
  }
  // Answer: through StructuredOutput when the caller asked for a schema, else as text.
  if (structured && !calledSoFar.has("StructuredOutput"))
    return { tool: structured, input: synth(structured.input_schema) };
  if (ranRealTool || calledSoFar.has("StructuredOutput")) {
    return { text: "Mock model: received the tool result, task complete." };
  }

  // MCP tools may be deferred behind ToolSearch (on by default). Their names are advertised in the
  // request text; select the first one, the way a real model would.
  const search = tools.find((t) => t.name === "ToolSearch");
  if (search && !calledSoFar.has("ToolSearch")) {
    const text = JSON.stringify({ system: body.system, messages: msgs });
    const deferred = text.match(/mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+/);
    if (deferred) return { tool: search, input: { query: `select:${deferred[0]}`, max_results: 5 } };
  }
  return { text: "Mock model: hello from the offline mock." };
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
  const message = {
    id,
    type: "message",
    role: "assistant",
    model: body.model ?? "mock",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage,
  };
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
    sse(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    sse(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: p.text } });
  }
  sse(res, "content_block_stop", { index: 0 });
  sse(res, "message_delta", { delta: { stop_reason, stop_sequence: null }, usage: { output_tokens: 5 } });
  sse(res, "message_stop", {});
  res.end();
}

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
      if (log)
        appendFileSync(
          log,
          `${JSON.stringify({ method: req.method, path, tools: body.tools?.map((t) => t.name), body })}\n`,
        );
      if (req.method === "POST" && path.endsWith("/v1/messages")) return reply(res, body, plan(body));
      if (path.endsWith("/v1/messages/count_tokens")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ input_tokens: 10 }));
      }
      if (path.includes("/v1/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ data: [{ id: "claude-mock", type: "model", display_name: "Mock" }], has_more: false }),
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startMock(Number(process.argv[2] ?? 8787));
  console.log(`mock Anthropic API on http://127.0.0.1:${server.address().port}`);
}
