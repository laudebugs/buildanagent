// The stdio transport, end to end: the server runs in a child process spawned with a cleared environment, and this
// process is its client, speaking JSONL on the child's stdin and stdout.
import assert from "node:assert/strict";
import { ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import {
  answered,
  call,
  childEnv,
  FLOOD_SESSION,
  initialize,
  messagesOf,
  reportsOf,
  responseTo,
  spawnServer,
  waitUntil,
} from "./stdio-child.js";

const TIMEOUT = 60_000;
const text = (value: string) => [{ type: "text", text: value }];

type Notification = Extract<ServerMessage, { method: "event" | "turn/settled" }>;
const notifications = (messages: readonly ServerMessage[]) =>
  messages.filter((message): message is Notification => "method" in message && !("id" in message));
const settled = (messages: readonly ServerMessage[]) =>
  notifications(messages).filter((message) => message.method === "turn/settled");
const eventTypes = (messages: readonly ServerMessage[]) =>
  notifications(messages).flatMap((message) => (message.method === "event" ? [message.params.event.type] : []));
const entryTypes = (messages: readonly ServerMessage[]) =>
  notifications(messages).flatMap((message) =>
    message.method === "event" && message.params.event.type === "entry_appended"
      ? [message.params.event.entry.type]
      : [],
  );
const errorOf = (message: ServerMessage) => ("error" in message ? message.error : undefined);

describe("a client in another process", () => {
  test(
    "completes initialize, session/create and turn/start, gets the turn's events and one turn/settled",
    async () => {
      const child = spawnServer("basic");
      await call(child, initialize(1));
      await call(child, { jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/work" } });
      child.send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: text("Hi") } });
      await waitUntil(child, () => settled(messagesOf(child)).length === 1, "turn/settled");

      const messages = messagesOf(child);
      const init = responseTo(child, 1);
      assert.ok("result" in init && (init.result as { serverInfo: { specVersion: string } }).serverInfo.specVersion);
      assert.deepEqual("result" in responseTo(child, 2) && responseTo(child, 2), {
        jsonrpc: "2.0",
        id: 2,
        result: { session: "s1", head: null },
      });
      const disposition = responseTo(child, 3);
      assert.ok("result" in disposition && (disposition.result as { accepted: boolean }).accepted);
      const turn = (disposition.result as { turn: string }).turn;
      // The reply streamed as deltas, and its entries were announced as they landed.
      const types = eventTypes(messages);
      assert.ok(types.includes("text_delta"), types.join(", "));
      assert.ok(types.includes("entry_appended"), types.join(", "));
      const [end] = settled(messages);
      assert.equal(end?.method === "turn/settled" && end.params.turn, turn);
      assert.equal(end?.method === "turn/settled" && end.params.result.stopReason, "done");
      // The disposition went out before any event of its turn.
      const at = messages.indexOf(disposition);
      assert.ok(messages.findIndex((message) => "method" in message && message.method === "event") > at);

      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );

  test(
    "stdout carries only protocol lines, and the transport's diagnostics go to stderr",
    async () => {
      const child = spawnServer("basic");
      await call(child, initialize(1));
      // A bad line makes the transport log, and a turn makes the model stream.
      child.write("this is not json\n");
      await call(child, { jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/work" } });
      child.send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: text("Hi") } });
      await waitUntil(child, () => settled(messagesOf(child)).length === 1, "turn/settled");
      child.end();
      assert.equal(await child.exited, 0);

      assert.ok(child.lines.length > 5);
      // Every stdout line is one JSON-RPC 2.0 message; messagesOf() throws on any other line.
      assert.equal(messagesOf(child).length, child.lines.length);
      assert.ok(
        child.errors.some((line) => line.startsWith("stdio: refused a line")),
        child.errors.join("\n"),
      );
      assert.ok(reportsOf(child).some((report) => report.done === true));
    },
    TIMEOUT,
  );
});

describe("the end of stdin", () => {
  test(
    "answers every command already read, writes it all, then exits cleanly",
    async () => {
      // Listing sessions takes 300 ms in this mode, so the input ends while initialize and session/list still run.
      const child = spawnServer("slow");
      const lines = [
        initialize(1),
        { jsonrpc: "2.0", id: 2, method: "session/list", params: {} },
        { jsonrpc: "2.0", id: 3, method: "session/create", params: { session: "s1", cwd: "/work" } },
        { jsonrpc: "2.0", id: 4, method: "approval/list", params: { session: "s1" } },
      ];
      child.process.stdin.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
      assert.equal(await child.exited, 0);
      for (const id of [1, 2, 3, 4]) assert.ok(answered(child, id), `no response to ${id}`);
      assert.ok(reportsOf(child).some((report) => report.done === true));
    },
    TIMEOUT,
  );

  test(
    "a last line cut off by the end is answered with ParseError",
    async () => {
      const child = spawnServer("basic");
      child.process.stdin.end(`${JSON.stringify(initialize(1))}\n{"jsonrpc":"2.0","id":2,"meth`);
      assert.equal(await child.exited, 0);
      assert.ok(answered(child, 1));
      const cut = messagesOf(child).find((message) => !("method" in message) && message.id === null);
      assert.equal(cut && errorOf(cut)?.code, ErrorCodes.ParseError);
    },
    TIMEOUT,
  );
});

describe("a line the server can't read", () => {
  test(
    "is answered with an error, and the lines after it are still served",
    async () => {
      const child = spawnServer("basic");
      child.write("{not json}\n");
      child.send({ id: 7, method: "initialize", params: {} });
      child.send([initialize(8)]);
      child.write("\r\n   \n");
      child.send(initialize(9));
      await waitUntil(child, () => answered(child, 9), "the response to 9");

      const errors = messagesOf(child).flatMap((message) =>
        "error" in message ? [[message.id, message.error.code]] : [],
      );
      assert.deepEqual(errors, [
        [null, ErrorCodes.ParseError],
        // The id of a message without "jsonrpc" can still be read, so its error names it.
        [7, ErrorCodes.InvalidRequest],
        // A batch is refused whole.
        [null, ErrorCodes.InvalidRequest],
      ]);
      assert.ok("result" in responseTo(child, 9));
      assert.equal(child.errors.filter((line) => line.startsWith("stdio: refused")).length, 3);
      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );

  test(
    "a line over maxLineBytes is answered with InvalidRequest once, and the next line is served",
    async () => {
      const child = spawnServer("basic", ["1024"]);
      const long = { ...initialize(1), params: { ...initialize(1).params, padding: "p".repeat(64 * 1024) } };
      // Sent in pieces, so the framer sees the bound pass in the middle of the line.
      const line = `${JSON.stringify(long)}\n`;
      for (let at = 0; at < line.length; at += 1000) child.write(line.slice(at, at + 1000));
      child.send(initialize(2));
      await waitUntil(child, () => answered(child, 2), "the response to 2");

      const errors = messagesOf(child).flatMap((message) => ("error" in message ? [message] : []));
      assert.equal(errors.length, 1);
      assert.equal(errors[0] && errorOf(errors[0])?.code, ErrorCodes.InvalidRequest);
      assert.equal(errors[0]?.id, null);
      assert.ok(!answered(child, 1));
      assert.ok("result" in responseTo(child, 2));
      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );
});

describe("a client that stops reading", () => {
  test(
    "holds the server's output at the pipe instead of growing its memory, and loses only live events, which the log replays",
    async () => {
      const child = spawnServer("flood");
      await call(child, initialize(1));
      await call(child, {
        jsonrpc: "2.0",
        id: 2,
        method: "session/create",
        params: { session: FLOOD_SESSION, cwd: "/w" },
      });
      // From here the client reads nothing until the turn has settled inside the child.
      child.process.stdout.pause();
      child.send({
        jsonrpc: "2.0",
        id: 3,
        method: "turn/start",
        params: { session: FLOOD_SESSION, input: text("go") },
      });
      await waitUntil(child, () => reportsOf(child).some((report) => "settled" in report), "the turn to settle");
      const report = reportsOf(child).find((value) => "settled" in value) as { settled: string; mostWaiting: number };
      assert.equal(report.settled, "done");
      // 25,000 deltas are over 2 MB of JSON; what waited in the child's stdout stayed near the stream's own buffer.
      assert.ok(report.mostWaiting < 256 * 1024, `stdout held ${report.mostWaiting} bytes`);

      child.process.stdout.resume();
      await waitUntil(child, () => settled(messagesOf(child)).length === 1, "turn/settled on stdout");
      const messages = messagesOf(child);
      assert.ok("result" in responseTo(child, 3));
      const types = eventTypes(messages);
      assert.ok(types.includes("events_dropped"), "a marker stands for the dropped events");
      assert.ok(types.filter((type) => type === "text_delta").length < 25_000);
      // A dropped entry comes back from the log: reopening from the start replays every one.
      const before = messages.length;
      await call(child, {
        jsonrpc: "2.0",
        id: 4,
        method: "session/open",
        params: { session: FLOOD_SESSION, cwd: "/w", fromSeq: 0 },
      });
      await waitUntil(
        child,
        () => entryTypes(messagesOf(child).slice(before)).includes("turn_end"),
        "the replayed turn_end",
      );
      assert.equal(entryTypes(messagesOf(child).slice(before)).filter((type) => type === "message_block").length, 5);
      child.end();
      assert.equal(await child.exited, 0);
    },
    TIMEOUT,
  );
});

describe("the child's environment", () => {
  test(
    "holds only spawnEnv's names, and nothing set in the parent reaches it",
    async () => {
      const secret = "stdio-test-not-a-real-secret-3f9a";
      process.env.STDIO_TEST_SECRET = secret;
      process.env.STDIO_TEST_PLAIN = "plain";
      try {
        const child = spawnServer("basic", [], childEnv());
        await call(child, initialize(1));
        child.end();
        assert.equal(await child.exited, 0);
        const env = reportsOf(child).find((report) => "env" in report)?.env as string[];
        assert.deepEqual(env, ["HOME", "LANG", "PATH", "TMPDIR"]);
        assert.ok(![...child.lines, ...child.errors].some((line) => line.includes(secret)));
      } finally {
        delete process.env.STDIO_TEST_SECRET;
        delete process.env.STDIO_TEST_PLAIN;
      }
    },
    TIMEOUT,
  );
});
