// Scripted legacy MCP servers over HTTP, written by hand so a test controls every byte: a streamable HTTP server of
// the 2025 era, with a session id and a GET stream for unsolicited notices, and an HTTP+SSE server of the 2024-11-05
// revision. Each takes `hook` to answer a request its own way, which is how the hostile tests misbehave.
import type { IncomingMessage, ServerResponse } from "node:http";
import { type SeenRequest, startHttp, type TestServer } from "./http-helpers.js";

/** A tool as a scripted server lists it. */
export interface RawTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const rawTool = (name: string, description = `The ${name} tool.`): RawTool => ({
  name,
  description,
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
});

type Message = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: Record<string, unknown> };

/** What a scripted server holds: its tools, the calls it got, and a hook that may answer a request first. */
export interface RawOptions {
  tools: RawTool[];
  /** Answers a request before the script does; returns true when it did. */
  hook?: (request: IncomingMessage, response: ServerResponse, seen: SeenRequest) => boolean | Promise<boolean>;
  /** Waits before any answer, so a test can hold the server's connect. */
  hold?: Promise<void>;
  calls?: { name: string; arguments: unknown }[];
}

/** The script's answer to one JSON-RPC message, or `undefined` for a notification. */
function answer(message: Message, options: RawOptions): object | undefined {
  if (message.id === undefined) return undefined;
  const reply = (result: object) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "server/discover":
      return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } };
    case "initialize":
      return reply({
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "raw", version: "1.0.0" },
      });
    case "tools/list":
      return reply({ tools: options.tools });
    case "tools/call": {
      const params = message.params ?? {};
      options.calls?.push({ name: String(params.name), arguments: params.arguments });
      const echo = (params.arguments as { echo?: unknown } | undefined)?.echo;
      const tail = typeof echo === "string" ? `: ${echo}` : "";
      return reply({ content: [{ type: "text", text: `called ${String(params.name)}${tail}` }] });
    }
    default:
      return reply({});
  }
}

const NOTICE = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n\n`;

/** A legacy streamable HTTP server: JSON answers, a session id, and a GET stream for notices. */
export async function legacyHttp(options: RawOptions): Promise<TestServer & { notify(): void; streams(): number }> {
  const streams = new Set<ServerResponse>();
  const server = await startHttp(async (request, response, seen) => {
    await options.hold;
    if (options.hook !== undefined && (await options.hook(request, response, seen))) return;
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "session-1" });
      response.write(": open\n\n");
      streams.add(response);
      response.once("close", () => streams.delete(response));
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const reply = answer(JSON.parse(seen.body) as Message, options);
    if (reply === undefined) {
      response.writeHead(202).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "session-1" });
    response.end(JSON.stringify(reply));
  });
  return {
    ...server,
    notify() {
      for (const stream of streams) stream.write(NOTICE);
    },
    streams: () => streams.size,
  };
}

/** A 2024-11-05 HTTP+SSE server: a GET event stream that names a POST endpoint, and answers on the stream. */
export async function legacySse(
  options: RawOptions & { endpoint?: string },
): Promise<TestServer & { notify(): void; endStream(): void }> {
  let stream: ServerResponse | undefined;
  const server = await startHttp(async (request, response, seen) => {
    await options.hold;
    if (options.hook !== undefined && (await options.hook(request, response, seen))) return;
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: endpoint\ndata: ${options.endpoint ?? "/messages?session=1"}\n\n`);
      stream = response;
      return;
    }
    const reply = answer(JSON.parse(seen.body) as Message, options);
    response.writeHead(202).end();
    if (reply !== undefined) stream?.write(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
  }, "/sse");
  return {
    ...server,
    notify() {
      stream?.write(NOTICE);
    },
    endStream() {
      stream?.end();
    },
  };
}
