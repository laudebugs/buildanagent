// The framing rules: strict JSON-RPC 2.0 envelopes, and a framer that splits on `\n` only.
import assert from "node:assert/strict";
import { decode, ErrorCodes, encode, type FramedMessage, isProtocolError, JsonlFramer } from "@buildanagent/protocol";
import { test } from "vitest";
import { MESSAGES } from "./protocol-fixtures.js";

const bytes = (text: string) => new TextEncoder().encode(text);

function values(messages: readonly FramedMessage[]): unknown[] {
  return messages.map((message) => {
    assert.ok(message.ok, message.ok ? "" : message.error.message);
    return message.value;
  });
}

test("a JSON string containing U+2028 and U+2029 round-trips through encode, the framer and decode", () => {
  const message = {
    jsonrpc: "2.0",
    id: 1,
    method: "turn/start",
    params: { session: "s1", input: [{ type: "text", text: "a b c\nd" }] },
  } as const;
  const line = encode(message);
  assert.ok(line.includes(" ") && line.includes(" "), "the separators stay raw in the line");
  assert.equal(
    line.indexOf("\n"),
    line.length - 1,
    "the only newline is the terminator, because the one in the text is escaped",
  );
  const framed = new JsonlFramer().push(bytes(`${line}${line}`));
  assert.equal(framed.length, 2, "two messages, not four: a reader that split on U+2028 would cut the string");
  assert.deepEqual(values(framed)[0], message);
  assert.deepEqual(decode(values(framed)[1]), message);
});

test("every fixture survives encode, the framer and decode unchanged", () => {
  const framer = new JsonlFramer();
  const text = MESSAGES.map((message) => encode(message)).join("");
  assert.deepEqual(values(framer.push(bytes(text))), MESSAGES);
});

test("a message arriving in pieces, even in the middle of a character, is one message", () => {
  const line = bytes(
    encode({
      jsonrpc: "2.0",
      method: "turn/settled",
      params: { session: "é€😀", turn: "t", result: { stopReason: "done", steps: 1, costUsd: null } },
    }),
  );
  for (let cut = 1; cut < line.length; cut += 1) {
    const framer = new JsonlFramer();
    const first = framer.push(line.subarray(0, cut));
    const second = framer.push(line.subarray(cut));
    assert.equal(first.length + second.length, 1, `cut at ${cut}`);
    assert.ok([...first, ...second][0]?.ok, `cut at ${cut}`);
  }
});

test("a blank line is skipped, a CRLF is accepted, and one bad line doesn't stop the lines after it", () => {
  const framed = new JsonlFramer().push(bytes('{"a":1}\r\n\n   \n{"b":\n{"c":3}\n'));
  assert.equal(framed.length, 3);
  assert.deepEqual([framed[0]?.ok, framed[1]?.ok, framed[2]?.ok], [true, false, true]);
  const bad = framed[1];
  assert.ok(bad && !bad.ok && isProtocolError(bad.error) && bad.error.code === "invalid_json");
  assert.equal(bad.error.rpcCode, ErrorCodes.ParseError);
  assert.deepEqual(framed[2], { ok: true, value: { c: 3 } });
});

test("a line that is not UTF-8 is an error and not a crash", () => {
  const framed = new JsonlFramer().push(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d, 0x0a]));
  assert.equal(framed[0]?.ok, false);
});

test("a line over the bound is skipped and reported once, and the next line is read", () => {
  const framer = new JsonlFramer({ maxLineBytes: 20 });
  const out = [
    ...framer.push(bytes(`{"big":"${"x".repeat(15)}`)),
    ...framer.push(bytes(`${"x".repeat(30)}"}\n{"ok":1}\n`)),
  ];
  assert.equal(out.length, 2);
  const first = out[0];
  assert.ok(first && !first.ok && first.error.code === "line_too_long");
  assert.deepEqual(out[1], { ok: true, value: { ok: 1 } });
});

test("a line of exactly the bound is accepted", () => {
  const body = '{"a":"xxxx"}';
  const out = new JsonlFramer({ maxLineBytes: body.length }).push(bytes(`${body}\n`));
  assert.deepEqual(values(out), [{ a: "xxxx" }]);
});

test("end() reports an unfinished last line and a clean stream reports nothing", () => {
  const unfinished = new JsonlFramer();
  assert.deepEqual(unfinished.push(bytes('{"a":1}\n{"b"')).length, 1);
  const ended = unfinished.end();
  assert.ok(ended[0] && !ended[0].ok && ended[0].error.code === "unterminated_line");
  assert.deepEqual(unfinished.end(), [], "and it is reset");
  const clean = new JsonlFramer();
  clean.push(bytes('{"a":1}\n'));
  assert.deepEqual(clean.end(), []);
});

test("a message without jsonrpc is rejected with the invalid-request code, and the request's id", () => {
  for (const input of [
    { id: 7, method: "session/list", params: {} },
    { jsonrpc: "1.0", id: 7, method: "session/list" },
    { jsonrpc: 2, id: 7, method: "session/list" },
  ]) {
    assert.throws(
      () => decode(input),
      (error) =>
        isProtocolError(error) && error.code === "invalid_request" && error.rpcCode === -32600 && error.requestId === 7,
      JSON.stringify(input),
    );
    assert.throws(
      () => encode(input as never),
      (error) => isProtocolError(error) && error.rpcCode === -32600,
    );
  }
});

test("decode refuses what is not a message: text that isn't JSON, a batch, a bare value and a malformed envelope", () => {
  const refused = (input: unknown, code: string, rpc: number) =>
    assert.throws(
      () => decode(input),
      (error) => isProtocolError(error) && error.code === code && error.rpcCode === rpc,
      JSON.stringify(input),
    );
  refused("{nope", "invalid_json", ErrorCodes.ParseError);
  for (const input of [
    [{ jsonrpc: "2.0", id: 1, method: "a" }],
    "[]",
    "3",
    null,
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: 1, result: 1, error: { code: 1, message: "x" } },
    { jsonrpc: "2.0", id: 1, method: "a", result: 1 },
    { jsonrpc: "2.0", id: {}, method: "a" },
    { jsonrpc: "2.0", id: null, method: "a" },
    { jsonrpc: "2.0", id: 1, method: "" },
    { jsonrpc: "2.0", id: 1, method: "a", params: [1] },
    { jsonrpc: "2.0", id: 1, error: { code: 1.5, message: "x" } },
    { jsonrpc: "2.0", id: 1, error: { code: 1 } },
    { jsonrpc: "2.0", result: 1 },
  ]) {
    refused(input, "invalid_request", ErrorCodes.InvalidRequest);
  }
});

test("decode accepts a request, a notification, a result and an error with a null id", () => {
  for (const input of [
    { jsonrpc: "2.0", id: "a", method: "session/list", params: {} },
    { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 1 } },
    { jsonrpc: "2.0", id: 2, result: { x: 1 } },
    { jsonrpc: "2.0", id: null, error: { code: -32700, message: "x" } },
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize" }),
  ]) {
    assert.doesNotThrow(() => decode(input), JSON.stringify(input));
  }
});

test("the error codes are the standard ones and our three server codes", () => {
  assert.deepEqual(ErrorCodes, {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    QueueFull: -32001,
    SessionLocked: -32002,
    NotOptedIn: -32003,
  });
});
