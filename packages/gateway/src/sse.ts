/**
 * A server-sent events decoder over a byte stream, shared by the wire adapters. It follows the WHATWG event-stream
 * format: lines end in CRLF, LF or CR, a blank line dispatches an event, a line starting with `:` is a comment, and
 * an event left incomplete when the stream ends is discarded.
 */

/** One dispatched server-sent event. `event` is `"message"` when the event named none. */
export interface ServerSentEvent {
  readonly event: string;
  readonly data: string;
}

const LINE_END = /\r\n|\n|\r/;

interface PendingEvent {
  event: string;
  data: string[];
}

/** Applies one line to the pending event, and returns the event when the line is the blank line that ends it. */
function applyLine(line: string, pending: PendingEvent): ServerSentEvent | undefined {
  if (line === "") {
    const dispatched =
      pending.data.length > 0 ? { event: pending.event || "message", data: pending.data.join("\n") } : undefined;
    pending.event = "";
    pending.data = [];
    return dispatched;
  }
  if (line.startsWith(":")) return undefined;
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  let value = colon === -1 ? "" : line.slice(colon + 1);
  if (value.startsWith(" ")) value = value.slice(1);
  if (field === "event") pending.event = value;
  else if (field === "data") pending.data.push(value);
  return undefined;
}

/**
 * Splits the complete lines off `buffer`. A trailing CR is held back until the next chunk or the end of the stream,
 * because it may be the first half of a CRLF split across two chunks.
 */
function takeLines(buffer: string, final: boolean): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  for (let match = LINE_END.exec(rest); match !== null; match = LINE_END.exec(rest)) {
    if (match[0] === "\r" && match.index === rest.length - 1 && !final) break;
    lines.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  return { lines, rest };
}

/**
 * Reads `body` to its end and yields each server-sent event as it completes. Chunk boundaries may fall anywhere,
 * inside a multi-byte character or between a CR and its LF. Breaking out of the loop cancels the body.
 */
export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const pending: PendingEvent = { event: "", data: [] };
  let buffer = "";
  let finished = false;
  try {
    while (!finished) {
      const { done, value } = await reader.read();
      finished = done;
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const { lines, rest } = takeLines(buffer, done);
      buffer = rest;
      for (const line of lines) {
        const event = applyLine(line, pending);
        if (event) yield event;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
