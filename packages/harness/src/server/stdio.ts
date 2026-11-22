/**
 * The stdio transport: one client on a byte stream in each direction, one JSON-RPC message per line. It reads with the
 * protocol's `JsonlFramer`, which splits on `\n` only, checks each message's envelope with `decode()`, and hands it to
 * a dispatcher connection. What the server sends goes out through `encode()`, and the transport waits for the output
 * to drain before it takes the next message, so a client that stops reading slows the server down instead of growing
 * its memory: the connection's queue bounds what waits, as `outbox.ts` says.
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
import type { Connection, Dispatcher } from "./dispatcher.js";

/**
 * The bytes the transport reads: Node's `process.stdin` or any Node `Readable`, which yield `Uint8Array` chunks, or a
 * Web `ReadableStream`. A string chunk is read as UTF-8.
 */
export type StdioInput = AsyncIterable<Uint8Array | string> | ReadableStream<Uint8Array>;

/** A Node `Writable` as the transport uses it, such as `process.stdout`. */
export interface NodeOutput {
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean;
  once(event: "drain" | "close", listener: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  removeListener(event: "drain" | "close", listener: () => void): unknown;
  removeListener(event: "error", listener: (error: Error) => void): unknown;
}

/** Where the transport writes: a Node `Writable` such as `process.stdout`, or a Web `WritableStream`. */
export type StdioOutput = NodeOutput | WritableStream<Uint8Array>;

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
}

/**
 * How many error responses of the transport's own, for lines it could not read, may wait to be written. Past that, the
 * client sends bad lines without reading the answers, and the transport closes, as the connection does for refusals.
 */
const MAX_WAITING_ERRORS = 128;

/** One line out. `write()` returns a promise only when the output is full; `flushed()` waits for every line so far. */
interface LineWriter {
  write(bytes: Uint8Array): PromiseLike<void> | undefined;
  flushed(): Promise<void>;
  /** Resolves once the output fails or closes, with why. */
  readonly broken: Promise<string>;
  release(): void;
}

const isWebOutput = (output: StdioOutput): output is WritableStream<Uint8Array> => "getWriter" in output;

function nodeWriter(output: NodeOutput): LineWriter {
  let last: Promise<void> = Promise.resolve();
  let markBroken!: (why: string) => void;
  const broken = new Promise<string>((resolve) => {
    markBroken = resolve;
  });
  let isBroken = false;
  const onError = (error: Error) => {
    isBroken = true;
    markBroken(`the output failed: ${error.message}`);
  };
  const onClose = () => {
    isBroken = true;
    markBroken("the output closed");
  };
  output.once("error", onError);
  output.once("close", onClose);
  return {
    write(bytes) {
      if (isBroken) return undefined;
      let ready = true;
      last = new Promise<void>((resolve) => {
        ready = output.write(bytes, (error) => {
          if (error) onError(error);
          resolve();
        });
      });
      if (ready) return undefined;
      // A full output: the next line waits for `drain`, or for the failure that means no drain will come.
      return Promise.race([
        new Promise<void>((resolve) => output.once("drain", resolve)),
        broken.then(() => undefined),
      ]);
    },
    flushed: () => Promise.race([last, broken.then(() => undefined)]),
    broken,
    release() {
      output.removeListener("error", onError);
      output.removeListener("close", onClose);
    },
  };
}

function webWriter(output: WritableStream<Uint8Array>): LineWriter {
  const writer = output.getWriter();
  let last: Promise<void> = Promise.resolve();
  let markBroken!: (why: string) => void;
  const broken = new Promise<string>((resolve) => {
    markBroken = resolve;
  });
  writer.closed.then(
    () => markBroken("the output closed"),
    (error: unknown) => markBroken(`the output failed: ${error instanceof Error ? error.message : String(error)}`),
  );
  return {
    write(bytes) {
      last = writer.write(bytes).catch(() => undefined);
      // A Web stream counts what waits in its own queue; `ready` settles once there is room again.
      return writer.desiredSize !== null && writer.desiredSize > 0 ? undefined : writer.ready.catch(() => undefined);
    },
    flushed: () => Promise.race([last, broken.then(() => undefined)]),
    broken,
    release: () => writer.releaseLock(),
  };
}

/** The input as chunks of bytes, whichever kind of stream it is. */
function chunksOf(input: StdioInput): AsyncIterator<Uint8Array | string> {
  // Node's Web streams are async iterable too, but a Worker's may not be, so a Web stream is read by its reader.
  if (!("getReader" in input)) return input[Symbol.asyncIterator]();
  const reader = input.getReader();
  return {
    async next() {
      const read = await reader.read();
      return read.done ? { done: true, value: undefined } : { done: false, value: read.value };
    },
    async return() {
      await reader.cancel();
      return { done: true, value: undefined };
    },
  };
}

const encoder = new TextEncoder();

/**
 * Serves one client over a pair of byte streams, one JSON-RPC 2.0 message per line, and resolves once the client is
 * done. `buildanagent rpc` calls it with `process.stdin`, `process.stdout` and a `log` that writes to stderr.
 *
 * Each line is read with the protocol's framer, which splits on `\n` only, and checked with `decode()`. A line that
 * isn't JSON is answered with `ParseError`, and a message without a valid envelope, or a line over `maxLineBytes`,
 * with `InvalidRequest`; the error carries the request's id when it could be read and `null` otherwise. A bad line
 * never ends the stream. A client that sends bad lines without reading their answers is disconnected once 128 wait.
 *
 * What the server sends waits for the output to take it, so a client that stops reading holds the server's queue, and
 * the dispatcher drops live events past the queue size instead of buffering them.
 *
 * The end of the input is the client's goodbye: the transport answers every command it has read, waits until each
 * line already sent is written, then closes the connection and resolves. A turn the client started goes on in the
 * dispatcher, but its events have nowhere to go, so a client that wants `turn/settled` keeps its input open until that
 * arrives. The transport also resolves, without waiting, when the output fails or closes and when `signal` aborts.
 * It never ends or closes either stream.
 */
export async function stdioTransport(dispatcher: Dispatcher, io: StdioIo, options: StdioOptions = {}): Promise<void> {
  await new StdioSession(dispatcher, io, options).run(io.input, options.signal);
}

/** One client's run of the transport: the connection, what it waits for, and why it stopped, if it stopped early. */
class StdioSession {
  readonly #log: (line: string) => void;
  readonly #writer: LineWriter;
  readonly #framer: JsonlFramer;
  readonly #connection: Connection;
  /** Each command read whose response is not queued yet. */
  readonly #commands = new Set<Promise<void>>();
  /** The delivery the connection's queue waits on, if any, so the end of the input can wait for it. */
  #delivering: PromiseLike<void> | undefined;
  #waitingErrors = 0;
  /** Why the transport stopped early, set once: the output broke, the signal aborted, or bad lines went unread. */
  #stopReason: string | undefined;
  #wake!: () => void;
  readonly #stopped = new Promise<void>((resolve) => {
    this.#wake = resolve;
  });

  constructor(dispatcher: Dispatcher, io: StdioIo, options: StdioOptions) {
    this.#log = io.log ?? (() => undefined);
    this.#writer = isWebOutput(io.output) ? webWriter(io.output) : nodeWriter(io.output);
    this.#framer = new JsonlFramer(options.maxLineBytes === undefined ? {} : { maxLineBytes: options.maxLineBytes });
    void this.#writer.broken.then((why) => this.#stop(why));
    this.#connection = dispatcher.connect((message) => this.#deliver(message));
  }

  async run(input: StdioInput, signal: AbortSignal | undefined): Promise<void> {
    const onAbort = () => this.#stop("the signal aborted");
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const chunks = chunksOf(input);
    let ended = false;
    try {
      ended = await this.#read(chunks);
      if (ended) await this.#drain();
    } finally {
      signal?.removeEventListener("abort", onAbort);
      this.#connection.close();
      // An input that did not end, because the output broke or the signal aborted, is let go: nothing will read it.
      if (!ended) void chunks.return?.().catch(() => undefined);
      this.#writer.release();
    }
    if (this.#stopReason !== undefined) this.#log(`stdio: stopped: ${this.#stopReason}`);
  }

  #isStopped(): boolean {
    return this.#stopReason !== undefined;
  }

  #stop(why: string): void {
    if (this.#stopReason !== undefined) return;
    this.#stopReason = why;
    this.#wake();
  }

  /** Feeds the input to the framer until it ends, which returns true, or the transport stops, which returns false. */
  async #read(chunks: AsyncIterator<Uint8Array | string>): Promise<boolean> {
    while (!this.#isStopped()) {
      const next = await Promise.race([chunks.next(), this.#stopped.then(() => undefined)]);
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
      if (this.#isStopped()) return;
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
      this.#log(`stdio: refused a message: ${error.message}`);
      this.#answerError(error, ErrorCodes.InvalidRequest);
      return;
    }
    const received = this.#connection.receive(message).catch((error: unknown) => {
      this.#log(`stdio: a message failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.#commands.add(received);
    void received.then(() => this.#commands.delete(received));
  }

  /** Answers a line the transport could not hand to the connection, bounded as `MAX_WAITING_ERRORS` says. */
  #answerError(error: ProtocolError, fallbackCode: number): void {
    if (this.#waitingErrors >= MAX_WAITING_ERRORS) {
      this.#stop(`${MAX_WAITING_ERRORS} error responses wait unread`);
      return;
    }
    this.#waitingErrors += 1;
    const id = error.requestId ?? null;
    const sent = this.#writeLine({
      jsonrpc: "2.0",
      id,
      error: { code: error.rpcCode ?? fallbackCode, message: error.message },
    } as ServerMessage);
    void Promise.resolve(sent)
      .then(() => this.#writer.flushed())
      .then(() => {
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
      // The server built a message JSON can't carry. A request still gets an answer, so the client never waits forever.
      this.#log(
        `stdio: a server message could not be written: ${error instanceof Error ? error.message : String(error)}`,
      );
      if ("method" in message || message.id === null) return undefined;
      line = encode({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: ErrorCodes.InternalError, message: "the response could not be written" },
      });
    }
    return this.#writer.write(encoder.encode(line));
  }

  /**
   * Waits, after the input ended, for every command read to have its response queued, for the connection's queue to
   * hand the last of them out, and for the output to write every line. Stops early if the transport is stopped.
   */
  async #drain(): Promise<void> {
    const until = (promise: PromiseLike<unknown>) => Promise.race([promise, this.#stopped]);
    while (this.#commands.size > 0 && !this.#isStopped()) await until(Promise.all([...this.#commands]));
    // The queue hands a message out only after the last one's delivery settled, so wait until none is in flight.
    for (let current = this.#delivering; current !== undefined && !this.#isStopped(); current = this.#delivering) {
      await until(current);
    }
    if (!this.#isStopped()) await until(this.#writer.flushed());
  }
}
