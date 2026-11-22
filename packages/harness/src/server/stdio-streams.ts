/**
 * The stream ends of the stdio transport: a reader and a writer for Node streams and for Web streams, and the stopper
 * they share. Every wait here subscribes to the stopper and unsubscribes when it settles. A full output has one shared
 * wait for room, so a long session under backpressure adds no listener and no promise reaction that outlives the
 * wait. Releasing a reader or a writer removes the transport's listeners and locks and leaves the stream itself
 * open: the host owns it.
 */

/** A Node `Readable` as the transport reads it, such as `process.stdin`. A string chunk is read as UTF-8. */
export interface NodeInput {
  /** Adds the listener the transport reads chunks with. */
  on(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
  /** Adds the listener that tells the transport the input ended. */
  on(event: "end" | "close", listener: () => void): unknown;
  /** Adds the listener that tells the transport the input failed. */
  on(event: "error", listener: (error: Error) => void): unknown;
  /** Removes the chunk listener when the transport lets the input go. */
  removeListener(event: "data", listener: (chunk: Uint8Array | string) => void): unknown;
  /** Removes the end listener when the transport lets the input go. */
  removeListener(event: "end" | "close", listener: () => void): unknown;
  /** Removes the failure listener when the transport lets the input go. */
  removeListener(event: "error", listener: (error: Error) => void): unknown;
  /** Stops the flow while a chunk waits to be read, and when the transport lets the input go. */
  pause(): unknown;
  /** Starts the flow again once the transport wants the next chunk. */
  resume(): unknown;
}

/** The bytes the transport reads: a Node `Readable` such as `process.stdin`, or a Web `ReadableStream`. */
export type StdioInput = NodeInput | ReadableStream<Uint8Array>;

/** A Node `Writable` as the transport writes to it, such as `process.stdout`. */
export interface NodeOutput {
  /** Writes one line; `false` means the output is full until `drain`. */
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean;
  /** Adds the listener for room again, or for the output's close. */
  on(event: "drain" | "close", listener: () => void): unknown;
  /** Adds the listener that tells the transport the output failed. */
  on(event: "error", listener: (error: Error) => void): unknown;
  /** Removes a room or close listener once its wait ends or the transport lets the output go. */
  removeListener(event: "drain" | "close", listener: () => void): unknown;
  /** Removes the failure listener when the transport lets the output go. */
  removeListener(event: "error", listener: (error: Error) => void): unknown;
}

/** Where the transport writes: a Node `Writable` such as `process.stdout`, or a Web `WritableStream`. */
export type StdioOutput = NodeOutput | WritableStream<Uint8Array>;

/** Why the transport stopped early, set once, and the waits that end when it does. */
export class Stopper {
  #reason: string | undefined;
  readonly #listeners = new Set<() => void>();

  get reason(): string | undefined {
    return this.#reason;
  }

  get stopped(): boolean {
    return this.#reason !== undefined;
  }

  /** How many waits are subscribed now, so a test can check that none is left behind. */
  get waits(): number {
    return this.#listeners.size;
  }

  stop(why: string): void {
    if (this.#reason !== undefined) return;
    this.#reason = why;
    const listeners = [...this.#listeners];
    this.#listeners.clear();
    for (const listener of listeners) listener();
  }

  /** Calls `listener` once the transport stops, and returns how to stop listening. */
  onStop(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Settles as `promise` does, or with `undefined` once the transport stops, whichever is first. */
  until<T>(promise: PromiseLike<T>): Promise<T | undefined> {
    if (this.stopped) return Promise.resolve(undefined);
    return new Promise<T | undefined>((resolve, reject) => {
      const off = this.onStop(() => resolve(undefined));
      promise.then(
        (value) => {
          off();
          resolve(value);
        },
        (error: unknown) => {
          off();
          reject(error);
        },
      );
    });
  }
}

/** One line out. `write()` returns a promise only when the output is full; `flushed()` waits for every line so far. */
export interface LineWriter {
  write(bytes: Uint8Array): PromiseLike<void> | undefined;
  flushed(): Promise<void>;
  release(): void;
}

/** The next chunk in, or the end. `next()` rejects when the input fails. */
export interface ChunkReader {
  next(): Promise<IteratorResult<Uint8Array | string, undefined>>;
  release(): void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isWebOutput = (output: StdioOutput): output is WritableStream<Uint8Array> => "getWriter" in output;

/**
 * A writer for either kind of output. A failed or closed output stops `stopper`. `onTaken` is called each time the
 * output takes a line: a Node stream calls its write callback without an error, or a Web stream's write resolves.
 */
export function lineWriter(output: StdioOutput, stopper: Stopper, onTaken: () => void = () => undefined): LineWriter {
  return isWebOutput(output) ? webWriter(output, stopper, onTaken) : nodeWriter(output, stopper, onTaken);
}

function nodeWriter(output: NodeOutput, stopper: Stopper, onTaken: () => void): LineWriter {
  let last: Promise<void> = Promise.resolve();
  // The one wait for room while the output is full, shared by every write made meanwhile.
  let full: Promise<void> | undefined;
  const onError = (error: Error) => stopper.stop(`the output failed: ${error.message}`);
  const onClose = () => stopper.stop("the output closed");
  output.on("error", onError);
  output.on("close", onClose);
  const room = (): Promise<void> => {
    full ??= new Promise<void>((resolve) => {
      const done = () => {
        output.removeListener("drain", done);
        off();
        full = undefined;
        resolve();
      };
      output.on("drain", done);
      const off = stopper.onStop(done);
    });
    return full;
  };
  return {
    write(bytes) {
      if (stopper.stopped) return undefined;
      let ready = true;
      last = new Promise<void>((resolve) => {
        ready = output.write(bytes, (error) => {
          if (error) onError(error);
          else onTaken();
          resolve();
        });
      });
      return ready ? undefined : room();
    },
    flushed: () => stopper.until(last).then(() => undefined),
    release() {
      output.removeListener("error", onError);
      output.removeListener("close", onClose);
    },
  };
}

function webWriter(output: WritableStream<Uint8Array>, stopper: Stopper, onTaken: () => void): LineWriter {
  const writer = output.getWriter();
  let last: Promise<void> = Promise.resolve();
  let full: Promise<void> | undefined;
  let released = false;
  writer.closed.then(
    () => {
      if (!released) stopper.stop("the output closed");
    },
    (error: unknown) => {
      if (!released) stopper.stop(`the output failed: ${messageOf(error)}`);
    },
  );
  return {
    write(bytes) {
      if (stopper.stopped) return undefined;
      last = writer.write(bytes).then(onTaken, () => undefined);
      // A Web stream counts what waits in its own queue; `ready` settles once there is room again.
      if (writer.desiredSize !== null && writer.desiredSize > 0) return undefined;
      full ??= stopper.until(writer.ready.catch(() => undefined)).then(() => {
        full = undefined;
      });
      return full;
    },
    flushed: () => stopper.until(last).then(() => undefined),
    release() {
      released = true;
      writer.releaseLock();
    },
  };
}

/** A reader for either kind of input. */
export function chunkReader(input: StdioInput): ChunkReader {
  return "getReader" in input ? webReader(input) : nodeReader(input);
}

/**
 * Reads a Node stream by its events, pausing it while a chunk waits to be read, so the stream's own buffer holds the
 * rest. `release()` removes the listeners and pauses the stream, which leaves it open, unlike an async iterator's
 * `return()`, which destroys it and waits behind a pending read.
 */
function nodeReader(input: NodeInput): ChunkReader {
  const queue: (Uint8Array | string)[] = [];
  let ended = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const notify = () => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };
  const onData = (chunk: Uint8Array | string) => {
    queue.push(chunk);
    input.pause();
    notify();
  };
  const onEnd = () => {
    ended = true;
    notify();
  };
  const onError = (error: Error) => {
    failure = error;
    notify();
  };
  input.on("data", onData);
  input.on("end", onEnd);
  input.on("close", onEnd);
  input.on("error", onError);
  return {
    async next() {
      for (;;) {
        const chunk = queue.shift();
        if (chunk !== undefined) return { done: false, value: chunk };
        if (failure !== undefined) throw failure;
        if (ended) return { done: true, value: undefined };
        input.resume();
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
    release() {
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("close", onEnd);
      input.removeListener("error", onError);
      input.pause();
      ended = true;
      notify();
    },
  };
}

/** Reads a Web stream through its reader. `release()` releases the lock, which leaves the stream uncancelled. */
function webReader(input: ReadableStream<Uint8Array>): ChunkReader {
  const reader = input.getReader();
  let released = false;
  return {
    async next() {
      if (released) return { done: true, value: undefined };
      const read = await reader.read();
      return read.done ? { done: true, value: undefined } : { done: false, value: read.value };
    },
    release() {
      released = true;
      // A read still pending rejects with the release, which nothing waits for by then.
      reader.releaseLock();
    },
  };
}
