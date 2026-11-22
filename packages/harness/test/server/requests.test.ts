// The server's requests: approvals and clarifications sent once their entry is durable and answered through
// Approvals.resolve() exactly once, tool/call for client tools, and $/cancelRequest in both directions.
import assert from "node:assert/strict";
import { createDispatcher, createHarness, type InProcessClient } from "@buildanagent/harness/server";
import { createToolRegistry } from "@buildanagent/harness/tools";
import type { ServerMessage, ServerRequest, SessionEntry } from "@buildanagent/protocol";
import { clarificationTool, defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/session-helpers.js";
import {
  approvalSetup,
  callTool,
  cancelsOf,
  gate,
  init,
  recorded,
  reply,
  requestsOf,
  SIGNER,
  scripted,
  settledCount,
  settledMessages,
  snapshotLoads,
  text,
  until,
} from "./server-helpers.js";

const REFUND = [{ content: [callTool("c1", "refund", { id: "o1" })] }, reply("Refunded.")];

const allow = (request: ServerRequest) => ({
  resolutions: [{ requestId: (request.params as { request: { id: string } }).request.id, decision: "allow" as const }],
});

async function logOf(setup: ReturnType<typeof approvalSetup>, session: string): Promise<SessionEntry[]> {
  const out: SessionEntry[] = [];
  for await (const entry of setup.backend.store.load({ userId: "ada", sessionId: session })) out.push(entry);
  return out;
}

describe("approval and clarification requests", () => {
  test("approval/request goes out only once the approval_requested entry is durable", async () => {
    // Record each request id the store has finished writing, at the moment its append resolves.
    const durable = new Set<string>();
    const base = memoryBackend();
    const store = {
      ...base.store,
      async append(...args: Parameters<typeof base.store.append>) {
        const stored = await base.store.append(...args);
        for (const entry of stored) if (entry.type === "approval_requested") durable.add(entry.request.id);
        return stored;
      },
    };
    const { dispatcher } = approvalSetup(REFUND, [], {}, { ...base, store });
    const { client, seen } = recorded(dispatcher);
    const atReceipt: boolean[] = [];
    client.onMessage((message) => {
      if ("id" in message && "method" in message && message.method === "approval/request") {
        atReceipt.push(durable.has(message.params.request.id));
      }
    });
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 1, "the turn to settle");
    assert.deepEqual(atReceipt, [true]);
    assert.equal(settledMessages(seen)[0]?.result.stopReason, "awaiting_approval");
  });

  test("an answer resolves through Approvals.resolve() once, and the resume settles as a turn of its own", async () => {
    const setup = approvalSetup(REFUND);
    const { client, seen } = recorded(setup.dispatcher);
    // The client answers inside its listener, while the paused turn is still finishing, so the answer must wait.
    client.onMessage((message) => {
      if ("id" in message && "method" in message && message.method === "approval/request") {
        client.respond(message, allow(message));
      }
    });
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    const disposition = await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 2, "the resume to settle");
    const [paused, resumed] = settledMessages(seen);
    assert.ok(disposition.accepted);
    assert.equal(paused?.turn, disposition.turn);
    assert.equal(paused?.result.stopReason, "awaiting_approval");
    assert.notEqual(resumed?.turn, disposition.turn);
    assert.equal(resumed?.result.stopReason, "done");
    assert.equal(setup.resolved.length, 1);
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
    const log = await logOf(setup, session);
    assert.equal(log.filter((entry) => entry.type === "approval_resolved").length, 1);
    assert.deepEqual((await client.request("approval/list", { session })).pending, []);
  });

  test("a clarification is asked with clarification/request and the answer becomes the call's result", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "ask_user",
      source: "builtin",
      definition: clarificationTool({ name: "ask_user" }) as unknown as ToolDefinition<unknown, unknown, unknown>,
    });
    const harness = createHarness({
      registry,
      model: scripted([{ content: [callTool("q1", "ask_user", { question: "Which order?" })] }, reply("Thanks.")]),
      system: "You triage tickets.",
      signer: SIGNER,
    });
    const backend = memoryBackend();
    const { client, seen } = recorded(createDispatcher({ harness, ...backend, userId: "ada" }));
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Help") });
    await until(() => requestsOf(seen).length === 1, "the clarification");
    const [asked] = requestsOf(seen);
    assert.equal(asked?.method, "clarification/request");
    assert.ok(asked?.method === "clarification/request");
    assert.equal(asked.params.request.kind, "clarification");
    client.respond(asked, {
      resolutions: [{ requestId: asked.params.request.id, answer: "Order o7." }],
    });
    await until(() => settledCount(seen) === 2, "the resume");
    const results: SessionEntry[] = [];
    for await (const entry of backend.store.load({ userId: "ada", sessionId: session })) results.push(entry);
    const result = results.find((entry) => entry.type === "tool_result" && entry.callId === "q1");
    assert.ok(result?.type === "tool_result");
    assert.deepEqual(result.content, [{ type: "text", text: "Order o7." }]);
  });

  test("a second answer with the same id and an answer to an id never sent are both ignored", async () => {
    const setup = approvalSetup(REFUND);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => requestsOf(seen).length === 1, "the request");
    const [asked] = requestsOf(seen);
    assert.ok(asked !== undefined);
    client.respond({ ...asked, id: "sr-999" }, allow(asked));
    client.respond(asked, allow(asked));
    client.respond(asked, allow(asked));
    await until(() => settledCount(seen) === 2, "the resume");
    // Give a wrongly accepted duplicate the time to start a second resume.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(setup.resolved.length, 1);
    assert.equal(settledCount(seen), 2);
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
  });

  test("the first of two clients to answer wins, and the other's request is withdrawn and its late answer ignored", async () => {
    const setup = approvalSetup(REFUND);
    const one = recorded(setup.dispatcher);
    const two = recorded(setup.dispatcher);
    await init(one.client);
    await init(two.client);
    const { session } = await one.client.request("session/create", { cwd: "/work" });
    await two.client.request("session/open", { session, cwd: "/work" });
    await one.client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => requestsOf(one.seen).length === 1 && requestsOf(two.seen).length === 1, "both requests");
    const [first] = requestsOf(one.seen);
    const [second] = requestsOf(two.seen);
    assert.ok(first !== undefined && second !== undefined);
    assert.notEqual(first.id, second.id);
    two.client.respond(second, allow(second));
    assert.deepEqual(cancelsOf(one.seen), [first.id]);
    one.client.respond(first, {
      resolutions: [{ requestId: (first.params as { request: { id: string } }).request.id, decision: "deny" }],
    });
    await until(() => settledCount(one.seen) === 2, "the resume");
    assert.equal(setup.resolved.length, 1);
    assert.equal((setup.resolved[0] as { decision: string }[])[0]?.decision, "allow");
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
  });

  test("a malformed answer is asked again with a new id, and an error answer leaves the request waiting", async () => {
    const setup = approvalSetup(REFUND);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => requestsOf(seen).length === 1, "the request");
    const [asked] = requestsOf(seen);
    assert.ok(asked?.method === "approval/request");
    // An answer for another request id, and one with two resolutions, are both malformed.
    client.respond(asked, { resolutions: [{ requestId: "other", decision: "allow" }] });
    await until(() => requestsOf(seen).length === 2, "the second ask");
    const again = requestsOf(seen)[1];
    assert.ok(again?.method === "approval/request");
    assert.notEqual(again.id, asked.id);
    assert.equal(again.params.request.id, asked.params.request.id);
    client.fail(again, { code: -32000, message: "the person closed the dialog" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(setup.resolved.length, 0);
    assert.equal(requestsOf(seen).length, 2);
    assert.equal((await client.request("approval/list", { session })).pending.length, 1);
  });

  test("a client that did not open the session is never asked and cannot answer", async () => {
    const setup = approvalSetup(REFUND);
    const owner = recorded(setup.dispatcher);
    const stranger = recorded(setup.dispatcher);
    await init(owner.client);
    await init(stranger.client);
    const { session } = await owner.client.request("session/create", { cwd: "/work" });
    await owner.client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(owner.seen) === 1, "the pause");
    const [asked] = requestsOf(owner.seen);
    assert.ok(asked !== undefined);
    assert.deepEqual(stranger.seen, []);
    // The stranger guesses the id; the request is the owner's, so nothing resolves.
    stranger.client.respond(asked, allow(asked));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(setup.resolved.length, 0);
  });
});

/** A client tool whose own `execute` must never run once the dispatcher routes it to the client. */
const lookup = {
  name: "lookup",
  source: "client" as const,
  pattern: "client_request" as const,
  definition: defineTool({
    name: "lookup",
    description: "Looks an order up on the client.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    async execute() {
      throw new Error("the client's tool ran in the server");
    },
  }) as ToolDefinition<unknown, unknown, unknown>,
};

const LOOKUP = [{ content: [callTool("c9", "lookup", { id: "o1" })] }, reply("Found it.")];

function toolResultEntry(seen: readonly ServerMessage[], callId: string) {
  for (const message of seen) {
    if ("method" in message && message.method === "event" && message.params.event.type === "entry_appended") {
      const { entry } = message.params.event;
      if (entry.type === "tool_result" && entry.callId === callId) return entry;
    }
  }
  return undefined;
}

describe("tool/call for client tools", () => {
  test("a client_request tool is sent as tool/call and the client's result becomes the call's result", async () => {
    const setup = approvalSetup(LOOKUP, [lookup]);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Find o1") });
    await until(() => requestsOf(seen, "tool/call").length === 1, "the tool call");
    const [call] = requestsOf(seen, "tool/call");
    assert.ok(call?.method === "tool/call");
    assert.deepEqual(call.params, { session, callId: "c9", tool: "lookup", input: { id: "o1" } });
    client.respond(call, { content: [{ type: "text", text: "order o1: shipped" }], isError: false });
    await until(() => settledCount(seen) === 1, "the turn");
    assert.equal(settledMessages(seen)[0]?.result.stopReason, "done");
    const result = toolResultEntry(seen, "c9");
    assert.deepEqual(result?.content, [{ type: "text", text: "order o1: shipped" }]);
    assert.equal(result?.isError, false);
  });

  test("an error answer, a malformed answer and a client that closes each give the model an error result", async () => {
    for (const how of ["error", "malformed", "close"] as const) {
      const setup = approvalSetup(LOOKUP, [lookup]);
      const { client, seen } = recorded(setup.dispatcher);
      const watcher = recorded(setup.dispatcher);
      await init(client);
      const { session } = await client.request("session/create", { cwd: "/work" });
      await watcher.client.request("session/open", { session, cwd: "/work" });
      await client.request("turn/start", { session, input: text("Find o1") });
      await until(() => requestsOf(seen, "tool/call").length === 1, "the tool call");
      const [call] = requestsOf(seen, "tool/call");
      assert.ok(call !== undefined);
      if (how === "error") client.fail(call, { code: -32000, message: "no such order" });
      if (how === "malformed") client.respond(call, { content: "oops" } as never);
      if (how === "close") client.close();
      await until(() => settledCount(watcher.seen) === 1, `the turn after ${how}`);
      const result = toolResultEntry(watcher.seen, "c9");
      assert.equal(result?.isError, true, how);
      assert.equal(settledMessages(watcher.seen)[0]?.result.stopReason, "done", how);
    }
  });

  test("an abort withdraws a pending tool/call, the turn settles aborted, and a late answer is ignored", async () => {
    const setup = approvalSetup(LOOKUP, [lookup]);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Find o1") });
    await until(() => requestsOf(seen, "tool/call").length === 1, "the tool call");
    const [call] = requestsOf(seen, "tool/call");
    assert.ok(call !== undefined);
    assert.deepEqual(await client.request("turn/interrupt", { session }), { interrupted: true });
    await until(() => settledCount(seen) === 1, "the turn");
    assert.deepEqual(cancelsOf(seen), [call.id]);
    assert.equal(settledMessages(seen)[0]?.result.stopReason, "aborted");
    client.respond(call, { content: [{ type: "text", text: "late" }], isError: false });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settledCount(seen), 1);
    assert.equal(JSON.stringify(seen).includes('"late"'), false);
  });

  test("an answer that arrives before the abort is kept, and the abort then withdraws nothing", async () => {
    const setup = approvalSetup([{ content: [callTool("c9", "lookup", { id: "o1" })] }, reply("Found it.")], [lookup]);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Find o1") });
    await until(() => requestsOf(seen, "tool/call").length === 1, "the tool call");
    const [call] = requestsOf(seen, "tool/call");
    assert.ok(call !== undefined);
    client.respond(call, { content: [{ type: "text", text: "shipped" }], isError: false });
    await client.request("turn/interrupt", { session });
    await until(() => settledCount(seen) === 1, "the turn");
    assert.deepEqual(cancelsOf(seen), []);
  });
});

describe("$/cancelRequest from the client", () => {
  test("cancelling a turn/start aborts the run and still sends one turn/settled", async () => {
    // A tool that waits until the test lets it go keeps the run alive while the cancel arrives.
    const held = gate();
    const slow = {
      name: "slow",
      source: "builtin" as const,
      definition: defineTool({
        name: "slow",
        description: "Waits.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        async execute(_input, ctx) {
          await Promise.race([held.promise, new Promise((resolve) => ctx.signal.addEventListener("abort", resolve))]);
          return { content: [{ type: "text", text: "waited" }] };
        },
      }) as ToolDefinition<unknown, unknown, unknown>,
    };
    const setup = approvalSetup([{ content: [callTool("c1", "slow", { id: "x" })] }, reply("Done.")], [slow]);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    const controller = new AbortController();
    const disposition = await client.request(
      "turn/start",
      { session, input: text("Wait") },
      { signal: controller.signal },
    );
    assert.ok(disposition.accepted);
    await until(
      () =>
        seen.some(
          (message) =>
            "method" in message && message.method === "event" && message.params.event.type === "tool_call_start",
        ),
      "the tool to start",
    );
    controller.abort();
    await until(() => settledCount(seen) === 1, "the turn to settle");
    held.open();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settledCount(seen), 1);
    const [settled] = settledMessages(seen);
    assert.equal(settled?.turn, disposition.turn);
    assert.equal(settled?.result.stopReason, "aborted");
  });

  test("a cancel for an id that names no turn does nothing", async () => {
    const setup = approvalSetup([reply("Done.")]);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    const raw = setup.dispatcher.connect(() => undefined);
    await raw.receive({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 1 } });
    await client.request("turn/start", { session, input: text("Hi") });
    await until(() => settledCount(seen) === 1, "the turn");
    assert.equal(settledMessages(seen)[0]?.result.stopReason, "done");
  });
});

describe("answers that race other work in the session", () => {
  test("an answer that waited on a turn/start that then failed to take the lock still resumes", async () => {
    const base = memoryBackend();
    const lockHeld = gate();
    let refuseNext = false;
    // The next lock taken after `refuseNext` waits for the test, then reports another writer.
    const lock = {
      async acquire(key: Parameters<typeof base.lock.acquire>[0]) {
        if (!refuseNext) return base.lock.acquire(key);
        refuseNext = false;
        await lockHeld.promise;
        return "would_block" as const;
      },
    };
    const setup = approvalSetup(REFUND, [], {}, { ...base, lock });
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 1, "the pause");
    const [asked] = requestsOf(seen);
    assert.ok(asked !== undefined);
    refuseNext = true;
    const second = client.request("turn/start", { session, input: text("Anything else?") });
    // The answer arrives while the second turn holds the session and waits for the lock.
    client.respond(asked, allow(asked));
    lockHeld.open();
    assert.deepEqual(await second, { accepted: false, reason: "locked" });
    await until(() => settledCount(seen) === 2, "the resume");
    assert.equal(settledMessages(seen)[1]?.result.stopReason, "done");
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
  });

  test("a dispatcher closed while a resume takes the lock writes no answer, so the request still waits", async () => {
    const setup = approvalSetup(REFUND);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 1, "the pause");
    const [asked] = requestsOf(seen);
    assert.ok(asked !== undefined);
    client.respond(asked, allow(asked));
    await setup.dispatcher.close();
    assert.equal(setup.resolved.length, 0);
    assert.deepEqual(setup.refunds, []);
    const log = await logOf(setup, session);
    assert.equal(log.filter((entry) => entry.type === "approval_resolved").length, 0);
    const later = recorded(approvalSetup(REFUND, [], {}, setup.backend).dispatcher);
    assert.equal((await init(later.client)).pending.length, 1);
  });

  test("a client asked again on open gets no request that another client's answer resolved during the read", async () => {
    const base = memoryBackend();
    const held = gate();
    let armed = false;
    let plain = 0;
    // Once armed, the second load with no options is the open's own read of the waiting requests.
    const slow = snapshotLoads(base.store, (options) => armed && options === undefined && ++plain === 2, held.promise);
    const setup = approvalSetup(REFUND, [], {}, { ...base, store: slow.store });
    const first = recorded(setup.dispatcher);
    await init(first.client);
    const { session } = await first.client.request("session/create", { cwd: "/work" });
    await first.client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(first.seen) === 1, "the pause");
    const [asked] = requestsOf(first.seen);
    assert.ok(asked !== undefined);
    armed = true;
    const second = recorded(setup.dispatcher);
    await second.client.request("session/open", { session, cwd: "/work" });
    await slow.taken;
    first.client.respond(asked, allow(asked));
    await until(() => settledCount(first.seen) === 2, "the resume");
    held.open();
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requestsOf(second.seen), []);
  });
});

describe("turn ids a client reuses", () => {
  test("a turn/start id reused for a second turn cancels the second, even after the first settles", async () => {
    const gates = [gate(), gate()];
    let calls = 0;
    const slow = {
      name: "slow",
      source: "builtin" as const,
      definition: defineTool({
        name: "slow",
        description: "Waits.",
        inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
        async execute(_input, ctx) {
          const held = gates[calls++]?.promise;
          await Promise.race([held, new Promise((resolve) => ctx.signal.addEventListener("abort", resolve))]);
          return { content: [{ type: "text", text: "waited" }] };
        },
      }) as ToolDefinition<unknown, unknown, unknown>,
    };
    const setup = approvalSetup(
      [
        { content: [callTool("a1", "slow", { id: "a" })] },
        { content: [callTool("b1", "slow", { id: "b" })] },
        reply("A done."),
        reply("B done."),
      ],
      [slow],
    );
    const wire: ServerMessage[] = [];
    const raw = setup.dispatcher.connect((message) => {
      wire.push(message);
    });
    const ask = (id: number, method: string, params: object) =>
      raw.receive({ jsonrpc: "2.0", id, method, params } as never);
    await ask(1, "session/create", { session: "A", cwd: "/work" });
    await ask(2, "session/create", { session: "B", cwd: "/work" });
    const started = (session: string) =>
      wire.some(
        (m) =>
          "method" in m &&
          m.method === "event" &&
          m.params.session === session &&
          m.params.event.type === "tool_call_start",
      );
    await ask(7, "turn/start", { session: "A", input: text("a") });
    await until(() => started("A"), "A's tool");
    // The client reuses id 7 now that A's turn/start has its response.
    await ask(7, "turn/start", { session: "B", input: text("b") });
    await until(() => started("B"), "B's tool");
    gates[0]?.open();
    await until(() => settledCount(wire) === 1, "A's turn");
    await raw.receive({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id: 7 } });
    await until(() => settledCount(wire) === 2, "B's turn");
    gates[1]?.open();
    const bySession = new Map(settledMessages(wire).map((settled) => [settled.session, settled.result.stopReason]));
    assert.deepEqual(
      [...bySession],
      [
        ["A", "done"],
        ["B", "aborted"],
      ],
    );
  });
});

describe("answers a resume could not apply", () => {
  test("an answer given while another process holds the lock is reported unapplied, asked again, and applied once", async () => {
    const setup = approvalSetup(REFUND);
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 1, "the pause");
    const [asked] = requestsOf(seen);
    assert.ok(asked !== undefined);
    const other = await setup.backend.lock.acquire({ userId: "ada", sessionId: session });
    assert.notEqual(other, "would_block");
    client.respond(asked, allow(asked));
    await until(() => settledCount(seen) === 2 && requestsOf(seen).length === 2, "the failed resume and the new ask");
    const failed = settledMessages(seen)[1];
    assert.equal(failed?.result.stopReason, "error");
    assert.equal(failed?.result.error?.kind, "answer_not_applied");
    if (other !== "would_block") await other.release();
    const again = requestsOf(seen)[1];
    assert.ok(again !== undefined && again.id !== asked.id);
    client.respond(again, allow(again));
    await until(() => settledCount(seen) === 3, "the resume");
    assert.equal(settledMessages(seen)[2]?.result.stopReason, "done");
    assert.equal(setup.resolved.length, 1);
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
  });

  test("a client that answers at once while the lock stays held is asked again at most three times", async () => {
    const base = memoryBackend();
    // Each lock taken yields to the event loop first, so a loop of asks would show up as a count, not a hang.
    const lock = {
      async acquire(key: Parameters<typeof base.lock.acquire>[0]) {
        await new Promise((resolve) => setImmediate(resolve));
        return base.lock.acquire(key);
      },
    };
    const setup = approvalSetup(REFUND, [], {}, { ...base, lock });
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 1, "the pause");
    const other = await setup.backend.lock.acquire({ userId: "ada", sessionId: session });
    // From now on the client answers every ask at once, and every resume finds the lock held.
    client.onMessage((message) => {
      if ("id" in message && "method" in message && message.method === "approval/request") {
        client.respond(message, allow(message));
      }
    });
    const [asked] = requestsOf(seen);
    assert.ok(asked !== undefined);
    client.respond(asked, allow(asked));
    await until(() => settledCount(seen) === 5, "four resumes that could not apply the answer");
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requestsOf(seen).length, 4, "the first ask and three more");
    assert.equal(settledCount(seen), 5);
    assert.equal(setup.resolved.length, 0);
    if (other !== "would_block") await other.release();
  });

  test("an answer whose resume is interrupted while it waits for the lock is reported unapplied and asked again", async () => {
    const base = memoryBackend();
    const lockHeld = gate();
    let slowNext = false;
    const lock = {
      async acquire(key: Parameters<typeof base.lock.acquire>[0]) {
        if (slowNext) {
          slowNext = false;
          await lockHeld.promise;
        }
        return base.lock.acquire(key);
      },
    };
    const setup = approvalSetup(REFUND, [], {}, { ...base, lock });
    const { client, seen } = recorded(setup.dispatcher);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund o1") });
    await until(() => settledCount(seen) === 1, "the pause");
    const [asked] = requestsOf(seen);
    assert.ok(asked !== undefined);
    slowNext = true;
    client.respond(asked, allow(asked));
    assert.deepEqual(await client.request("turn/interrupt", { session }), { interrupted: true });
    lockHeld.open();
    await until(() => settledCount(seen) === 2 && requestsOf(seen).length === 2, "the stopped resume and the new ask");
    const stopped = settledMessages(seen)[1];
    assert.equal(stopped?.result.stopReason, "aborted");
    assert.equal(stopped?.result.error?.kind, "answer_not_applied");
    assert.equal(setup.resolved.length, 0);
    const again = requestsOf(seen)[1];
    assert.ok(again !== undefined);
    client.respond(again, allow(again));
    await until(() => settledCount(seen) === 3, "the resume");
    assert.equal(setup.resolved.length, 1);
    assert.deepEqual(setup.refunds, [{ id: "o1" }]);
  });
});

/**
 * Compiled, never run: an answer's type follows the request's method, so answering an approval with a tool result, or
 * a tool call with resolutions, fails to compile.
 */
function answersFitTheirRequest(
  client: InProcessClient,
  approval: Extract<ServerRequest, { method: "approval/request" }>,
  call: Extract<ServerRequest, { method: "tool/call" }>,
): void {
  client.respond(approval, { resolutions: [{ requestId: "r", decision: "allow" }] });
  client.respond(call, { content: [{ type: "text", text: "ok" }], isError: false });
  // @ts-expect-error an approval is answered with resolutions, not a tool result
  client.respond(approval, { content: [{ type: "text", text: "ok" }], isError: false });
  // @ts-expect-error a tool call is answered with a tool result, not resolutions
  client.respond(call, { resolutions: [{ requestId: "r", decision: "allow" }] });
}
void answersFitTheirRequest;
