/**
 * Splits a byte stream into JSON messages, one per line, on `
` only. It never uses Node's `readline`, which also ends
 * a line at a lone `
`. Some line readers also end one at U+2028 or U+2029, characters that may sit inside a JSON
 * string, so only `
` is safe.
 */
import { ProtocolError } from "./errors.js";
import { ErrorCodes } from "./jsonrpc.js";

/** The default bound on one line, in bytes. */
export const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024;

/** One line of the stream: its parsed JSON, or why it could not be read. A bad line never ends the stream. */
export type FramedMessage = { ok: true; value: unknown } | { ok: false; error: ProtocolError };

/** The options of `JsonlFramer`. */
export interface JsonlFramerOptions {
  /** The most bytes one line may hold, newline excluded. A longer line is skipped and reported once. Default 8 MiB. */
  readonly maxLineBytes?: number;
}

const NEWLINE = 0x0a;

/** Spaces, tabs and carriage returns only: nothing a message could be made of. */
const isBlank = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0x20 || byte === 0x09 || byte === 0x0d);

function join(parts: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/**
 * Feed it chunks as they arrive. `push()` returns one `FramedMessage` for each complete line the chunk finished, in
 * order, and keeps the rest of a half-received line for the next chunk. A character split across two chunks is whole
 * again once its line is, because a line is decoded only when it is complete. A blank line is skipped, a trailing `\r`
 * is dropped, and a line that isn't UTF-8 or isn't JSON comes back as an error and doesn't stop the lines after it.
 */
export class JsonlFramer {
  readonly #maxLineBytes: number;
  #parts: Uint8Array[] = [];
  #bytes = 0;
  // True while the rest of an over-long line is being thrown away, up to its newline.
  #skipping = false;

  constructor(options: JsonlFramerOptions = {}) {
    this.#maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  }

  push(chunk: Uint8Array): FramedMessage[] {
    const out: FramedMessage[] = [];
    let start = 0;
    for (let at = chunk.indexOf(NEWLINE, start); at >= 0; at = chunk.indexOf(NEWLINE, start)) {
      this.#add(chunk.subarray(start, at), out);
      this.#finishLine(out);
      start = at + 1;
    }
    this.#add(chunk.subarray(start), out);
    return out;
  }

  /** Ends the stream. An unfinished last line comes back as an error, because its writer may have died mid-message. */
  end(): FramedMessage[] {
    const out: FramedMessage[] = [];
    const leftover = join(this.#parts, this.#bytes);
    // Spaces, tabs and a \r are not a message, so a stream that ends after them was not cut.
    if (this.#bytes > 0 && !isBlank(leftover) && !this.#skipping) {
      out.push({
        ok: false,
        error: new ProtocolError("unterminated_line", "the stream ended in the middle of a line", {
          rpcCode: ErrorCodes.ParseError,
          requestId: null,
        }),
      });
    }
    this.#parts = [];
    this.#bytes = 0;
    this.#skipping = false;
    return out;
  }

  #tooLong(): FramedMessage {
    return {
      ok: false,
      error: new ProtocolError("line_too_long", `a line went over the bound of ${this.#maxLineBytes} bytes`, {
        rpcCode: ErrorCodes.InvalidRequest,
        requestId: null,
      }),
    };
  }

  #add(part: Uint8Array, out: FramedMessage[]): void {
    if (part.length === 0 || this.#skipping) return;
    // One byte over the bound is let in for a trailing \r, which the bound does not count; the whole line is checked again
    // once it is complete.
    if (this.#bytes + part.length > this.#maxLineBytes + 1) {
      out.push(this.#tooLong());
      this.#parts = [];
      this.#bytes = 0;
      this.#skipping = true;
      return;
    }
    // A copy, because a Buffer's slice() is a view, and a transport may reuse the memory of the chunk it passed.
    this.#parts.push(new Uint8Array(part));
    this.#bytes += part.length;
  }

  #finishLine(out: FramedMessage[]): void {
    const wasSkipping = this.#skipping;
    const bytes = join(this.#parts, this.#bytes);
    this.#parts = [];
    this.#bytes = 0;
    this.#skipping = false;
    if (wasSkipping) return;
    const end = bytes.at(-1) === 0x0d ? bytes.length - 1 : bytes.length;
    const line = bytes.subarray(0, end);
    if (isBlank(line)) return;
    out.push(line.length > this.#maxLineBytes ? this.#tooLong() : parseLine(line));
  }
}

function parseLine(line: Uint8Array): FramedMessage {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(line);
    return { ok: true, value: JSON.parse(text) };
  } catch (cause) {
    return {
      ok: false,
      error: new ProtocolError("invalid_json", "a line is not valid UTF-8 JSON", {
        cause,
        rpcCode: ErrorCodes.ParseError,
        requestId: null,
      }),
    };
  }
}
