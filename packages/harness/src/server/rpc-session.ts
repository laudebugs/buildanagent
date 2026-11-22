/**
 * What the stdio and WebSocket transports share once a message is framed: the dispatcher connection, the envelope
 * check, the transport's own bounded error answers, and the fallbacks for a server message JSON can't carry. A
 * transport frames what its client sends, hands each parsed value to `handle()` or each framing error to `refuse()`,
 * and writes the lines `encode()` makes, so both transports answer the same bad message the same way.
 */
import {
  type ClientMessage,
  decode,
  ErrorCodes,
  encode,
  isProtocolError,
  type ProtocolError,
  type ServerMessage,
} from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { Connection, Dispatcher } from "./dispatcher.js";

/** The default of each transport's `writeTimeoutMs`. */
export const DEFAULT_WRITE_TIMEOUT_MS = 30_000;

/** The longest delay a timer takes; past it, `setTimeout` fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

/** Checks a transport's `writeTimeoutMs`, before it connects, and returns the value to use. */
export function checkWriteTimeout(ms: number | undefined): number {
  if (ms === undefined) return DEFAULT_WRITE_TIMEOUT_MS;
  if (ms === Number.POSITIVE_INFINITY || (Number.isInteger(ms) && ms > 0 && ms <= MAX_TIMER_MS)) return ms;
  throw new HarnessError(
    "invalid_transport_options",
    `writeTimeoutMs must be a whole number from 1 to ${MAX_TIMER_MS}, or Infinity, got ${ms}`,
  );
}

/**
 * How many of the transport's own error answers, for messages it could not read, may wait on a full output. Past
 * that, the client sends bad messages without reading the answers, and the transport stops, as the connection does
 * for refusals.
 */
const MAX_WAITING_ERRORS = 128;

/** The error answer to a server request that could not be written, handed back so the server stops waiting on it. */
const UNWRITABLE_REQUEST = { code: ErrorCodes.InternalError, message: "the server could not write this request" };

/** An error's message, or the thrown value as text, for a diagnostic line. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A refused value that answers a request: JSON-RPC never answers a response, even a malformed one. */
const isResponseLike = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !("method" in value) &&
  ("result" in value || "error" in value);

/** What a transport gives the session: where its lines go, where its diagnostics go, and how it stops. */
export interface RpcPeer {
  /** The prefix of every diagnostic, such as `stdio`. */
  readonly label: string;
  readonly log: (line: string) => void;
  /** Writes one line `encode()` made, newline included, and returns what to wait for when the output is full. */
  write(line: string): PromiseLike<void> | undefined;
  /** Stops the transport because the client broke a bound, or the dispatcher closed the connection. */
  stop(why: string): void;
}

/** One client's connection, and the answers the transport writes beside it, as the module comment describes. */
export class RpcSession {
  readonly #peer: RpcPeer;
  readonly #connection: Connection;
  /** Each command read whose response is not queued yet. */
  readonly #commands = new Set<Promise<void>>();
  /** The delivery the connection's queue waits on, if any, so a transport can wait for it before it closes. */
  #delivering: PromiseLike<void> | undefined;
  /** The transport's own error answers that wait on a full output. */
  #waitingErrors = 0;
  /** True once the transport closes the connection itself, so its own close is not taken for the server's. */
  #closing = false;

  /** Connects to `dispatcher`, which throws when it is closed. */
  constructor(dispatcher: Dispatcher, peer: RpcPeer) {
    this.#peer = peer;
    this.#connection = dispatcher.connect((message) => this.#deliver(message), {
      onClose: () => {
        if (!this.#closing) peer.stop("the connection closed");
      },
    });
  }

  /** The commands read whose responses are not queued yet. */
  get commands(): ReadonlySet<Promise<void>> {
    return this.#commands;
  }

  /** The delivery the connection's queue waits on, if any. */
  get delivering(): PromiseLike<void> | undefined {
    return this.#delivering;
  }

  /** Closes the connection; the dispatcher's own close of it is no longer reported as a stop. */
  close(): void {
    this.#closing = true;
    this.#connection.close();
  }

  /** Checks one parsed message's envelope and hands it to the connection, or answers why it can't. */
  handle(value: unknown): void {
    let message: ClientMessage;
    try {
      message = decode(value) as ClientMessage;
    } catch (error) {
      if (!isProtocolError(error)) throw error;
      if (isResponseLike(value)) {
        // The server's request it meant to answer still waits, as for any answer the server can't use.
        this.#peer.log(`${this.#peer.label}: ignored a malformed response: ${error.message}`);
        return;
      }
      this.refuse(error, ErrorCodes.InvalidRequest, "a message");
      return;
    }
    this.#track(this.#connection.receive(message));
  }

  /**
   * Logs and answers what the transport could not hand to the connection. An answer the output takes at once costs
   * nothing; one that waits on a full output counts until the output has room, and once 128 wait, the transport stops.
   */
  refuse(error: ProtocolError, fallbackCode: number, what: string): void {
    this.#peer.log(`${this.#peer.label}: refused ${what}: ${error.message}`);
    if (this.#waitingErrors >= MAX_WAITING_ERRORS) {
      this.#peer.stop(`${MAX_WAITING_ERRORS} error responses wait unread`);
      return;
    }
    const sent = this.#writeLine({
      jsonrpc: "2.0",
      id: error.requestId ?? null,
      error: { code: error.rpcCode ?? fallbackCode, message: error.message },
    } as ServerMessage);
    if (sent === undefined) return;
    this.#waitingErrors += 1;
    void Promise.resolve(sent).then(() => {
      this.#waitingErrors -= 1;
    });
  }

  /** Keeps a message the connection is handling until its response is queued, so a transport can wait for it. */
  #track(receiving: Promise<void>): void {
    const received = receiving.catch((error: unknown) => {
      this.#peer.log(`${this.#peer.label}: a message failed: ${messageOf(error)}`);
    });
    this.#commands.add(received);
    void received.then(() => this.#commands.delete(received));
  }

  /** The connection's `send`: writes one message and, when the output is full, returns what to wait for. */
  #deliver(message: ServerMessage): PromiseLike<void> | undefined {
    const sent = this.#writeLine(message);
    if (sent === undefined) return undefined;
    const tracked = Promise.resolve(sent).then(() => {
      if (this.#delivering === tracked) this.#delivering = undefined;
    });
    this.#delivering = tracked;
    return tracked;
  }

  #writeLine(message: ServerMessage): PromiseLike<void> | undefined {
    let line: string;
    try {
      line = encode(message);
    } catch (error) {
      this.#peer.log(`${this.#peer.label}: a server message could not be written: ${messageOf(error)}`);
      return this.#unwritable(message);
    }
    return this.#peer.write(line);
  }

  /**
   * Keeps a message JSON can't carry from leaving anyone waiting. A response goes out as an `InternalError`, so the
   * client gets an answer. A server request is answered back into the connection with an error, as if the client had
   * failed it, so a tool call ends with an error result. A notification is dropped.
   */
  #unwritable(message: ServerMessage): PromiseLike<void> | undefined {
    if (!("id" in message) || message.id === null) return undefined;
    if ("method" in message) {
      const answer = { jsonrpc: "2.0" as const, id: message.id, error: UNWRITABLE_REQUEST };
      // After this delivery returns, so the connection sees the answer once it has recorded the request. The answer
      // counts as a command read, so the end of the input waits for it before the connection closes.
      this.#track(Promise.resolve().then(() => this.#connection.receive(answer)));
      return undefined;
    }
    // The fallback waits for room like any line, so the connection's queue holds the next message meanwhile.
    return this.#peer.write(
      encode({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: ErrorCodes.InternalError, message: "the response could not be written" },
      }),
    );
  }
}
