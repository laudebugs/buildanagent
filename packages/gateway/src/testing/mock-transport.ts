/**
 * `mockTransport()`: an in-process fake of a provider's HTTP API that replays scripted responses, so adapter tests run
 * the real wire format with no socket. It records every request it receives, and it can split a response body into
 * chunks anywhere, including inside a multi-byte character or a tool call's JSON.
 */
import { GatewayError } from "../errors.js";
import { markMockTransport } from "../request-policy.js";

/** The wire protocols a mock transport can stand in for. */
export type WireApi = "anthropic-messages" | "openai-chat";

/** One scripted HTTP response. */
export interface WireResponse {
  /** The HTTP status. Defaults to 200. */
  readonly status?: number;
  /**
   * Response headers. `content-type` defaults to `text/event-stream` for a 2xx status and `application/json`
   * otherwise.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** The body: server-sent events or JSON as text, or a value that is sent as JSON. */
  readonly body: string | object;
  /** Splits the body into chunks of this many bytes. Without it or `splitAt`, the body arrives in one chunk. */
  readonly chunkSize?: number;
  /** Splits the body at these byte offsets, in ascending order. Takes precedence over `chunkSize`. */
  readonly splitAt?: readonly number[];
}

/** The responses a mock transport plays, one per request, in order. */
export type WireScript = readonly WireResponse[];

/** A request as the mock transport received it. A JSON body is parsed; any other body stays text. */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  /** The request headers, with lower-case names. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

/** A transport that replays a script, with the requests it has received so far. */
export interface MockTransport {
  (request: Request): Promise<Response>;
  /** Every request received so far, in order. */
  readonly requests: readonly RecordedRequest[];
}

// The request path each protocol posts to, so a test fails when an adapter calls the wrong endpoint.
const PATHS: Readonly<Record<WireApi, string>> = {
  "anthropic-messages": "/v1/messages",
  "openai-chat": "/chat/completions",
};

function chunksOf(bytes: Uint8Array, response: WireResponse): Uint8Array[] {
  const cuts = response.splitAt ?? [];
  const size = response.chunkSize;
  const offsets =
    cuts.length > 0
      ? [...cuts]
      : size !== undefined && size > 0
        ? Array.from({ length: Math.ceil(bytes.length / size) - 1 }, (_, i) => (i + 1) * size)
        : [];
  const bounds = [0, ...offsets.filter((offset) => offset > 0 && offset < bytes.length), bytes.length];
  return bounds.slice(1).map((end, i) => bytes.slice(bounds[i], end));
}

/** A body stream that enqueues one chunk per read and fails with the signal's reason once the request is aborted. */
function bodyStream(chunks: Uint8Array[], signal: AbortSignal): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (signal.aborted) {
        controller.error(signal.reason);
        return;
      }
      const chunk = chunks[next];
      next += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
}

async function record(request: Request): Promise<RecordedRequest> {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const text = await request.clone().text();
  let body: unknown = text;
  if (headers["content-type"]?.includes("json")) {
    try {
      body = JSON.parse(text);
    } catch {
      // A body that claims to be JSON and isn't stays text, so the test can see what was sent.
    }
  }
  return { url: request.url, method: request.method, headers, body };
}

function responseFor(scripted: WireResponse, signal: AbortSignal): Response {
  const status = scripted.status ?? 200;
  const text = typeof scripted.body === "string" ? scripted.body : JSON.stringify(scripted.body);
  const contentType = status >= 200 && status < 300 ? "text/event-stream" : "application/json";
  const headers = new Headers({ "content-type": contentType, ...scripted.headers });
  const chunks = chunksOf(new TextEncoder().encode(text), scripted);
  return new Response(bodyStream(chunks, signal), { status, headers });
}

/**
 * Creates a transport that answers the n-th request with the n-th scripted response. It is marked as a mock, so it
 * works while real model requests are turned off. A request to a path other than the protocol's endpoint, or one
 * past the end of the script, throws a `GatewayError` with code `unexpected_request`.
 */
export function mockTransport(api: WireApi, script: WireScript): MockTransport {
  const path = PATHS[api];
  if (path === undefined) throw new GatewayError("invalid_options", `mockTransport(): unknown wire API ${String(api)}`);
  const requests: RecordedRequest[] = [];
  const transport = async (request: Request): Promise<Response> => {
    requests.push(await record(request));
    if (!new URL(request.url).pathname.endsWith(path)) {
      throw new GatewayError(
        "unexpected_request",
        `mockTransport(${api}): expected a request to ${path}, got ${request.url}`,
      );
    }
    const scripted = script[requests.length - 1];
    if (scripted === undefined) {
      throw new GatewayError(
        "unexpected_request",
        `mockTransport(${api}): request ${requests.length} has no scripted response (the script has ${script.length})`,
      );
    }
    return responseFor(scripted, request.signal);
  };
  return markMockTransport(Object.assign(transport, { requests }));
}

/** Writes events as a server-sent event stream, naming each event after its `type` field. */
export function serverSentEvents(events: readonly { readonly type: string }[]): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}
