import assert from "node:assert/strict";
import { test } from "vitest";
import { readServerSentEvents, type ServerSentEvent } from "../src/sse.js";

function bodyOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function events(chunks: (string | Uint8Array)[]): Promise<ServerSentEvent[]> {
  const seen: ServerSentEvent[] = [];
  for await (const event of readServerSentEvents(bodyOf(chunks))) seen.push(event);
  return seen;
}

test("a CRLF split across two chunks ends one line, not two", async () => {
  assert.deepEqual(await events(["event: ping\r", "\ndata: {}\r\n\r\n"]), [{ event: "ping", data: "{}" }]);
});

test("a multi-byte character split across chunks decodes whole", async () => {
  const bytes = new TextEncoder().encode("data: ✓\n\n");
  assert.deepEqual(await events([bytes.slice(0, 7), bytes.slice(7)]), [{ event: "message", data: "✓" }]);
});

test("data lines join with a newline, and comments are skipped", async () => {
  assert.deepEqual(await events([": keep-alive\ndata: a\ndata: b\n\n"]), [{ event: "message", data: "a\nb" }]);
});

test("an event left incomplete at the end of the stream is discarded", async () => {
  assert.deepEqual(await events(["data: done\n\ndata: cut"]), [{ event: "message", data: "done" }]);
});
