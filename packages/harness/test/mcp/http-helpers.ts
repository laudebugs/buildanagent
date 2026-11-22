// Shared by the remote MCP tests: HTTP servers on 127.0.0.1 in this process, a real one on
// @modelcontextprotocol/server 2.4.0 and scripted hostile ones, plus a manual clock for the waits. Nothing here
// reaches past loopback.
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import type { McpHttpTransport, McpServerConfig, McpSseTransport, McpTimers } from "@buildanagent/harness/mcp";
import { createMcpHandler, type McpServer } from "@modelcontextprotocol/server";
import { afterEach } from "vitest";

const servers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of servers.splice(0)) await close();
});

/** One request a test server received. */
export interface SeenRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  /** The JSON-RPC method of a POST body, when it has one. */
  readonly rpc?: string;
}

/** A running test server. */
export interface TestServer {
  readonly url: string;
  readonly port: number;
  readonly seen: SeenRequest[];
  /** How many TCP connections reached the server. */
  connections(): number;
  close(): Promise<void>;
}

type Handler = (request: IncomingMessage, response: ServerResponse, seen: SeenRequest) => void | Promise<void>;

function rpcOf(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { method?: unknown };
    return typeof parsed.method === "string" ? parsed.method : undefined;
  } catch {
    return undefined;
  }
}

/** Serves `handler` on 127.0.0.1, with each request's body read first, and closes it after the test. */
export async function startHttp(handler: Handler, path = "/mcp"): Promise<TestServer> {
  const seen: SeenRequest[] = [];
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      const rpc = rpcOf(body);
      const entry: SeenRequest = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
        ...(rpc === undefined ? {} : { rpc }),
      };
      seen.push(entry);
      Promise.resolve(handler(request, response, entry)).catch(() => response.destroy());
    });
  });
  server.on("connection", (socket) => {
    connections += 1;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  let closed: Promise<void> | undefined;
  const close = () => {
    closed ??= new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
    return closed;
  };
  servers.push(close);
  return { url: `http://127.0.0.1:${port}${path}`, port, seen, connections: () => connections, close };
}

/** A Web `Request` for a Node request whose body was read. */
function toWebRequest(request: IncomingMessage, body: string, port: number): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) for (const one of value) headers.append(name, one);
  }
  const method = request.method ?? "GET";
  return new Request(`http://127.0.0.1:${port}${request.url ?? "/"}`, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" || body === "" ? {} : { body }),
  });
}

/** Writes a Web `Response` to a Node response, streaming its body until either end closes. */
async function sendWeb(response: Response, out: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  out.writeHead(response.status, headers);
  if (response.body === null) {
    out.end();
    return;
  }
  const reader = response.body.getReader();
  out.once("close", () => {
    reader.cancel().catch(() => {});
  });
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true as const, value: undefined }));
    if (done) break;
    out.write(value);
  }
  out.end();
}

/** A real 2026-07-28 server on the client library's sibling, over HTTP, with its legacy stateless fallback. */
export async function libraryHttp(build: () => McpServer, options: { readonly legacy?: "stateless" | "reject" } = {}) {
  const handler = createMcpHandler(() => build(), { legacy: options.legacy ?? "stateless", keepAliveMs: 0 });
  const streams = new Set<ServerResponse>();
  const server = await startHttp(async (request, response, seen) => {
    const web = toWebRequest(request, seen.body, server.port);
    const answer = await handler.fetch(web);
    if ((answer.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
      streams.add(response);
      response.once("close", () => streams.delete(response));
    }
    await sendWeb(answer, response);
  });
  servers.push(() => handler.close());
  return {
    ...server,
    handler,
    /** Ends every open event stream at the TCP level, as a dropped network would. */
    dropStreams() {
      for (const stream of streams) stream.socket?.destroy();
    },
  };
}

/** A config for a remote server on loopback, as the tests reach it. */
export function remoteServer(
  name: string,
  url: string,
  overrides: Partial<Omit<McpServerConfig, "name" | "transport">> & {
    transport?: Partial<McpHttpTransport | McpSseTransport>;
  } = {},
): McpServerConfig {
  const { transport, ...rest } = overrides;
  return {
    name,
    transport: { kind: "http", url, unsafeAllowLoopback: true, ...transport } as McpHttpTransport,
    ...rest,
  };
}

/** A clock that moves only when the test says so. A timer due at or before the new time runs, in time order. */
export function manualTimers(): McpTimers & { advance(ms: number): Promise<void>; pending(): number } {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout(run, ms) {
      next += 1;
      due.set(next, { at: now + ms, run });
      return next;
    },
    clearTimeout(handle) {
      due.delete(handle as number);
    },
    now: () => now,
    pending: () => due.size,
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const first = [...due].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (first === undefined) break;
        due.delete(first[0]);
        now = Math.max(now, first[1].at);
        first[1].run();
        // Let the promise jobs the timer started run before the next one is due.
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = until;
    },
  };
}

/** A promise and the function that settles it. */
export function gate(): { promise: Promise<void>; open(): void } {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
