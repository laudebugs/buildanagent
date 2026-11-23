// Runs the examples in examples/: reading a chunked stream, reading a session file, and writing requests and reading
// replies. Each one takes its input from the test and sends nothing anywhere.
import assert from "node:assert/strict";
import { decode, isProtocolError, type ServerMessage } from "@buildanagent/protocol";
import { test } from "vitest";
import { describeServerMessage, requestLines } from "../examples/client-requests.js";
import { summarizeSession } from "../examples/read-session-file.js";
import { readStream } from "../examples/read-stream.js";
import { FIXTURES } from "./fixtures.js";
import { NOTIFICATIONS, RESPONSES } from "./protocol-fixtures.js";

const bytes = (text: string) => new TextEncoder().encode(text);

test("a stream cut mid-line and mid-character reads whole, and each bad line is reported once", () => {
  const answer = { jsonrpc: "2.0", id: 1, result: { session: "é", head: null } };
  const text = `${JSON.stringify(answer)}\n{not json\n{"id":2}\n${JSON.stringify(NOTIFICATIONS[0])}\n{"jsonrpc":"2.0","method":"x"`;
  const all = bytes(text);
  // Cut inside the two-byte "é" and inside the last, unfinished line.
  const cut = all.indexOf(0xc3) + 1;
  const reading = readStream([all.subarray(0, cut), all.subarray(cut, all.length - 5), all.subarray(all.length - 5)]);
  assert.deepEqual(reading.messages, [answer, NOTIFICATIONS[0]]);
  assert.deepEqual(reading.refused, ["invalid_json", "invalid_request", "unterminated_line"]);
});

const toFile = (entries: readonly unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");

test("a session file's entries are counted by type, and a line that is not an entry is reported by number", () => {
  const file = `${toFile(FIXTURES.slice(0, 3))}\n\nnot an entry\n${toFile(FIXTURES.slice(3, 5))}\n`;
  const summary = summarizeSession(file);
  assert.deepEqual(summary.counts, { session_header: 1, turn_start: 1, message_block: 2, message_end: 1 });
  assert.deepEqual(summary.unreadableLines, [5]);
});

test("a session header from a newer format ends the read", () => {
  const newer = { ...FIXTURES[0], formatVersion: 2 };
  assert.throws(
    () => summarizeSession(toFile([newer, FIXTURES[1]])),
    (error) => isProtocolError(error) && error.code === "unsupported_format_version",
  );
});

test("the request lines are two valid requests with their ids, ready to write", () => {
  const [create, start] = requestLines("/work", "s1", "Hi");
  assert.ok(create?.endsWith("\n") && start?.endsWith("\n"));
  assert.deepEqual(decode(create), {
    jsonrpc: "2.0",
    id: 1,
    method: "session/create",
    params: { session: "s1", cwd: "/work" },
  });
  assert.deepEqual(decode(start), {
    jsonrpc: "2.0",
    id: 2,
    method: "turn/start",
    params: { session: "s1", input: [{ type: "text", text: "Hi" }] },
  });
});

test("each kind of server message is described by what it asks of the client", () => {
  const request: ServerMessage = {
    jsonrpc: "2.0",
    id: "sr-1",
    method: "tool/call",
    params: { session: "s1", callId: "c1", tool: "t", input: {} },
  };
  const answers = [
    ...[...RESPONSES]
      .reverse()
      .slice(0, 3)
      .map((message) => describeServerMessage(message as ServerMessage)),
    describeServerMessage(request),
    ...NOTIFICATIONS.slice(-3).map((message) => describeServerMessage(message as ServerMessage)),
  ];
  assert.deepEqual(answers, [
    "error -32700: a line is not valid JSON",
    "error -32002: another writer holds the session",
    "error -32001: the queue is full",
    "the server asks tool/call",
    "turn t1 ended: done",
    "turn t2 ended: error",
    "request sr-4 withdrawn",
  ]);
  assert.equal(describeServerMessage(NOTIFICATIONS[0] as ServerMessage), "event 0");
  assert.equal(describeServerMessage(RESPONSES[0] as ServerMessage), "answer to request 0");
});
