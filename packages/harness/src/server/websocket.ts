/**
 * The WebSocket transport: one client on one socket, one JSON-RPC message per text frame. It takes the socket by the
 * standard `WebSocket` interface that Node and browsers share, so it needs no library and imports no Node module. Each
 * frame goes through the protocol's `JsonlFramer` as one line, so the rules for `\r` and U+2028 are the stdio
 * transport's, and then through the same `RpcSession` that stdio uses, so a bad message gets the same answer. A text
 * frame arrives as a JavaScript string, never as bytes, so the framer's UTF-8 check can't fail; the transport refuses
 * a string with a lone surrogate itself, because UTF-8 can't carry one.
 *
 * A socket reports no event when its send buffer empties, so the transport polls `bufferedAmount` while the buffer is
 * over its bound. One poll timer runs at a time, shared by every message that waits, and it is cleared once there is
 * room or the transport stops.
 */
import { ErrorCodes, JsonlFramer, ProtocolError } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { Dispatcher } from "./dispatcher.js";
import { checkWriteTimeout, RpcSession } from "./rpc-session.js";
import { Stopper } from "./stdio-streams.js";

/** A message event as the transport reads it: `data` is a string for a text frame and anything else for binary. */
export interface WebSocketMessageEvent {
  readonly data: unknown;
}

/** A close event as the transport reads it. Its `reason` is the peer's text, so the transport never logs it. */
export interface WebSocketCloseEvent {
  readonly code: number;
}

/**
 * A WebSocket as the transport uses it: the methods of the standard `WebSocket` interface, which the global `WebSocket`
 * of Node and browsers fits. A server-side socket must already be accepted and open when the transport takes it.
 */
export interface WebSocketLike {
  /** 1 while the socket is open; 2 and 3 once it is closing or closed. */
  readonly readyState: number;
  /**
   * The bytes sent but not yet handed to the network, which the transport's backpressure reads. A socket without it is
   * taken never to be full, so the transport writes to it without waiting.
   */
  readonly bufferedAmount?: number;
  /** Sends one text frame. */
  send(data: string): void;
  /** Closes the socket with a status code and a short reason. */
  close(code?: number, reason?: string): void;
  /** Adds the listener the transport reads frames with. */
  addEventListener(type: "message", listener: (event: WebSocketMessageEvent) => void): void;
  /** Adds the listener that tells the transport the peer closed the socket. */
  addEventListener(type: "close", listener: (event: WebSocketCloseEvent) => void): void;
  /** Adds the listener that tells the transport the socket failed. */
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  /** Removes the frame listener when the transport stops. */
  removeEventListener(type: "message", listener: (event: WebSocketMessageEvent) => void): void;
  /** Removes the close listener when the transport stops. */
  removeEventListener(type: "close", listener: (event: WebSocketCloseEvent) => void): void;
  /** Removes the failure listener when the transport stops. */
  removeEventListener(type: "error", listener: (event: unknown) => void): void;
}

/** What `webSocketTransport()` takes besides the dispatcher and the socket. */
export interface WebSocketOptions {
  /**
   * The most bytes one frame may hold: a text frame counted as UTF-8 without one trailing newline, and a binary frame
   * by its byte length, which the transport reads without reading the data. A longer frame is answered with
   * `InvalidRequest`, and the transport then closes the socket with code 1009. Default 8 MiB, the stdio transport's
   * bound on a line.
   */
  readonly maxMessageBytes?: number;
  /**
   * How many bytes may wait in the socket's send buffer before the transport waits for it to drain. While it waits,
   * the connection's queue holds the next message and drops live events past its size. Default 1 MiB.
   */
  readonly maxBufferedBytes?: number;
  /**
   * How long, in milliseconds, the send buffer may stay over `maxBufferedBytes` without shrinking. The clock restarts
   * each time the buffer shrinks, so a peer that reads slowly is never cut off; one that reads nothing for this long
   * stops the transport, which logs why and closes the socket with code 1008. The buffer is checked every 25 ms, so the
   * stop comes up to 25 ms late. A whole number from 1 to 2,147,483,647, or `Infinity` to wait forever. Default 30,000.
   */
  readonly writeTimeoutMs?: number;
  /** Stops the transport now: the connection closes, and the socket is closed with code 1000. */
  readonly signal?: AbortSignal;
  /**
   * Takes one line of the transport's own diagnostics, such as a frame it answered with an error or why it stopped. A
   * line never holds what the client sent. Default: diagnostics are dropped.
   */
  readonly log?: (line: string) => void;
}

const OPEN = 1;
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
/** How often a full send buffer is checked for room. */
const POLL_MS = 25;
/** WebSocket close codes (RFC 6455 §7.4.1). */
const NORMAL = 1000;
const POLICY_VIOLATION = 1008;
const MESSAGE_TOO_BIG = 1009;
const INTERNAL_ERROR = 1011;
/** A close frame's reason holds at most 123 bytes of UTF-8 (RFC 6455 §5.5.1). */
const MAX_CLOSE_REASON_BYTES = 123;

const encoder = new TextEncoder();
const NEWLINE = encoder.encode("\n");

/** `reason` cut to the bytes a close frame holds, on a whole character: `encodeInto()` writes only whole ones. */
function closeReason(reason: string): string {
  const { read } = encoder.encodeInto(reason, new Uint8Array(MAX_CLOSE_REASON_BYTES));
  return reason.slice(0, read);
}

function checkBytes(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new HarnessError("invalid_transport_options", `${name} must be a whole number of at least 1, got ${value}`);
}

/** A refusal the transport makes of a frame itself, before any JSON is read. */
const refusal = (message: string) =>
  new ProtocolError("invalid_request", message, { rpcCode: ErrorCodes.InvalidRequest, requestId: null });

/** A frame text with a lone surrogate, which has no UTF-8 form; `\p{Surrogate}` with `u` matches no paired one. */
const LONE_SURROGATE = /\p{Surrogate}/u;

/** The refusal of a frame UTF-8 can't carry, as the framer refuses a line that isn't UTF-8. */
const notUtf8 = () =>
  new ProtocolError("invalid_json", "a frame is not valid UTF-8 JSON", {
    rpcCode: ErrorCodes.ParseError,
    requestId: null,
  });

/**
 * A binary frame's size in bytes, read from its `byteLength` (an `ArrayBuffer`, a typed array or a `Buffer`) or its
 * `size` (a `Blob`) without reading its data, or `undefined` when it has neither.
 */
function binarySize(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const size = "byteLength" in data ? data.byteLength : "size" in data ? data.size : undefined;
  return typeof size === "number" ? size : undefined;
}

/** `text` without one trailing `\n` or `\r\n`, which ends the message as it ends a stdio line and is not counted. */
const withoutNewline = (text: string): string =>
  text.endsWith("\r\n") ? text.slice(0, -2) : text.endsWith("\n") ? text.slice(0, -1) : text;

/**
 * Serves one client over one open WebSocket, one JSON-RPC 2.0 message per text frame, and resolves once the client is
 * gone or the transport stops. The host accepts the socket, and whatever authenticates the peer happens there: the
 * transport authenticates nobody, so whoever holds the socket acts as the dispatcher's user.
 *
 * Each frame must hold exactly one message, one line of JSON; a trailing newline is allowed and not needed. A frame
 * that isn't JSON, or holds a lone surrogate, is answered with `ParseError`. A binary frame, a frame with more than one
 * line or none, a batch, and a message without a valid envelope are answered with `InvalidRequest`. The transport
 * never decodes a binary frame, so a binary, empty, multi-message or batch frame, and one that isn't JSON, is answered
 * with a `null` id; a message whose envelope is bad but holds a valid id is answered with that id. A malformed
 * response is only logged, because JSON-RPC never answers a response. None of these ends the transport, except a
 * frame over `maxMessageBytes`, text or binary, after which the socket is closed with code 1009. The transport also
 * stops once 128 of its error answers wait on a full send buffer. Each message the server sends is one text frame
 * with no trailing newline.
 *
 * What the server sends waits while the socket's `bufferedAmount` is over `maxBufferedBytes`, so a client that stops
 * reading holds the connection's queue, which drops live events past its size instead of buffering them. A buffer
 * that does not shrink for `writeTimeoutMs` stops the transport.
 *
 * The transport serves one socket. A client that reconnects comes back on a new socket, which the host serves with a
 * new call, and sends `session/open` with `fromSeq` to get the entries it missed; the dispatcher keeps the session,
 * its running turn and its pending requests meanwhile.
 *
 * The peer's close, or a socket error, stops the transport, and it logs the close code but never the peer's reason.
 * It closes the socket only when it stops itself: with 1008 when the client breaks a bound (128 error answers or
 * refusals unread, or a send buffer that never drains), 1009 for a frame that is too big, 1011 when the socket's
 * `send()` throws, and 1000 when `signal` aborts. Either way it removes its listeners and closes the connection. A
 * turn the client started goes on in the dispatcher. An option out of range, or a socket that is not open, rejects
 * with a `HarnessError`, code `invalid_transport_options`, before the transport connects.
 */
export async function webSocketTransport(
  dispatcher: Dispatcher,
  socket: WebSocketLike,
  options: WebSocketOptions = {},
): Promise<void> {
  const limits: Limits = {
    maxMessageBytes: checkBytes("maxMessageBytes", options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES),
    maxBufferedBytes: checkBytes("maxBufferedBytes", options.maxBufferedBytes, DEFAULT_MAX_BUFFERED_BYTES),
    writeTimeoutMs: checkWriteTimeout(options.writeTimeoutMs),
  };
  if (socket.readyState !== OPEN) {
    throw new HarnessError("invalid_transport_options", "the socket must be open when the transport takes it");
  }
  await new WebSocketSession(dispatcher, socket, options.log ?? (() => undefined), limits).run(options.signal);
}

interface Limits {
  readonly maxMessageBytes: number;
  readonly maxBufferedBytes: number;
  readonly writeTimeoutMs: number;
}

/** One socket's run of the transport, and the close code it owes the socket if it stops itself. */
class WebSocketSession {
  readonly #socket: WebSocketLike;
  readonly #log: (line: string) => void;
  readonly #limits: Limits;
  readonly #stopper = new Stopper();
  readonly #framer: JsonlFramer;
  readonly #rpc: RpcSession;
  /** The code to close the socket with once the run ends, or `undefined` when the peer already closed it. */
  #closeCode: number | undefined = POLICY_VIOLATION;
  /** The one wait for room while the send buffer is full, shared by every message sent meanwhile. */
  #full: Promise<void> | undefined;

  constructor(dispatcher: Dispatcher, socket: WebSocketLike, log: (line: string) => void, limits: Limits) {
    this.#socket = socket;
    this.#log = log;
    this.#limits = limits;
    // The frame is checked against the bound before it is framed, so the framer's own bound never cuts it.
    this.#framer = new JsonlFramer({ maxLineBytes: limits.maxMessageBytes });
    this.#rpc = new RpcSession(dispatcher, {
      label: "websocket",
      log,
      write: (line) => this.#send(line),
      // The client broke a bound, or the dispatcher closed the connection for refusals it left unread.
      stop: (why) => this.#stop(why, POLICY_VIOLATION),
    });
  }

  async run(signal: AbortSignal | undefined): Promise<void> {
    const stopped = new Promise<void>((resolve) => this.#stopper.onStop(resolve));
    const onMessage = (event: WebSocketMessageEvent) => this.#receive(event.data);
    const onClose = (event: WebSocketCloseEvent) => {
      const code = Number.isInteger(event.code) ? ` with code ${event.code}` : "";
      this.#stop(`the peer closed the socket${code}`, undefined);
    };
    const onError = () => this.#stop("the socket failed", undefined);
    const onAbort = () => this.#stop("the signal aborted", NORMAL);
    this.#socket.addEventListener("message", onMessage);
    this.#socket.addEventListener("close", onClose);
    this.#socket.addEventListener("error", onError);
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await stopped;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.#socket.removeEventListener("message", onMessage);
      this.#socket.removeEventListener("close", onClose);
      this.#socket.removeEventListener("error", onError);
      this.#rpc.close();
    }
    const reason = this.#stopper.reason ?? "the transport finished";
    this.#closeSocket(reason);
    this.#log(`websocket: stopped: ${reason}`);
  }

  /** Stops the run once, remembering the close code the socket is owed: `undefined` when the peer already closed it. */
  #stop(why: string, closeCode: number | undefined): void {
    if (this.#stopper.stopped) return;
    this.#closeCode = closeCode;
    this.#stopper.stop(why);
  }

  #closeSocket(reason: string): void {
    if (this.#closeCode === undefined || this.#socket.readyState !== OPEN) return;
    try {
      this.#socket.close(this.#closeCode, closeReason(reason));
    } catch (error) {
      this.#log(`websocket: the socket could not be closed: ${error instanceof Error ? error.name : "unknown error"}`);
    }
  }

  /** Reads one frame: refuses what is not one text message, and hands the message to the session. */
  #receive(data: unknown): void {
    if (this.#stopper.stopped) return;
    if (typeof data !== "string") {
      this.#refuseBinary(data);
      return;
    }
    const text = withoutNewline(data);
    if (this.#tooBig(text)) {
      this.#refuseTooBig();
      return;
    }
    // `TextEncoder` would write a lone surrogate as U+FFFD, so the frame is refused as stdio refuses bad UTF-8.
    if (LONE_SURROGATE.test(text)) {
      this.#rpc.refuse(notUtf8(), ErrorCodes.ParseError, "a frame");
      return;
    }
    const framed = this.#framer.push(encoder.encode(text));
    framed.push(...this.#framer.push(NEWLINE));
    const [only] = framed;
    if (framed.length !== 1 || only === undefined) {
      const why = framed.length === 0 ? "a frame must hold a message" : "a frame must hold one message, on one line";
      this.#rpc.refuse(refusal(why), ErrorCodes.InvalidRequest, "a frame");
      return;
    }
    if (only.ok) this.#rpc.handle(only.value);
    else this.#rpc.refuse(only.error, ErrorCodes.ParseError, "a frame");
  }

  /** Refuses a binary frame, without reading its data: a frame over the bound also stops the transport. */
  #refuseBinary(data: unknown): void {
    const size = binarySize(data);
    if (size !== undefined && size > this.#limits.maxMessageBytes) this.#refuseTooBig();
    else this.#rpc.refuse(refusal("a frame must be text, not binary"), ErrorCodes.InvalidRequest, "a frame");
  }

  /** Answers a frame over the bound, then stops the transport, which closes the socket with 1009. */
  #refuseTooBig(): void {
    const why = `a frame went over the bound of ${this.#limits.maxMessageBytes} bytes`;
    this.#rpc.refuse(refusal(why), ErrorCodes.InvalidRequest, "a frame");
    this.#stop(why, MESSAGE_TOO_BIG);
  }

  /** Whether `text` holds more UTF-8 bytes than the bound, encoding it only when its length can't tell. */
  #tooBig(text: string): boolean {
    const bound = this.#limits.maxMessageBytes;
    // A UTF-16 code unit takes one to three bytes, and a pair of them four.
    if (text.length > bound) return true;
    if (text.length * 3 <= bound) return false;
    return encoder.encode(text).length > bound;
  }

  /** Sends one line as a frame and, when the send buffer is over its bound, returns the wait for room. */
  #send(line: string): PromiseLike<void> | undefined {
    if (this.#stopper.stopped) return undefined;
    try {
      // `encode()` ends the line with `\n`; a frame is already one message, so it goes without.
      this.#socket.send(line.slice(0, -1));
    } catch (error) {
      // The socket may still be open, so it is closed as a server failure; the error's message is not logged.
      this.#stop(
        `the socket refused a frame: ${error instanceof Error ? error.name : "unknown error"}`,
        INTERNAL_ERROR,
      );
      return undefined;
    }
    if (this.#buffered() <= this.#limits.maxBufferedBytes) return undefined;
    this.#full ??= this.#room();
    return this.#full;
  }

  #buffered(): number {
    const amount = this.#socket.bufferedAmount;
    return typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  }

  /**
   * Resolves once the send buffer is back within its bound, or the transport stops. It checks every 25 ms with one
   * timer at a time, and stops the transport once the buffer has not shrunk for `writeTimeoutMs`. The timer is cleared
   * however the wait ends.
   */
  #room(): Promise<void> {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
      let last = this.#buffered();
      let idleMs = 0;
      const done = () => {
        globalThis.clearTimeout(timer);
        off();
        this.#full = undefined;
        resolve();
      };
      const off = this.#stopper.onStop(done);
      const poll = () => {
        const now = this.#buffered();
        if (now <= this.#limits.maxBufferedBytes) {
          done();
          return;
        }
        idleMs = now < last ? 0 : idleMs + POLL_MS;
        last = now;
        if (idleMs >= this.#limits.writeTimeoutMs) {
          // Stopping ends this wait through `done`.
          this.#stop(`the peer read nothing for ${this.#limits.writeTimeoutMs} ms`, POLICY_VIOLATION);
          return;
        }
        timer = globalThis.setTimeout(poll, POLL_MS);
      };
      timer = globalThis.setTimeout(poll, POLL_MS);
    });
  }
}
