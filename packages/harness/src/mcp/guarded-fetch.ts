/**
 * The fetch every request to a remote MCP server goes through, whatever reaches the network under it. It sends to the
 * configured origin only, follows no redirect, refuses a `401` with a clear error, checks the server's session id, caps
 * how many responses are open, and hands the client library a body it bounds: by bytes, by time, and for an event
 * stream by line and by event, with the server's `retry` field removed so the server can't set the reconnect delay.
 */
import { shortText } from "./content.js";
import type { RemoteSettings } from "./remote-config.js";

/** A fetch, as the client library calls it. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

// What a server's session id may be: visible ASCII, at most 256 characters. It is a token the server chose, so the
// harness checks its form and trusts nothing else about it.
const SESSION_ID = /^[\x21-\x7e]{1,256}$/;
// An event id the client may send back as `Last-Event-ID`: printable ASCII, at most 256 bytes.
const MAX_EVENT_ID_BYTES = 256;
const CR = 0x0d;
const LF = 0x0a;
const COLON = 0x3a;
const SPACE = 0x20;
const encoder = new TextEncoder();
const RETRY = encoder.encode("retry");
const ID = encoder.encode("id");
const BODILESS = [204, 205];
const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
const NEWLINE = new Uint8Array([LF]);

/** An error from the guard, with a code the connection maps to a clear message. */
export class RemoteRefusal extends Error {
  /**
   * `too_large` for a body, an event or a line past its bound; `full` for a stream past `maxStreamBytes` in all;
   * `timeout` for a time bound.
   */
  readonly code: "unauthorized" | "redirect" | "refused" | "too_large" | "full" | "timeout";
  constructor(code: RemoteRefusal["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** Whether an event-stream line's field is `name`: the bytes before its first colon, or the whole line. */
function fieldIs(line: Uint8Array, name: Uint8Array): boolean {
  return startsWith(line, name) && (line.length === name.length || line[name.length] === COLON);
}

/** Whether an `id:` line carries an id the client may send back: printable ASCII and short. */
function usableId(line: Uint8Array): boolean {
  let value = line.subarray(Math.min(line.length, ID.length + 1));
  if (value[0] === SPACE) value = value.subarray(1);
  return value.length <= MAX_EVENT_ID_BYTES && value.every((byte) => byte >= SPACE && byte <= 0x7e);
}

/** Whether a line passes on: every line but `retry:` and an `id:` the client could not send back. */
const kept = (line: Uint8Array): boolean => !(fieldIs(line, RETRY) || (fieldIs(line, ID) && !usableId(line)));

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

/** The index of the next CR or LF in `chunk` from `from`, or -1. */
function nextBreak(chunk: Uint8Array, from: number): number {
  for (let index = from; index < chunk.length; index += 1) {
    if (chunk[index] === CR || chunk[index] === LF) return index;
  }
  return -1;
}

/**
 * Splits an event stream into lines, passes each on with an LF after it unless it is dropped, and fails a line or an
 * event over `max` bytes. A line ends at CR, LF or CRLF, as the event-stream format says; each is passed on as LF, so
 * dropping a line between a CR and an LF can't join them into one line end and hide a blank line. It drops every
 * `retry:` line and every `id:` line whose id the client could not send back, so neither can steer the reconnects.
 */
class EventFilter {
  readonly #max: number;
  // The start of a line that has no end yet, in one buffer that grows by doubling, so a line sent a byte at a time
  // costs its bytes and not an array of one-byte pieces.
  #pending = new Uint8Array(0);
  #pendingBytes = 0;
  #eventBytes = 0;
  // A chunk that ended in CR may have its LF at the start of the next one, which is part of the same line end.
  #crEnded = false;
  #started = false;
  #head = new Uint8Array(0);

  constructor(max: number) {
    this.#max = max;
  }

  /** The bytes to pass on for this chunk, or an error message when a bound is broken. */
  push(input: Uint8Array): Uint8Array | string {
    // An empty chunk changes nothing, so it can't end a CRLF that spans two chunks.
    const chunk = input.length === 0 ? undefined : this.#opening(input);
    if (chunk === undefined || chunk.length === 0) return new Uint8Array(0);
    const out: Uint8Array[] = [];
    let start = this.#startOf(chunk);
    for (let index = nextBreak(chunk, start); index !== -1; index = nextBreak(chunk, start)) {
      const crlf = chunk[index] === CR && chunk[index + 1] === LF;
      const end = crlf ? index + 2 : index + 1;
      const failure = this.#line(chunk.subarray(start, index), out);
      if (failure !== undefined) return failure;
      if (chunk[index] === CR && end === chunk.length) this.#crEnded = true;
      start = end;
    }
    return this.#keepRest(chunk.subarray(start)) ?? concat(out);
  }

  /**
   * The stream's first bytes without a byte order mark, which the format ignores, so the first field reads as it is.
   * A mark can arrive split across chunks, so bytes that could still start one are held until the mark is whole or
   * ruled out; `undefined` while they are held.
   */
  #opening(input: Uint8Array): Uint8Array | undefined {
    if (this.#started) return input;
    const joined = this.#head.length === 0 ? input : concat([this.#head, input]);
    if (joined.length < BOM.length && joined.every((byte, index) => byte === BOM[index])) {
      this.#head = joined.slice();
      return undefined;
    }
    this.#started = true;
    this.#head = new Uint8Array(0);
    return startsWith(joined, BOM) ? joined.subarray(BOM.length) : joined;
  }

  /** Where a chunk's lines start: after the LF of a CRLF the last chunk ended. */
  #startOf(chunk: Uint8Array): number {
    const start = this.#crEnded && chunk[0] === LF ? 1 : 0;
    this.#crEnded = false;
    return start;
  }

  /** Ends one line: checks its size and its event's, and passes it on with an LF unless it is dropped. */
  #line(piece: Uint8Array, out: Uint8Array[]): string | undefined {
    const line = this.#pendingBytes === 0 ? piece : concat([this.#pending.subarray(0, this.#pendingBytes), piece]);
    this.#pending = new Uint8Array(0);
    this.#pendingBytes = 0;
    // An event holds its lines, so the event's bound is also each line's; `#keepRest()` bounds a line still open.
    this.#eventBytes = line.length === 0 ? 0 : this.#eventBytes + line.length;
    if (this.#eventBytes > this.#max) return `an event over ${this.#max} bytes`;
    if (kept(line)) out.push(concat([line, NEWLINE]));
    return undefined;
  }

  #keepRest(rest: Uint8Array): string | undefined {
    if (rest.length === 0) return undefined;
    if (this.#pendingBytes + rest.length > this.#max) return `an event-stream line over ${this.#max} bytes`;
    const needed = this.#pendingBytes + rest.length;
    if (needed > this.#pending.length) {
      const grown = new Uint8Array(Math.min(this.#max, Math.max(needed, this.#pending.length * 2, 1024)));
      grown.set(this.#pending.subarray(0, this.#pendingBytes));
      this.#pending = grown;
    }
    this.#pending.set(rest, this.#pendingBytes);
    this.#pendingBytes = needed;
    return undefined;
  }
}

const unref = (timer: unknown): void => {
  (timer as { unref?: () => void } | undefined)?.unref?.();
};

/** A timer that never holds a Node process open. */
function later(run: () => void, ms: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(run, ms);
  unref(timer);
  return timer;
}

/** One read, or `idle` when nothing came for `ms`; with no `ms`, the read alone. */
async function readWithin(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  ms: number | undefined,
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>> | "idle"> {
  if (ms === undefined) return reader.read();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const quiet = new Promise<"idle">((resolve) => {
    timer = later(() => resolve("idle"), ms);
  });
  try {
    return await Promise.race([reader.read(), quiet]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A body that ends with an error once it passes a bound: `maxMessageBytes` for a JSON body, `maxStreamBytes` in all,
 * no byte for `streamIdleMs`, or open longer than `maxStreamMs`. An event stream is filtered as `EventFilter` says.
 * An `endless` stream, a legacy SSE server's one stream, has only the per-event and per-line bounds. `done` runs once,
 * however the body ends.
 */
function boundedBody(
  source: ReadableStream<Uint8Array>,
  settings: RemoteSettings,
  body: {
    readonly events: boolean;
    readonly endless: boolean;
    readonly done: () => void;
    readonly broken: (error: RemoteRefusal) => void;
  },
): ReadableStream<Uint8Array> {
  const { events, endless, done } = body;
  const reader = source.getReader();
  const filter = events ? new EventFilter(settings.maxMessageBytes) : undefined;
  const cap = endless
    ? Number.POSITIVE_INFINITY
    : events
      ? settings.maxStreamBytes
      : Math.min(settings.maxMessageBytes, settings.maxStreamBytes);
  const code = events ? "full" : "too_large";
  const idleMs = endless ? undefined : settings.streamIdleMs;
  let total = 0;
  let finished = false;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(lifetime);
    done();
  };
  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, error: unknown) => {
    reader.cancel().catch(() => {});
    if (finished) return;
    controller.error(error);
    finish();
    if (error instanceof RemoteRefusal) body.broken(error);
  };
  /** The bytes to pass on for one chunk; it throws when the chunk breaks a bound. */
  const pass = (chunk: Uint8Array): Uint8Array => {
    total += chunk.length;
    if (total > cap) throw new RemoteRefusal(code, `a response passed ${cap} bytes`);
    const passed = filter === undefined ? chunk : filter.push(chunk);
    if (typeof passed === "string") throw new RemoteRefusal("too_large", `the server sent ${passed}`);
    return passed;
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (endless) return;
      lifetime = later(
        () => fail(controller, new RemoteRefusal("timeout", `a response stayed open past ${settings.maxStreamMs} ms`)),
        settings.maxStreamMs,
      );
    },
    async pull(controller) {
      try {
        // A pull that enqueues nothing is not called again, so it reads on until a chunk has bytes to pass.
        let passed: Uint8Array | undefined;
        while (passed === undefined || passed.length === 0) {
          const read = await readWithin(reader, idleMs);
          if (finished) return;
          if (read === "idle")
            throw new RemoteRefusal("timeout", `a response sent nothing for ${settings.streamIdleMs} ms`);
          if (read.done) {
            controller.close();
            finish();
            return;
          }
          passed = pass(read.value);
        }
        controller.enqueue(passed);
      } catch (error) {
        fail(controller, error);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason).catch(() => {});
    },
  });
}

const isEventStream = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() === "text/event-stream";

/** Cancels a body nobody will read, so its connection closes. */
const discard = (response: Response): void => {
  response.body?.cancel().catch(() => {});
};

/**
 * What a response is for: `request` answers one request; `get` is a streamable HTTP server's `GET` stream and
 * `listen` a `subscriptions/listen` stream, both meant to stay open and both opened again when they end; `events` is
 * a legacy SSE server's one stream, which nothing can open again.
 */
export type StreamKind = "request" | "get" | "listen" | "events";

/**
 * The checks a remote server's fetch adds. `onGet` decides whether a `GET` may go out; false refuses it. `endless`
 * marks a `GET` as a legacy SSE server's one stream, which has no time or total-byte bound. `onBroken` hears of a body
 * cut for a bound: `fatal` for an event, a line or a body past its size, or any bound on the answer to one request,
 * since the server is then broken or hostile. A time or total-byte cut of a `get` or `listen` stream is planned, not
 * fatal: the stream ends and is opened again.
 */
export interface GuardHooks {
  readonly onGet?: () => boolean;
  readonly endless?: boolean;
  readonly onBroken?: (error: RemoteRefusal, fatal: boolean, kind: StreamKind) => void;
  readonly log: (line: string) => void;
}

/** The kind of stream a request opens. */
function kindOf(method: string, body: RequestInit["body"], endless: boolean): StreamKind {
  if (method === "GET") return endless ? "events" : "get";
  if (typeof body !== "string") return "request";
  try {
    return (JSON.parse(body) as { method?: unknown }).method === "subscriptions/listen" ? "listen" : "request";
  } catch {
    return "request";
  }
}

/** Refuses a request the client must not send: one that leaves the origin, a `GET` the hooks refuse, one too many. */
function refusalOf(
  url: URL,
  method: string,
  settings: RemoteSettings,
  hooks: GuardHooks,
  open: number,
): RemoteRefusal | undefined {
  // The client may only speak to the configured origin: an `endpoint` event or a redirect can't send it elsewhere.
  if (url.origin !== settings.url.origin || url.username !== "" || url.password !== "") {
    return new RemoteRefusal("refused", "a request left the server's origin, so it was not sent");
  }
  if (method === "GET" && hooks.onGet?.() === false) {
    return new RemoteRefusal("refused", "the server's event stream may not be opened again");
  }
  if (open >= settings.maxStreams) {
    return new RemoteRefusal("refused", `${settings.maxStreams} responses are already open on this connection`);
  }
  return undefined;
}

/** The request's headers with the configured ones set over them. */
function headersOf(init: RequestInit, settings: RemoteSettings): Headers {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(settings.headers)) headers.set(name, value);
  return headers;
}

/** Calls `base` with the headers timeout: the response must begin within `headersTimeoutMs`. */
async function within(base: FetchLike, url: URL, init: RequestInit, settings: RemoteSettings): Promise<Response> {
  const timer = new AbortController();
  const waited = later(
    () => timer.abort(new RemoteRefusal("timeout", `no response began within ${settings.headersTimeoutMs} ms`)),
    settings.headersTimeoutMs,
  );
  const signal = init.signal == null ? timer.signal : AbortSignal.any([init.signal, timer.signal]);
  try {
    return await base(url, { ...init, signal, redirect: "manual" });
  } catch (error) {
    throw timer.signal.aborted ? timer.signal.reason : error;
  } finally {
    clearTimeout(waited);
  }
}

/** `base` wrapped in the checks this module describes. */
export function guardedFetch(base: FetchLike, settings: RemoteSettings, hooks: GuardHooks): FetchLike {
  let open = 0;
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.href);
    const method = (init.method ?? "GET").toUpperCase();
    const refusal = refusalOf(url, method, settings, hooks, open);
    if (refusal !== undefined) throw refusal;
    open += 1;
    let counted = true;
    const release = () => {
      if (counted) open -= 1;
      counted = false;
    };
    let response: Response;
    try {
      response = await within(base, url, { ...init, method, headers: headersOf(init, settings) }, settings);
    } catch (error) {
      release();
      throw error;
    }
    try {
      return checked(response, settings, hooks, { release, kind: kindOf(method, init.body, hooks.endless === true) });
    } catch (error) {
      release();
      discard(response);
      throw error;
    }
  };
}

/** Throws for a response the client must not read: a redirect, a 401 or a session id of the wrong form. */
function refuseResponse(response: Response): void {
  const status = response.status;
  // No MCP request is conditional, so a 304 answers nothing the client asked; it is refused for what it is.
  if (status === 304)
    throw new RemoteRefusal("refused", "the server answered 304 Not Modified to a request that asked for no cache");
  if ((status >= 300 && status < 400) || response.type === "opaqueredirect") {
    throw new RemoteRefusal("redirect", `the server answered with a redirect (HTTP ${status}), which is not followed`);
  }
  if (status === 401) {
    throw new RemoteRefusal(
      "unauthorized",
      "the server asked for authorization (HTTP 401); this harness runs no authorization flow, so give the credential in the transport's headers",
    );
  }
  const session = response.headers.get("mcp-session-id");
  if (session !== null && !SESSION_ID.test(session)) {
    throw new RemoteRefusal("refused", "the server sent a session id that is not 1 to 256 visible ASCII characters");
  }
}

function checked(
  response: Response,
  settings: RemoteSettings,
  hooks: GuardHooks,
  stream: { readonly release: () => void; readonly kind: StreamKind },
): Response {
  const { release } = stream;
  refuseResponse(response);
  const { status, statusText, headers } = response;
  if (response.body === null || BODILESS.includes(status)) {
    discard(response);
    release();
    return new Response(null, { status, statusText, headers });
  }
  if (status >= 400) hooks.log(`the server answered HTTP ${status} ${shortText(statusText, 64)}`);
  const { kind } = stream;
  const reopens = kind === "get" || kind === "listen";
  const body = boundedBody(response.body, settings, {
    events: isEventStream(response),
    // Only an event stream is the one channel of a legacy SSE server; any other body on that GET, such as an error
    // page, is bounded like any answer.
    endless: kind === "events" && isEventStream(response),
    done: release,
    broken: (error) => hooks.onBroken?.(error, error.code === "too_large" || !reopens, kind),
  });
  return new Response(body, { status, statusText, headers });
}
