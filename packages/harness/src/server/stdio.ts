/**
 * The stdio transport: one client on a byte stream in each direction, one JSON-RPC message per line. It reads with the
 * protocol's `JsonlFramer`, which splits on `\n` only, checks each message's envelope with `decode()`, and hands it to
 * a dispatcher connection. What the server sends goes out through `encode()`. When the output is full, the connection's
 * queue waits for it to drain before it hands over the next message. A client that stops reading therefore slows the
 * server down instead of growing its memory, because the queue bounds what waits, as `outbox.ts` says. The input goes
 * on being read meanwhile, and the connection's limit of 128 unanswered commands bounds what a client that sends
 * without reading costs.
 *
 * The output carries protocol lines and nothing else. The transport's own diagnostics go to `log`, which a host points
 * at stderr. The file is portable: it takes Node or Web streams by their shape and imports no Node module, so a Worker
 * can serve it without a rewrite.
 */
import {
  type ClientMessage,
  decode,
  ErrorCodes,
  encode,
  type FramedMessage,
  isProtocolError,
  JsonlFramer,
  type ProtocolError,
  type ServerMessage,
} from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { Connection, Dispatcher } from "./dispatcher.js";
import {
  type ChunkReader,
  chunkReader,
  type LineWriter,
  lineWriter,
  type StdioInput,
  type StdioOutput,
  Stopper,
} from "./stdio-streams.js";

export type { NodeInput, NodeOutput, StdioInput, StdioOutput } from "./stdio-streams.js";

/** The streams `stdioTransport()` serves a client over. */
export interface StdioIo {
  /** What the client sends. Its end is the client's goodbye. */
  readonly input: StdioInput;
  /** What the server sends: protocol lines only. */
  readonly output: StdioOutput;
  /**
   * Takes one line of the transport's own diagnostics, such as a malformed line it answered with an error. Point it at
   * stderr, never at `output`. A line never holds what the client sent. Default: diagnostics are dropped.
   */
  readonly log?: (line: string) => void;
}

/** What `stdioTransport()` takes besides the dispatcher and the streams. */
export interface StdioOptions {
  /** The most bytes one input line may hold, newline excluded. A longer line is answered with an error. Default 8 MiB. */
  readonly maxLineBytes?: number;
  /** Stops the transport now: the connection closes, and nothing more is read or waited for. */
  readonly signal?: AbortSignal;
  /**
   * How long, in milliseconds, the output may take to take each queued line once the input has ended. The limit is per
   * line: the clock starts when the transport begins to wait for the output and restarts each time the output takes a
   * whole line, because an output reports no progress within a line. A client that goes on reading is therefore cut
   * off only when one line takes longer than this, so a host that sends very large lines to slow clients raises it. A
   * client that has closed its input and takes no line for this long ends the transport: it logs why and closes the
   * connection, as for a failed output. While the input is open there is no timeout, because the queue already bounds
   * what a slow client costs, and the time the dispatcher takes to answer a command does not count. A whole number
   * from 1 to 2,147,483,647, or `Infinity` to wait forever. Default 30,000 (30 seconds).
   */
  readonly writeTimeoutMs?: number;
}

/** The default of `StdioOptions.writeTimeoutMs`. */
const DEFAULT_WRITE_TIMEOUT_MS = 30_000;

/** The longest delay a timer takes; past it, `setTimeout` fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

function checkWriteTimeout(ms: number | undefined): number {
  if (ms === undefined) return DEFAULT_WRITE_TIMEOUT_MS;
  if (ms === Number.POSITIVE_INFINITY || (Number.isInteger(ms) && ms > 0 && ms <= MAX_TIMER_MS)) return ms;
  throw new HarnessError(
    "invalid_transport_options",
    `writeTimeoutMs must be a whole number from 1 to ${MAX_TIMER_MS}, or Infinity, got ${ms}`,
  );
}

/**
 * How many of the transport's own error answers, for lines it could not read, may wait on a full output. Past that,
 * the client sends bad lines without reading the answers, and the transport stops, as the connection does for
 * refusals.
 */
const MAX_WAITING_ERRORS = 128;

const encoder = new TextEncoder();

/**
 * Serves one client over a pair of byte streams, one JSON-RPC 2.0 message per line, and resolves once the client is
 * done. `buildanagent rpc` calls it with `process.stdin`, `process.stdout` and a `log` that writes to stderr.
 *
 * Each line is read with the protocol's framer, which splits on `\n` only, and checked with `decode()`. A line that
 * isn't JSON is answered with `ParseError`, and a message without a valid envelope, or a line over `maxLineBytes`,
 * with `InvalidRequest`; the error carries the request's id when it could be read and `null` otherwise. A malformed
 * response, one that carries `result` or `error`, is only logged, because JSON-RPC never answers a response. A bad
 * line never ends the stream. The transport stops once 128 of its error answers wait on a full output, because the
 * client is sending bad lines without reading.
 *
 * What the server sends waits for the output to take it, so a client that stops reading holds the server's queue, and
 * the dispatcher drops live events past the queue size instead of buffering them.
 *
 * The end of the input is the client's goodbye. The transport answers every command it has read, waits until each
 * line already sent is written, then closes the connection and resolves. A turn the client started goes on in the
 * dispatcher, but its events have nowhere to go, so a client that wants `turn/settled` keeps its input open until that
 * arrives. An input that fails is logged and then treated as an end. Once the input has ended, the output must take
 * each queued line within `writeTimeoutMs`, 30 seconds by default; when one line takes longer, the transport stops and
 * logs why. The transport resolves
 * without waiting, and logs why, when the output fails or closes, when the dispatcher closes the connection or when
 * `signal` aborts. It never ends, closes or cancels either stream: it removes its listeners and releases its locks,
 * and the host owns the rest. A `writeTimeoutMs` that is not a whole number from 1 to 2,147,483,647 or `Infinity`
 * rejects with a `HarnessError`, code `invalid_transport_options`, before the transport connects.
 */
export async function stdioTransport(dispatcher: Dispatcher, io: StdioIo, options: StdioOptions = {}): Promise<void> {
  // Checked before the session connects, so a bad option leaves no connection behind.
  const writeTimeoutMs = checkWriteTimeout(options.writeTimeoutMs);
  await new StdioSession(dispatcher, io, options, writeTimeoutMs).run(options.signal);
}

/** The error answer to a server request that could not be written, handed back so the server stops waiting on it. */
const UNWRITABLE_REQUEST = { code: ErrorCodes.InternalError, message: "the server could not write this request" };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A refused value that answers a request: JSON-RPC never answers a response, even a malformed one. */
const isResponseLike = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !("method" in value) &&
  ("result" in value || "error" in value);

/** One client's run of the transport: the connection, what it waits for, and why it stopped, if it stopped early. */
class StdioSession {
  readonly #log: (line: string) => void;
  readonly #stopper = new Stopper();
  readonly #writer: LineWriter;
  readonly #reader: ChunkReader;
  readonly #framer: JsonlFramer;
  readonly #connection: Connection;
  /** Each command read whose response is not queued yet. */
  readonly #commands = new Set<Promise<void>>();
  /** The delivery the connection's queue waits on, if any, so the end of the input can wait for it. */
  #delivering: PromiseLike<void> | undefined;
  /** The transport's own error answers that wait on a full output. */
  #waitingErrors = 0;
  /** True once the transport closes the connection itself, so its own close is not taken for the server's. */
  #closing = false;
  readonly #writeTimeoutMs: number;
  /** Restarts the write timeout's clock while `#output()` waits, each time the output takes a line. */
  #restart: (() => void) | undefined;

  /**
   * Connects first, because a closed dispatcher throws, and only then takes the streams, so a failure leaves neither a
   * listener nor a lock on them. A stream that can't be taken, such as a locked Web stream, closes the connection and
   * releases what was taken before it.
   */
  constructor(dispatcher: Dispatcher, io: StdioIo, options: StdioOptions, writeTimeoutMs: number) {
    this.#log = io.log ?? (() => undefined);
    this.#writeTimeoutMs = writeTimeoutMs;
    this.#framer = new JsonlFramer(options.maxLineBytes === undefined ? {} : { maxLineBytes: options.maxLineBytes });
    this.#connection = dispatcher.connect((message) => this.#deliver(message), {
      onClose: () => {
        if (!this.#closing) this.#stopper.stop("the connection closed");
      },
    });
    const abandon = () => {
      this.#closing = true;
      this.#connection.close();
    };
    try {
      this.#writer = lineWriter(io.output, this.#stopper, () => this.#restart?.());
    } catch (error) {
      abandon();
      throw error;
    }
    try {
      this.#reader = chunkReader(io.input);
    } catch (error) {
      this.#writer.release();
      abandon();
      throw error;
    }
  }

  async run(signal: AbortSignal | undefined): Promise<void> {
    const onAbort = () => this.#stopper.stop("the signal aborted");
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let reason: string | undefined;
    try {
      if (await this.#read()) await this.#drain();
    } finally {
      reason = this.#stopper.reason;
      signal?.removeEventListener("abort", onAbort);
      this.#closing = true;
      this.#connection.close();
      this.#reader.release();
      this.#writer.release();
      // Ends any wait still subscribed, so nothing outlives the run.
      this.#stopper.stop("the transport finished");
    }
    if (reason !== undefined) this.#log(`stdio: stopped: ${reason}`);
  }

  /** Feeds the input to the framer until it ends or fails, which returns true, or the transport stops, which returns false. */
  async #read(): Promise<boolean> {
    while (!this.#stopper.stopped) {
      let next: IteratorResult<Uint8Array | string, undefined> | undefined;
      try {
        next = await this.#stopper.until(this.#reader.next());
      } catch (error) {
        // A failed input ends the client's stream as its end does, so what it sent is still answered.
        this.#log(`stdio: the input failed: ${messageOf(error)}`);
        return true;
      }
      if (next === undefined) return false;
      if (next.done) {
        this.#take(this.#framer.end());
        return true;
      }
      this.#take(this.#framer.push(typeof next.value === "string" ? encoder.encode(next.value) : next.value));
    }
    return false;
  }

  #take(framed: readonly FramedMessage[]): void {
    for (const result of framed) {
      if (this.#stopper.stopped) return;
      if (result.ok) {
        this.#handle(result.value);
        continue;
      }
      this.#log(`stdio: refused a line: ${result.error.message}`);
      this.#answerError(result.error, ErrorCodes.ParseError);
    }
  }

  #handle(value: unknown): void {
    let message: ClientMessage;
    try {
      message = decode(value) as ClientMessage;
    } catch (error) {
      if (!isProtocolError(error)) throw error;
      if (isResponseLike(value)) {
        // The server's request it meant to answer still waits, as for any answer the server can't use.
        this.#log(`stdio: ignored a malformed response: ${error.message}`);
        return;
      }
      this.#log(`stdio: refused a message: ${error.message}`);
      this.#answerError(error, ErrorCodes.InvalidRequest);
      return;
    }
    this.#track(this.#connection.receive(message));
  }

  /** Keeps a message the connection is handling until its response is queued, so the end of the input waits for it. */
  #track(receiving: Promise<void>): void {
    const received = receiving.catch((error: unknown) => {
      this.#log(`stdio: a message failed: ${messageOf(error)}`);
    });
    this.#commands.add(received);
    void received.then(() => this.#commands.delete(received));
  }

  /**
   * Answers a line the transport could not hand to the connection. An answer the output takes at once costs nothing;
   * one that waits on a full output counts until the output has room, and once 128 wait, the transport stops.
   */
  #answerError(error: ProtocolError, fallbackCode: number): void {
    if (this.#waitingErrors >= MAX_WAITING_ERRORS) {
      this.#stopper.stop(`${MAX_WAITING_ERRORS} error responses wait unread`);
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
      this.#log(`stdio: a server message could not be written: ${messageOf(error)}`);
      return this.#unwritable(message);
    }
    return this.#writer.write(encoder.encode(line));
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
    return this.#writer.write(
      encoder.encode(
        encode({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: ErrorCodes.InternalError, message: "the response could not be written" },
        }),
      ),
    );
  }

  /**
   * Waits, after the input ended, for every command read to have its response queued, for the connection's queue to
   * hand the last of them out, and for the output to write every line. Stops early if the transport is stopped. The
   * commands take as long as their handlers do; only the waits on the output count against `writeTimeoutMs`.
   */
  async #drain(): Promise<void> {
    while (this.#commands.size > 0 && !this.#stopper.stopped)
      await this.#stopper.until(Promise.all([...this.#commands]));
    // The queue hands a message out only after the last one's delivery settled, so wait until none is in flight.
    for (let current = this.#delivering; current !== undefined && !this.#stopper.stopped; current = this.#delivering) {
      await this.#output(current);
    }
    if (!this.#stopper.stopped) await this.#output(this.#writer.flushed());
  }

  /**
   * Waits for what `wait` waits on, or stops the transport once the output takes no line for `writeTimeoutMs`. The
   * limit is per line: the timer restarts only when the output takes a whole line, because neither kind of output
   * reports progress within one, so a single line that takes longer stops the transport however steadily the client
   * reads it. The timer is cleared however the wait ends, so none outlives it.
   */
  async #output(wait: PromiseLike<void>): Promise<void> {
    const ms = this.#writeTimeoutMs;
    if (ms === Number.POSITIVE_INFINITY) {
      await this.#stopper.until(wait);
      return;
    }
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const arm = () => {
      globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(() => {
        this.#stopper.stop(`the output took no line for ${ms} ms after the input ended`);
      }, ms);
    };
    this.#restart = arm;
    arm();
    try {
      await this.#stopper.until(wait);
    } finally {
      this.#restart = undefined;
      globalThis.clearTimeout(timer);
    }
  }
}
