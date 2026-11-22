// The session watch against a scripted server: following resumes until the last one settles, giving up on answers
// another process settled, a stored request the server never asks about, and a client tool the terminal can't run.
import assert from "node:assert/strict";
import { isCliError } from "@buildanagent/cli";
import type { InProcessClient } from "@buildanagent/harness/server";
import type { ServerMessage, TurnResultSummary } from "@buildanagent/protocol";
import { test } from "vitest";
import { settle } from "../src/commands/chat.js";
import { SessionWatch } from "../src/watch.js";
import { callTool, cli, recordingTool, reply, scripted, stateDir, terminal } from "./cli-helpers.js";

const SESSION = "s1";

/** A client whose server is the test: it sends messages with `send()`, and `pending` is what `approval/list` says. */
function fakeClient(pending: () => string[]) {
  const listeners = new Set<(message: ServerMessage) => void>();
  const responded: unknown[] = [];
  const failed: { id: unknown; message: string }[] = [];
  const client = {
    request: async (method: string) => {
      assert.equal(method, "approval/list");
      return { pending: pending().map((id) => ({ id })) };
    },
    onMessage(listener: (message: ServerMessage) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    respond: (request: unknown, result: unknown) => responded.push({ request, result }),
    fail: (request: { id: unknown }, error: { message: string }) =>
      failed.push({ id: request.id, message: error.message }),
    close: () => undefined,
  } as unknown as InProcessClient;
  const send = (message: unknown) => {
    for (const listener of listeners) listener(message as ServerMessage);
  };
  return { client, send, responded, failed };
}

const asked = (id: string, requestId: string) => ({
  jsonrpc: "2.0",
  id,
  method: "approval/request",
  params: {
    session: SESSION,
    request: { id: requestId, kind: "approval", tool: "refund", inputHash: `hash-${requestId}` },
  },
});
const written = (requestId: string) => ({
  jsonrpc: "2.0",
  method: "event",
  params: {
    session: SESSION,
    seq: 1,
    event: {
      type: "entry_appended",
      entry: { type: "approval_resolved", resolution: { requestId, decision: "allow" } },
    },
  },
});
const settledAs = (turn: string, stopReason: string) => ({
  jsonrpc: "2.0",
  method: "turn/settled",
  params: { session: SESSION, turn, result: { stopReason, steps: 1, costUsd: null } },
});
const waiting: TurnResultSummary = { stopReason: "awaiting_approval", steps: 1, costUsd: null };

/** Resolves with `promise`'s value, or with "hung" when it has not settled after `ms`. */
const within = <T>(promise: Promise<T>, ms = 500): Promise<T | "hung"> =>
  Promise.race([promise, new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), ms))]);

test("settle waits for the resume that is still running after an earlier one settled waiting", async () => {
  const server = fakeClient(() => []);
  const watch = new SessionWatch(server.client, SESSION, () => undefined);
  server.send(asked("sr-1", "rA"));
  server.send(asked("sr-2", "rB"));
  for (const request of [...watch.asked.values()]) {
    watch.answer(request, { requestId: request.params.request.id, decision: "allow" });
  }
  // The first resume applied rA and settled still waiting on rB; the second has written rB and still runs, so the
  // log no longer shows either request waiting.
  server.send(written("rA"));
  server.send(settledAs("r1", "awaiting_approval"));
  server.send(written("rB"));
  setTimeout(() => server.send(settledAs("r2", "done")), 20);
  const result = await within(settle(terminal().io, watch, waiting));
  assert.notEqual(result, "hung");
  assert.equal((result as TurnResultSummary).stopReason, "done");
});

test("settle returns when the answered request was settled elsewhere, so no resume will settle", async () => {
  let pending = ["rA"];
  const server = fakeClient(() => pending);
  const watch = new SessionWatch(server.client, SESSION, () => undefined);
  server.send(asked("sr-1", "rA"));
  const io = terminal(["y"]).io;
  const readLine = io.readLine;
  // Another process answers rA while the person types: the server drops our answer and runs no resume.
  const racing = {
    ...io,
    readLine: async () => {
      pending = [];
      return readLine();
    },
  };
  const result = await within(settle(racing, watch, waiting));
  assert.deepEqual(result, waiting);
  assert.equal(server.responded.length, 1);
});

test("whenAsked reads the log when the server never asks about a stored request, and fails while it waits", async () => {
  let pending = ["rA"];
  const server = fakeClient(() => pending);
  const watch = new SessionWatch(server.client, SESSION, () => undefined);
  const failure = await within(
    watch.whenAsked(["rA"], 10).then(
      () => "resolved",
      (error: unknown) => error,
    ),
  );
  assert.ok(isCliError(failure), `expected a CliError, got ${String(failure)}`);
  assert.equal(failure.code, "session_unavailable");
  assert.match(failure.message, /still waits on rA, which the server never asked about/);

  pending = [];
  assert.equal(await within(watch.whenAsked(["rA"], 10).then(() => "resolved")), "resolved");
});

test("a tool/call is failed at once, with a reason, instead of left unanswered", () => {
  const server = fakeClient(() => []);
  new SessionWatch(server.client, SESSION, () => undefined);
  server.send({
    jsonrpc: "2.0",
    id: "sr-9",
    method: "tool/call",
    params: { session: SESSION, callId: "c1", tool: "lookup", input: {} },
  });
  assert.deepEqual(server.failed, [
    { id: "sr-9", message: "the buildanagent CLI runs no client tools, so register lookup to run in process" },
  ]);
});

test("run with a client_request tool doesn't hang: the call fails and the model reads why", async () => {
  const state = stateDir();
  try {
    const client = { ...recordingTool("lookup", []), source: "client" as const, pattern: "client_request" as const };
    const { model, adapter } = scripted([
      { content: [callTool("c1", "lookup", {})] },
      (request) =>
        reply(
          JSON.stringify(request.context.messages.at(-1)).includes("runs no client tools") ? "Told." : "Unexpected.",
        ),
    ]);
    const term = terminal();
    const status = await within(
      cli(term, state.dir, ["run", "Look it up"], {
        model,
        tools: [client],
        rules: { allow: [{ tool: "lookup" }] },
      }),
      5_000,
    );
    assert.equal(status, 0);
    adapter.assertComplete();
    assert.equal(term.stdout.join(""), "Told.\n");
  } finally {
    state.cleanup();
  }
});
