// The triage capstone's second process: a first `buildanagent rpc` pauses before the escalation and exits, and a second
// `rpc`, spawned as its own process with a cleared environment, finds the pause in `initialize`, asks the client on
// `session/open`, and runs the approved page exactly once. The two share only the state folder.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { runCli } from "@buildanagent/cli";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { decode, type ServerMessage } from "@buildanagent/protocol";
import { CAPABILITIES } from "@buildanagent/sdk";
import { afterEach, test } from "vitest";
import { REASON, TRIAGE_RULES, triageTools } from "./capstone-tools.js";
import { callTool, scripted, stateDir, terminal } from "./cli-helpers.js";

const CHILD = fileURLToPath(new URL("./capstone-rpc-child.ts", import.meta.url));
const SOURCE_CONDITION = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
const TSX = import.meta.resolve("tsx");
const TICKET = [{ type: "text", text: "user@example.com says checkout fails with a 500. Triage it." }];

let cleanup: () => void = () => undefined;
afterEach(() => cleanup());

/** A client of one `rpc` server: it sends lines on `send` and keeps every message the server writes. */
function peer(send: (line: string) => void) {
  const messages: ServerMessage[] = [];
  let rest = "";
  return {
    messages,
    take(chunk: Buffer | string) {
      rest += chunk.toString();
      const lines = rest.split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) if (line !== "") messages.push(decode(line) as unknown as ServerMessage);
    },
    send: (message: unknown) => send(`${JSON.stringify(message)}\n`),
    async until<T>(find: (messages: ServerMessage[]) => T | undefined, what: string): Promise<T> {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const found = find(messages);
        if (found !== undefined) return found;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(messages)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
}

type Peer = ReturnType<typeof peer>;
const response = (id: number) => (messages: ServerMessage[]) =>
  messages.find((message) => !("method" in message) && "id" in message && message.id === id) as
    | { result?: Record<string, unknown>; error?: unknown }
    | undefined;
const request = (method: string) => (messages: ServerMessage[]) =>
  messages.find((message) => "method" in message && message.method === method) as
    | { id: string; params: { session: string; request: { id: string; tool: string } } }
    | undefined;
const settled = (stopReason: string) => (messages: ServerMessage[]) =>
  messages.find(
    (message) =>
      "method" in message &&
      message.method === "turn/settled" &&
      (message.params as { result: { stopReason: string } }).result.stopReason === stopReason,
  );

const initialize = (client: Peer) =>
  client.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "capstone", version: "0" }, capabilities: [] },
  });

/** The first process, in this one: triage until the escalation pauses, leave it unanswered, and end the server. */
async function pauseInFirstServer(dir: string, pagesFile: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  const client = peer((line) => input.write(line));
  output.on("data", (chunk: Buffer) => client.take(chunk));
  const { model, adapter } = scripted([
    { content: [callTool("call-1", "lookup_customer", {})] },
    { content: [callTool("call-2", "escalate", { reason: REASON })] },
  ]);
  const term = terminal();
  const status = runCli(["rpc", "--state-dir", dir], {
    io: { ...term.io, streams: { input, output } },
    model,
    tools: triageTools(pagesFile),
    rules: TRIAGE_RULES,
  });
  initialize(client);
  await client.until(response(1), "initialize");
  client.send({ jsonrpc: "2.0", id: 2, method: "session/create", params: { session: "triage", cwd: "/work" } });
  await client.until(response(2), "session/create");
  client.send({ jsonrpc: "2.0", id: 3, method: "turn/start", params: { session: "triage", input: TICKET } });
  const asked = await client.until(request("approval/request"), "approval/request");
  await client.until(settled("awaiting_approval"), "the paused turn");
  input.end();
  assert.equal(await status, 0);
  adapter.assertComplete();
  return asked.params.request;
}

test("a second buildanagent rpc process resolves the capstone's pause, and the approved page runs once", async () => {
  const state = stateDir();
  cleanup = state.cleanup;
  const pagesFile = join(state.dir, "pages.log");
  const paused = await pauseInFirstServer(state.dir, pagesFile);
  assert.equal(paused.tool, "escalate");
  assert.equal(existsSync(pagesFile), false, "nothing was paged before a person answered");

  // PATH, a temp HOME, TMPDIR and LANG, and nothing else from this process.
  const env = spawnEnv([]);
  const previous = cleanup;
  cleanup = () => {
    previous();
    rmSync(env.HOME as string, { recursive: true, force: true });
  };
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH", "TMPDIR"]);
  const child = spawn(
    process.execPath,
    ["--conditions=source", "--import", SOURCE_CONDITION, "--import", TSX, CHILD, state.dir, pagesFile],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const client = peer((line) => child.stdin.write(line));
  child.stdout.on("data", (chunk: Buffer) => client.take(chunk));
  try {
    initialize(client);
    const ready = await client.until(response(1), "initialize");
    const result = ready.result as { capabilities: string[]; pending: { session: string; request: { id: string } }[] };
    assert.deepEqual(result.capabilities, [...CAPABILITIES], "the second server reports the SDK's capabilities");
    assert.deepEqual(
      result.pending.map((waiting) => [waiting.session, waiting.request.id]),
      [["triage", paused.id]],
      "initialize lists the pause the first process left",
    );
    client.send({ jsonrpc: "2.0", id: 2, method: "session/open", params: { session: "triage", cwd: "/work" } });
    const asked = await client.until(request("approval/request"), "approval/request on open");
    assert.equal(asked.params.request.id, paused.id);
    client.send({
      jsonrpc: "2.0",
      id: asked.id,
      result: { resolutions: [{ requestId: paused.id, decision: "allow", by: "on-call lead" }] },
    });
    await client.until(settled("done"), "the resumed turn");
  } finally {
    child.stdin.end();
  }
  assert.equal(await exited, 0, stderr);
  assert.deepEqual(readFileSync(pagesFile, "utf8").split("\n").filter(Boolean), [REASON], "paged once, by the child");
});
