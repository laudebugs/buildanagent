// The live mode of a harness whose SDK makes its model calls from a child process: the Claude Agent SDK's bundled
// `claude` CLI and the Copilot SDK's runtime. Other harnesses wrap each call in the example's own process (live.ts);
// here the example's process never sees a call, so the harness's runner starts this proxy instead, in its own process,
// and runs the example, with its CLI or runtime, in a network namespace that holds only a loopback interface. A
// forwarder inside the namespace (forward.mjs) passes each connection to the proxy's Unix socket. The proxy is the only
// code in the run that holds the key and the only route to the network, and before it forwards a call it:
//
// - refuses a request that offers a host tool, by name or by type (denyHostTools), or a tool the harness's live mode
//   doesn't allow, or a body field it doesn't know, such as a server-side MCP connector;
// - sets the run's model and caps the output at the run's maxTokens, whatever the CLI asked for;
// - checks the call against the cost guard (budget.ts) and settles it with the usage the answer reports;
// - sends the call to the provider's fixed address, or to the test stub that LIVE_BASE_URL names on the loopback
//   interface, with the key in the provider's header.
//
// The CLI and the runtime get a placeholder key that the proxy discards, and they see only the answer's status,
// content type and body, with the key taken out of the body: never the provider's headers, which carry account and
// request ids. The proxy records each call it forwards in the transcript format, which the runner merges with the
// example's checks into the live transcript.
//
// Importing this file reads the key: live.ts reads the file that LIVE_API_KEY_FILE names and deletes it. So a runner
// imports it only after liveMode() has accepted the run, and the example never receives LIVE_API_KEY_FILE.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { PLACEHOLDER_KEY } from "./forward.mjs";
import { beginCall, denyHostTools, live } from "./live.ts";
import { redact } from "./redact.ts";

export { PLACEHOLDER_KEY };

const UPSTREAM = { anthropic: "https://api.anthropic.com", openai: "https://api.openai.com" };
const ENDPOINT = { anthropic: "/v1/messages", openai: "/v1/responses" };
/** The path a CLI or runtime asks for, which may carry its own prefix before the endpoint. */
const ACCEPTS = { anthropic: /\/v1\/messages$/, openai: /\/responses$/ };
/** The tool types that are plain function tools the example's own process runs. */
const FUNCTION_TYPES = { anthropic: ["custom"], openai: ["function"] };
/** The request headers that pass through to the provider; every other header, the placeholder key among them, stops. */
const PASSED_HEADERS = { anthropic: ["anthropic-version", "anthropic-beta"], openai: [] };
const TIMEOUT_MS = 120_000;

/**
 * The body fields the proxy passes on. A field outside the list stops the request, because some fields reach past the
 * model: Anthropic's `mcp_servers` makes its servers call a URL, and `container` runs code. `metadata` and `user` are
 * dropped, because they carry the machine's ids and the call doesn't need them.
 */
const FIELDS = {
  anthropic: new Set([
    "model",
    "messages",
    "system",
    "tools",
    "tool_choice",
    "max_tokens",
    "thinking",
    "stream",
    "temperature",
    "top_p",
    "top_k",
    "stop_sequences",
    "output_config",
    "context_management",
  ]),
  openai: new Set([
    "model",
    "input",
    "instructions",
    "tools",
    "tool_choice",
    "max_output_tokens",
    "stream",
    "stream_options",
    "temperature",
    "top_p",
    "reasoning",
    "text",
    "parallel_tool_calls",
    "store",
    "include",
    "truncation",
    "prompt_cache_key",
    "previous_response_id",
  ]),
};
const DROPPED = new Set(["metadata", "user"]);

/** What the live mode passes on to the example's environment: enough to configure its provider, and no key. */
export function exampleEnv(socket, settings = live) {
  return { LIVE: "1", LIVE_PROVIDER: settings.provider, LIVE_MODEL: settings.model, LIVE_PROXY_SOCKET: socket };
}

/**
 * The problem with a request, or undefined when the proxy may forward it. `allowTool(name)` is the harness's own
 * allowlist; denyHostTools adds the names and types every harness refuses.
 */
export function requestProblem(provider, body, allowTool) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "the request body is not a JSON object";
  for (const key of Object.keys(body)) {
    if (!FIELDS[provider].has(key) && !DROPPED.has(key))
      return `the request carries "${key}", which it doesn't pass on`;
  }
  const tools = body.tools ?? [];
  if (!Array.isArray(tools)) return "the request's tools are not a list";
  const named = tools.map((tool) => ({ name: String(tool?.name ?? tool?.type ?? ""), type: tool?.type }));
  try {
    denyHostTools(named, FUNCTION_TYPES[provider]);
  } catch (error) {
    return error.message.replace(/^live mode: /, "");
  }
  const refused = named.find((tool) => !allowTool(tool.name));
  return refused === undefined ? undefined : `the request offers "${refused.name}", which this live mode doesn't allow`;
}

/** The body as the proxy sends it: the run's model, an output cap of the run's maxTokens, and no machine ids. */
export function prepareBody(provider, body, { model, maxTokens }) {
  const out = { ...body, model };
  for (const key of DROPPED) delete out[key];
  const field = provider === "anthropic" ? "max_tokens" : "max_output_tokens";
  out[field] = Math.min(Number(body[field]) || maxTokens, maxTokens);
  // An extended-thinking budget must stay under max_tokens; one that the cap now exceeds goes, rather than fail.
  if (out.thinking?.type === "enabled" && !(out.thinking.budget_tokens < out[field])) delete out.thinking;
  return out;
}

/** The server-sent events of a stream, as parsed `data:` payloads. */
function sseData(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((data) => data !== "" && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

const parseJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

/** An Anthropic answer, streamed or not, as its content blocks, stop reason and usage. */
function anthropicAnswer(text, streamed) {
  if (!streamed) {
    const message = JSON.parse(text);
    return { blocks: message.content ?? [], stop: message.stop_reason ?? null, usage: anthropicUsage(message.usage) };
  }
  const blocks = [];
  const json = [];
  let usage = {};
  let stop = null;
  for (const event of sseData(text)) {
    if (event.type === "message_start") usage = { ...event.message?.usage };
    else if (event.type === "content_block_start") {
      blocks[event.index] = { ...event.content_block };
      json[event.index] = "";
    } else if (event.type === "content_block_delta") {
      const block = blocks[event.index];
      if (event.delta?.type === "text_delta") block.text = (block.text ?? "") + event.delta.text;
      if (event.delta?.type === "input_json_delta") json[event.index] += event.delta.partial_json;
    } else if (event.type === "message_delta") {
      stop = event.delta?.stop_reason ?? stop;
      usage = { ...usage, ...event.usage };
    }
  }
  blocks.forEach((block, i) => {
    if (block?.type === "tool_use" && json[i]) block.input = parseJSON(json[i]);
  });
  return { blocks: blocks.filter(Boolean), stop, usage: anthropicUsage(usage) };
}

/** Anthropic's input_tokens leaves out cache reads and writes, which it counts apart. */
function anthropicUsage(usage) {
  if (!usage || typeof usage.output_tokens !== "number") return undefined;
  return {
    uncachedInput: usage.input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens,
  };
}

/**
 * An OpenAI Responses answer as Anthropic-shaped blocks, so one mapping serves both. The stop reason takes Anthropic's
 * words too, so a live run on OpenAI compares with a mock transcript that the Anthropic-shaped mocks wrote.
 */
function openaiAnswer(text, streamed) {
  const response = streamed
    ? sseData(text).findLast((event) => event.response && /^response\.(completed|incomplete|failed)$/.test(event.type))
        ?.response
    : JSON.parse(text);
  const output = response?.output ?? [];
  const blocks = output.flatMap((item) => {
    if (item.type === "function_call") {
      return [{ type: "tool_use", id: item.call_id, name: item.name, input: parseJSON(item.arguments) }];
    }
    if (item.type !== "message") return [];
    return (item.content ?? []).filter((c) => c.type === "output_text").map((c) => ({ type: "text", text: c.text }));
  });
  const stop = blocks.some((block) => block.type === "tool_use")
    ? "tool_use"
    : response?.incomplete_details?.reason === "max_output_tokens"
      ? "max_tokens"
      : "end_turn";
  const usage = response?.usage;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    blocks,
    stop,
    usage:
      typeof usage?.output_tokens === "number"
        ? { uncachedInput: (usage.input_tokens ?? 0) - cached, cacheRead: cached, output: usage.output_tokens }
        : undefined,
  };
}

/** A Responses request's input as Anthropic-shaped messages, for the harness's messagesOf(). */
function openaiMessages(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  const text = (content) =>
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : (content ?? []).filter((c) => typeof c.text === "string").map((c) => ({ type: "text", text: c.text }));
  return (input ?? []).flatMap((item) => {
    if (item.type === "function_call") {
      const call = { type: "tool_use", id: item.call_id, name: item.name, input: parseJSON(item.arguments) };
      return [{ role: "assistant", content: [call] }];
    }
    if (item.type === "function_call_output") {
      return [{ role: "user", content: [{ type: "tool_result", tool_use_id: item.call_id, content: item.output }] }];
    }
    if ((item.type ?? "message") !== "message" || !["user", "assistant"].includes(item.role)) return [];
    return [{ role: item.role, content: text(item.content) }];
  });
}

/** Thinking blocks carry an opaque signature and say nothing a transcript replays, so the transcript drops them. */
const withoutThinking = (messages) =>
  messages.map((m) =>
    Array.isArray(m.content)
      ? { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }
      : m,
  );

/** An answer's blocks as transcript parts. */
const partsOf = (blocks) =>
  blocks.flatMap((block) => {
    if (block.type === "text") return [{ type: "text", text: block.text ?? "" }];
    if (block.type === "tool_use") return [{ type: "tool-call", id: block.id, name: block.name, input: block.input }];
    return [];
  });

/**
 * Starts the proxy on a Unix socket in a new private directory. `allowTool(name)` is the harness's allowlist of the
 * tools a request may offer; `messagesOf(messages)` maps Anthropic-shaped messages to transcript messages, as the
 * harness's mock does; `secrets` is the live mode's list of values to redact, which gains the key. `log`, when given,
 * names the JSONL file the harness's mock would write, which some examples read to check what was sent: each line
 * holds a forwarded request's body as the provider received it, which holds no key. Resolves with the socket's path,
 * the example's environment, the events it recorded, the reasons it refused a request, and `close()`.
 */
export async function startLiveProxy({ allowTool, messagesOf, secrets, log }) {
  if (live === undefined) throw new Error("live proxy: the run is not live");
  secrets?.push(live.apiKey);
  const { provider } = live;
  const upstream = `${live.baseURL ?? UPSTREAM[provider]}${ENDPOINT[provider]}`;
  const events = [];
  const refused = [];
  const answer = (res, status, message) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: `live proxy: ${message}` } }),
    );
  };

  async function forward(req, raw, res) {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return answer(res, 400, "the request body is not JSON");
    }
    const problem = requestProblem(provider, body, allowTool);
    if (problem !== undefined) {
      refused.push(problem);
      return answer(res, 400, problem);
    }
    const sent = prepareBody(provider, body, live);
    let guard;
    try {
      guard = beginCall(live, sent);
    } catch (error) {
      refused.push(error.message);
      return answer(res, 400, error.message);
    }
    if (log) {
      const path = new URL(req.url ?? "/", "http://proxy").pathname;
      appendFileSync(
        log,
        `${JSON.stringify({ method: "POST", path, tools: sent.tools?.map((t) => t.name), body: sent })}\n`,
      );
    }
    const headers = { "content-type": "application/json" };
    for (const name of PASSED_HEADERS[provider]) if (req.headers[name]) headers[name] = req.headers[name];
    if (provider === "anthropic") {
      headers["x-api-key"] = live.apiKey;
      headers["anthropic-version"] ??= "2023-06-01";
    } else headers.authorization = `Bearer ${live.apiKey}`;
    const messages = provider === "anthropic" ? withoutThinking(sent.messages ?? []) : openaiMessages(sent.input);
    events.push({
      kind: "request",
      model: live.model,
      messages: messagesOf(messages),
      tools: (sent.tools ?? []).map((tool) => tool.name ?? tool.type),
      at: Date.now(),
    });
    let status;
    let type;
    let text;
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers,
        body: JSON.stringify(sent),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = response.status;
      type = response.headers.get("content-type") ?? "application/json";
      text = await response.text();
    } catch (error) {
      guard.settle(undefined);
      return answer(res, 502, `the provider did not answer (${error.name})`);
    }
    if (status < 200 || status >= 300) {
      // A provider that bills a failed call reports no usage, so the guard records the call's projection.
      guard.settle(undefined);
      res.writeHead(status, { "content-type": type });
      return res.end(redact(text, [live.apiKey]));
    }
    let parsed;
    try {
      const streamed = type.includes("text/event-stream");
      parsed = provider === "anthropic" ? anthropicAnswer(text, streamed) : openaiAnswer(text, streamed);
    } catch {
      parsed = { blocks: [], stop: null, usage: undefined };
    }
    guard.settle(parsed.usage);
    events.push({
      kind: "response",
      model: live.model,
      message: { role: "assistant", parts: partsOf(parsed.blocks) },
      finish: parsed.stop ?? "unknown",
      at: Date.now(),
    });
    res.writeHead(status, { "content-type": type });
    res.end(text.split(live.apiKey).join("<redacted>"));
  }

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const path = new URL(req.url ?? "/", "http://proxy").pathname;
      // Anything but a model call, such as a token count or a model list, stays here: the run needs none of them.
      if (req.method !== "POST" || !ACCEPTS[provider].test(path)) return answer(res, 404, `it serves no ${path}`);
      forward(req, raw, res).catch(() => answer(res, 500, "the call failed"));
    });
  });
  const dir = mkdtempSync(join(tmpdir(), "live-proxy-"));
  const socket = join(dir, "proxy.sock");
  await new Promise((resolve) => server.listen(socket, resolve));
  return {
    socket,
    env: exampleEnv(socket),
    events,
    refused,
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The command that runs `command args…` in a new user and network namespace whose only interface is loopback, brought
 * up first with `ip` or, without it, Python. Throws where the machine can't make one, so a live run never falls back to
 * a process that can reach the network.
 */
export function loopbackNamespace(path = process.env.PATH ?? "") {
  const find = (name) =>
    path
      .split(delimiter)
      .map((dir) => join(dir, name))
      .find((file) => existsSync(file));
  const ip = find("ip");
  const python = find("python3");
  const up = ip
    ? `"${ip}" link set lo up`
    : python
      ? `"${python}" -I -c 'import socket,fcntl,struct;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);fcntl.ioctl(s,0x8914,struct.pack("16sH14s",b"lo",0x49,bytes(14)))'`
      : null;
  let works = false;
  try {
    execFileSync("unshare", ["-rn", "true"], { stdio: "ignore" });
    works = true;
  } catch {}
  if (up === null || !works) {
    throw new Error("live mode needs `unshare -rn` (user and network namespaces) and `ip` or python3");
  }
  return (command, args) => ["unshare", ["-rn", "sh", "-c", `${up} && exec "$0" "$@"`, command, ...args]];
}
