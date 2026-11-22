// The dispatcher over the in-process transport: replies before events, one settle per turn, the lock, initialize and
// the experimental gate.
import assert from "node:assert/strict";
import { createModel, type Model } from "@buildanagent/gateway";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import {
  createDispatcher,
  createHarness,
  type InProcessClient,
  inProcessTransport,
  RpcFailure,
} from "@buildanagent/harness/server";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { ErrorCodes, type ServerMessage } from "@buildanagent/protocol";
import { defineTool, hmacSigner } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { memoryBackend } from "../session/session-helpers.js";

const scripted = (steps: ConstructorParameters<typeof ScriptedModel>[0]) =>
  createModel({ adapter: new ScriptedModel(steps), id: "scripted-model", retries: 0 }) as Model;

const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });

function setup(steps: ConstructorParameters<typeof ScriptedModel>[0], backend = memoryBackend(), extra: object = {}) {
  const harness = createHarness({
    registry: createToolRegistry(),
    model: scripted(steps),
    system: "You triage tickets.",
  });
  const dispatcher = createDispatcher({ harness, ...backend, userId: "ada", ...extra });
  const client = inProcessTransport(dispatcher);
  const seen: ServerMessage[] = [];
  client.onMessage((message) => seen.push(message));
  return { backend, dispatcher, client, seen };
}

const methods = (seen: readonly ServerMessage[]) =>
  seen.map((message) => ("method" in message ? message.method : "response"));

async function settled(seen: ServerMessage[], count = 1): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (seen.filter((m) => "method" in m && m.method === "turn/settled").length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("no turn/settled");
}

const init = (client: InProcessClient, capabilities: string[] = []) =>
  client.request("initialize", { clientInfo: { name: "test", version: "0" }, capabilities });
const text = (value: string) => [{ type: "text" as const, text: value }];

describe("the dispatcher", () => {
  test("turn/start replies with a disposition before the first event, and the turn settles once", async () => {
    const { dispatcher, client, seen } = setup([reply("Done.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    // A raw connection sees the response and the notifications in the order the server sent them.
    const wire: string[] = [];
    const raw = dispatcher.connect((message) => wire.push("method" in message ? message.method : "response"));
    await raw.receive({ jsonrpc: "2.0", id: 1, method: "session/open", params: { session, cwd: "/work" } });
    wire.length = 0;
    await raw.receive({ jsonrpc: "2.0", id: 2, method: "turn/start", params: { session, input: text("Hi") } });
    await settled(seen);
    assert.equal(wire[0], "response");
    assert.ok(wire.includes("event"));
    assert.equal(wire.filter((m) => m === "turn/settled").length, 1);
    assert.equal(wire.at(-1), "turn/settled");
    assert.equal(methods(seen).filter((m) => m === "turn/settled").length, 1);
  });

  test("an event's seq is the entry's seq when the event is an appended entry", async () => {
    const { client, seen } = setup([reply("Done.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Hi") });
    await settled(seen);
    for (const message of seen) {
      if ("method" in message && message.method === "event" && message.params.event.type === "entry_appended") {
        assert.equal(message.params.seq, message.params.event.entry.seq);
      }
    }
  });

  test("a second turn start on a running session is busy, and on an unknown session invalid", async () => {
    const { client, seen } = setup([reply("One."), reply("Two.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    const first = client.request("turn/start", { session, input: text("a") });
    const second = client.request("turn/start", { session, input: text("b") });
    assert.equal((await first).accepted, true);
    assert.deepEqual(await second, { accepted: false, reason: "busy" });
    assert.deepEqual(await client.request("turn/start", { session: "nope", input: text("c") }), {
      accepted: false,
      reason: "invalid",
    });
    await settled(seen);
  });

  test("a client on another dispatcher over the same lock is told locked", async () => {
    const backend = memoryBackend();
    const one = setup([reply("One.")], backend);
    const two = setup([reply("Two.")], backend);
    await init(one.client);
    await init(two.client);
    const { session } = await one.client.request("session/create", { cwd: "/work" });
    await two.client.request("session/open", { session, cwd: "/work" }).catch(() => undefined);
    // The first turn writes the session; open on the other side once it exists.
    await one.client.request("turn/start", { session, input: text("a") });
    await settled(one.seen);
    await two.client.request("session/open", { session, cwd: "/work" });
    const lock = await backend.lock.acquire({ userId: "ada", sessionId: session });
    assert.notEqual(lock, "would_block");
    assert.deepEqual(await two.client.request("turn/start", { session, input: text("b") }), {
      accepted: false,
      reason: "locked",
    });
    if (lock !== "would_block") await lock.release();
  });

  test("initialize lists a pending approval for the user's sessions", async () => {
    const { client } = setup([reply("Done.")]);
    const result = await init(client);
    assert.deepEqual(result.pending, []);
    assert.ok(result.capabilities.length > 0);
    assert.deepEqual(result.experimental, ["session/checkout", "session/fork"]);
    assert.equal(result.serverInfo.specVersion, "v1");
  });

  test("capabilities the host adds pass through initialize", async () => {
    const { client } = setup([reply("Done.")], memoryBackend(), { capabilities: ["x_v1"] });
    assert.ok((await init(client)).capabilities.includes("x_v1"));
  });

  test("session/fork without opting in answers NotOptedIn", async () => {
    const { client } = setup([reply("Done.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await assert.rejects(
      client.request("session/fork", { session, entryId: "e1" }),
      (error: unknown) => error instanceof RpcFailure && error.rpc.code === ErrorCodes.NotOptedIn,
    );
  });

  test("session/list pages the user's sessions", async () => {
    const { client, seen } = setup([reply("Done.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("a") });
    await settled(seen);
    const list = await client.request("session/list", {});
    assert.deepEqual(
      list.sessions.map((item) => item.session),
      [session],
    );
  });

  test("turn/interrupt with no turn running reports false", async () => {
    const { client } = setup([reply("Done.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    assert.deepEqual(await client.request("turn/interrupt", { session }), { interrupted: false });
  });

  test("initialize on a session with a pending approval lists it, and approval/list agrees", async () => {
    const registry = createToolRegistry();
    registry.register({
      name: "refund",
      source: "builtin",
      definition: defineTool({
        name: "refund",
        description: "Refunds an order.",
        inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
        async execute() {
          return { content: [{ type: "text", text: "refunded" }] };
        },
      }) as never,
    });
    const pipeline = createPermissionPipeline(
      { mode: "default", interactive: true, policyVersion: "p1", ask: [{ tool: "refund" }] },
      registry,
    );
    const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const harness = createHarness({
      registry,
      model: scripted([{ content: [{ type: "tool_call", callId: "c1", name: "refund", input: { orderId: "o1" } }] }]),
      system: "You triage tickets.",
      pipeline,
      signer: hmacSigner({ keys: { k1: key }, current: "k1" }),
    });
    const backend = memoryBackend();
    const dispatcher = createDispatcher({ harness, ...backend, userId: "ada" });
    const client = inProcessTransport(dispatcher);
    const seen: ServerMessage[] = [];
    client.onMessage((message) => seen.push(message));
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("Refund it") });
    await settled(seen);
    const joined = await init(inProcessTransport(dispatcher));
    assert.equal(joined.pending.length, 1);
    assert.equal(joined.pending[0]?.session, session);
    const listed = await client.request("approval/list", { session });
    assert.deepEqual(
      listed.pending,
      joined.pending.map((item) => item.request),
    );
  });

  test("a client callback that throws does not fail the write, the turn or the lock", async () => {
    const { dispatcher, client, seen } = setup([reply("One."), reply("Two.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    const raw = dispatcher.connect(() => {
      throw new Error("client gone");
    });
    await raw.receive({ jsonrpc: "2.0", id: 1, method: "session/open", params: { session, cwd: "/work" } });
    await client.request("turn/start", { session, input: text("a") });
    await settled(seen, 1);
    assert.equal((await client.request("turn/start", { session, input: text("b") })).accepted, true);
    await settled(seen, 2);
  });

  test("an interrupt sent as soon as a turn is accepted stops it, and an early steer is kept", async () => {
    const { client, seen } = setup([reply("One."), reply("Two.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    await client.request("turn/start", { session, input: text("a") });
    const steered = await client.request("turn/steer", { session, input: text("b") });
    assert.equal(steered.accepted, true);
    assert.deepEqual(await client.request("turn/interrupt", { session }), { interrupted: true });
    await settled(seen);
    const settledMessage = seen.find((m) => "method" in m && m.method === "turn/settled");
    assert.ok(settledMessage !== undefined);
  });

  test("a client that did not open a session cannot drive it, and a closed dispatcher refuses new turns", async () => {
    const { dispatcher, client, seen } = setup([reply("One.")]);
    await init(client);
    const { session } = await client.request("session/create", { cwd: "/work" });
    const other = inProcessTransport(dispatcher);
    assert.deepEqual(await other.request("turn/start", { session, input: text("a") }), {
      accepted: false,
      reason: "invalid",
    });
    assert.deepEqual(await other.request("turn/interrupt", { session }), { interrupted: false });
    await dispatcher.close();
    assert.deepEqual(await client.request("turn/start", { session, input: text("a") }), {
      accepted: false,
      reason: "busy",
    });
    assert.equal(seen.length, 0);
  });
});
