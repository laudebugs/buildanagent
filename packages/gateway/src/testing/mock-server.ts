/**
 * `startMockServer()`: a real HTTP server on this machine that plays a `mockTransport()` script, for a test that
 * needs a socket, such as one that drives a client in another process through its base URL. It is the one Node-only
 * part of the testing export besides the offline guards: Node's `http` module is imported when the server starts, so
 * the export still loads on every target.
 *
 * It binds to a loopback address only, never logs a credential, and refuses any request its script didn't expect.
 */
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { GatewayError } from "../errors.js";
import { markMockTransport } from "../request-policy.js";
import type { Transport } from "../runtime-types.js";
import { redactHeaders } from "./credentials.js";
import { mockTransport, type RecordedRequest, type WireApi, type WireScript } from "./mock-transport.js";

/** What `startMockServer()` takes. */
export interface MockServerOptions {
  /** The wire protocol the server speaks. Requests must go to its endpoint, such as `/v1/messages`. */
  readonly api: WireApi;
  /** The responses, one per request, in order, as `mockTransport()` plays them. */
  readonly script: WireScript;
  /** A file to append one JSON line to for each request received, with credential headers redacted. */
  readonly log?: string;
  /** The address to bind to: `127.0.0.1` by default, or another 127.0.0.0/8 address or `::1`. */
  readonly host?: string;
  /** The port. Default 0, which picks a free one. */
  readonly port?: number;
}

/** A running mock server. */
export interface MockServer {
  /** The server's base URL, such as `http://127.0.0.1:53124`, to pass as an adapter's `baseURL`. */
  readonly url: string;
  /** Every request received so far, in order, with credential headers redacted. */
  readonly requests: readonly RecordedRequest[];
  /**
   * A transport, marked as a mock, that sends requests to this server over the socket and refuses any other URL.
   * Pass it with `baseURL: server.url`, so an in-process adapter reaches the server while real model requests are
   * off.
   */
  readonly transport: Transport;
  /** Stops the server and closes its open connections. */
  close(): Promise<void>;
}

const LOOPBACK_ADDRESS = /^(127(?:\.\d{1,3}){3}|::1)$/;

function bindAddress(host: string | undefined): string {
  const address = host ?? "127.0.0.1";
  if (!LOOPBACK_ADDRESS.test(address)) {
    throw new GatewayError(
      "invalid_options",
      `startMockServer(): refusing to bind to ${address}; use 127.0.0.1, another 127.0.0.0/8 address or ::1`,
    );
  }
  return address;
}

async function bodyOf(request: IncomingMessage): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const part of request) parts.push(part as Uint8Array);
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The node request as a fetch `Request`, with credential headers redacted before anything records it. */
async function fetchRequestOf(request: IncomingMessage, origin: string, signal: AbortSignal): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await bodyOf(request);
  return new Request(new URL(request.url ?? "/", origin), {
    method,
    headers: redactHeaders(headers),
    signal,
    ...(body === undefined ? {} : { body }),
  });
}

async function writeResponse(response: Response, out: ServerResponse): Promise<void> {
  out.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    for await (const chunk of response.body) out.write(chunk);
  }
  out.end();
}

// A refused request gets a 400, which no adapter retries, so a broken script fails once instead of three times.
function refuse(out: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  out.writeHead(400, { "content-type": "application/json" });
  out.end(JSON.stringify({ type: "error", error: { type: "unexpected_request", message } }));
}

/** Appends log lines one at a time, so concurrent requests never interleave within a line. */
function logWriter(path: string | undefined): (entry: RecordedRequest) => Promise<void> {
  if (path === undefined) return async () => undefined;
  let queue = Promise.resolve();
  return (entry) => {
    queue = queue.then(async () => {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
    });
    return queue;
  };
}

function originOf(address: string, port: number): string {
  return address.includes(":") ? `http://[${address}]:${port}` : `http://${address}:${port}`;
}

function listen(server: Server, port: number, address: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      const bound = server.address();
      if (typeof bound === "object" && bound !== null && LOOPBACK_ADDRESS.test(bound.address)) resolve(bound.port);
      else reject(new GatewayError("invalid_options", "startMockServer(): the server did not bind to loopback"));
    });
  });
}

/** A mock transport that only reaches `origin`, sending through the global `fetch`. */
function serverTransport(origin: string): Transport {
  return markMockTransport(async (request: Request) => {
    if (new URL(request.url).origin !== origin) {
      throw new GatewayError("unexpected_request", `mock server transport: ${request.url} is not on ${origin}`);
    }
    return globalThis.fetch(request);
  });
}

/**
 * Starts an HTTP server on a loopback address that answers the n-th request with the n-th scripted response, like
 * `mockTransport()`. A request to another path, or one past the end of the script, gets a 400 error body. Throws a
 * `GatewayError` with code `invalid_options` for a `host` that isn't a loopback address, such as `0.0.0.0`.
 */
export async function startMockServer(options: MockServerOptions): Promise<MockServer> {
  const address = bindAddress(options.host);
  const { createServer } = await import("node:http");
  const play = mockTransport(options.api, options.script);
  const log = logWriter(options.log);
  let origin = "";
  const server = createServer(async (incoming, out) => {
    const aborted = new AbortController();
    out.once("close", () => aborted.abort(new Error("the client closed the connection")));
    const request = await fetchRequestOf(incoming, origin, aborted.signal);
    const response = play(request);
    // The transport records the request before it answers or refuses, so the log line comes first either way.
    await response.catch(() => undefined);
    const recorded = play.requests.at(-1);
    if (recorded !== undefined) await log(recorded);
    try {
      await writeResponse(await response, out);
    } catch (error) {
      if (!out.headersSent) refuse(out, error);
      else out.destroy(error instanceof Error ? error : undefined);
    }
  });
  const port = await listen(server, options.port ?? 0, address);
  origin = originOf(address, port);
  return {
    url: origin,
    requests: play.requests,
    transport: serverTransport(origin),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
