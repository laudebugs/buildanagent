// `buildanagent rpc` in process: the protocol over a pair of streams the test holds, with a scripted model. The
// binary's spawn test in bin.test.ts covers the process's own streams.
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { runCli } from "@buildanagent/cli";
import { decode, type ServerMessage } from "@buildanagent/protocol";
import { afterEach, test } from "vitest";
import { callTool, recordingTool, reply, scripted, stateDir, terminal } from "./cli-helpers.js";

let cleanup: () => void = () => undefined;
afterEach(() => cleanup());

const fresh = () => {
  const state = stateDir();
  cleanup = state.cleanup;
  return state.dir;
};

const text = (value: string) => [{ type: "text", text: value }];

/** A client on the other end of `rpc`: it writes lines to the command's input and reads every line it outputs. */
function client() {
  const input = new PassThrough();
  const output = new PassThrough();
  const lines: string[] = [];
  let rest = "";
  output.on("data", (chunk: Buffer) => {
    rest += chunk.toString("utf8");
    const parts = rest.split("\n");
    rest = parts.pop() ?? "";
    lines.push(...parts);
  });
  const messages = () => lines.map((line) => decode(line) as unknown as ServerMessage);
  return {
    streams: { input, output },
    lines,
    messages,
    send: (message: unknown) => input.write(`${JSON.stringify(message)}\n`),
    end: () => input.end(),
    async until(check: (messages: ServerMessage[]) => boolean, what: string) {
      const deadline = Date.now() + 5000;
      while (!check(messages())) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}:\n${lines.join("\n")}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}

const responseTo = (messages: readonly ServerMessage[], id: number) =>
  messages.find((message) => !("method" in message) && "id" in message && message.id === id);
const withMethod = (messages: readonly ServerMessage[], method: string) =>
  messages.filter((message) => "method" in message && message.method === method);

const stopReasons = (messages: readonly ServerMessage[]) =>
  (withMethod(messages, "turn/settled") as { params: { result: { stopReason: string } } }[]).map(
    (message) => message.params.result.stopReason,
  );

async function handshake(peer: ReturnType<typeof client>) {
  peer.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "test", version: "0" }, capabilities: [] },
  });
  await peer.until((messages) => responseTo(messages, 1) !== undefined, "initialize");
  peer.send({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "s1", cwd: "/work" } });
  await peer.until((messages) => responseTo(messages, 2) !== undefined, "session/create");
}

test("rpc runs a turn over the streams, writes only protocol lines, and exits 0 when input ends", async () => {
  const term = terminal();
  const peer = client();
  const { model, adapter } = scripted([reply("Hi there.")]);
  const status = runCli(["rpc", "--state-dir", fresh()], { io: { ...term.io, streams: peer.streams }, model });
  await handshake(peer);
  peer.send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: text("Hello") } });
  await peer.until((messages) => withMethod(messages, "turn/settled").length === 1, "turn/settled");
  peer.end();
  assert.equal(await status, 0);
  adapter.assertComplete();

  const messages = peer.messages();
  assert.ok(messages.every((message) => message.jsonrpc === "2.0"));
  assert.ok(responseTo(messages, 3) !== undefined && "result" in (responseTo(messages, 3) ?? {}));
  assert.deepEqual(stopReasons(messages), ["done"]);
  assert.ok(withMethod(messages, "event").length > 0);
  // Nothing went through the line writer: standard output is the protocol's alone.
  assert.deepEqual(term.stdout, []);
  assert.equal(peer.streams.output.writableEnded, false);
});

test("rpc asks the client with approval/request, and the call runs once the client allows it", async () => {
  const term = terminal();
  const peer = client();
  const ran: unknown[] = [];
  const { model, adapter } = scripted([{ content: [callTool("c1", "refund", { order: "o1" })] }, reply("Refunded.")]);
  const status = runCli(["rpc", "--state-dir", fresh()], {
    io: { ...term.io, streams: peer.streams },
    model,
    tools: [recordingTool("refund", ran)],
    rules: { ask: [{ tool: "refund", reason: "A refund moves money." }] },
  });
  await handshake(peer);
  peer.send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "s1", input: text("Refund o1") } });
  await peer.until((messages) => withMethod(messages, "approval/request").length === 1, "approval/request");
  const [asked] = withMethod(peer.messages(), "approval/request") as {
    id: string;
    params: { request: { id: string } };
  }[];
  assert.ok(asked !== undefined);
  assert.deepEqual(ran, []);
  peer.send({
    jsonrpc: "2.0",
    id: asked.id,
    result: { resolutions: [{ requestId: asked.params.request.id, decision: "allow", by: "test" }] },
  });
  // The paused turn settles as awaiting_approval; the answer resumes it, and that run settles on its own.
  await peer.until((messages) => stopReasons(messages).includes("done"), "the resumed turn to settle");
  assert.deepEqual(stopReasons(peer.messages()), ["awaiting_approval", "done"]);
  peer.end();
  assert.equal(await status, 0);
  adapter.assertComplete();
  assert.deepEqual(ran, [{ order: "o1" }]);
});

test("rpc logs a line it can't read to standard error and answers it on the stream", async () => {
  const term = terminal();
  const peer = client();
  const { model } = scripted([]);
  const status = runCli(["rpc", "--state-dir", fresh()], { io: { ...term.io, streams: peer.streams }, model });
  peer.streams.input.write("not json\n");
  await peer.until((messages) => messages.length === 1, "the error answer");
  peer.end();
  assert.equal(await status, 0);
  const [answer] = peer.messages() as { id: unknown; error?: { code: number } }[];
  assert.equal(answer?.id, null);
  assert.equal(answer?.error?.code, -32700);
  assert.match(term.stderr.join(""), /^stdio: refused a line: /);
});

test("rpc refuses to start without --model, without the streams, or with arguments, and exits 2", async () => {
  const peer = client();
  const dir = fresh();
  const noModel = terminal();
  assert.equal(await runCli(["rpc", "--state-dir", dir], { io: { ...noModel.io, streams: peer.streams } }), 2);
  assert.match(noModel.stderr.join(""), /this command calls a model: pass --model/);

  const { model } = scripted([]);
  const noStreams = terminal();
  assert.equal(await runCli(["rpc", "--state-dir", dir], { io: noStreams.io, model }), 2);
  assert.match(noStreams.stderr.join(""), /rpc needs the standard streams/);

  const extra = terminal();
  assert.equal(await runCli(["rpc", "now", "--state-dir", dir], { io: { ...extra.io, streams: peer.streams } }), 2);
  assert.match(extra.stderr.join(""), /rpc takes no arguments/);
  assert.deepEqual(peer.lines, []);
});
