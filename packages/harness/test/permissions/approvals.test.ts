// Signed approvals in the log: a pause is an entry written before a client hears of it, and any process that can open
// the session and load the key ring resumes it.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createModel, type Model, type PriceCatalog } from "@buildanagent/gateway";
import { isHarnessError } from "@buildanagent/harness";
import { createPermissionPipeline, type PermissionConfig } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import {
  createApprovals,
  type EntryInput,
  openSession,
  runTurn,
  type SessionEntry,
} from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, hmacSigner } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { BACKENDS, type Backend, KEY } from "../session/session-helpers.js";

const SOURCE = "https://provider.test/pricing";
const CATALOG: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: "priced",
      rates: [{ uncachedInput: 3, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 15, upToInputTokens: null }],
      contextWindow: 200_000,
      maxOutputTokens: 4000,
      asOf: "2026-11-01",
      sources: { rates: SOURCE, contextWindow: SOURCE, maxOutputTokens: SOURCE },
    },
  ],
};

const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const signer = () => hmacSigner({ keys: { k1: KEY_BYTES }, current: "k1" });

function tools(onRun: () => void) {
  const registry = createToolRegistry();
  registry.register({
    name: "refund",
    source: "builtin",
    definition: defineTool({
      name: "refund",
      description: "Refunds an order.",
      inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
      async execute(input: { orderId: string }) {
        onRun();
        return { content: [{ type: "text", text: `refunded ${input.orderId}` }] };
      },
    }) as never,
  });
  return registry;
}

const call = (callId = "c1") => ({
  content: [{ type: "tool_call" as const, callId, name: "refund", input: { orderId: "o1" } }],
});

function setup(
  steps: ConstructorParameters<typeof ScriptedModel>[0],
  options: { config?: Partial<PermissionConfig>; onRun?: () => void } = {},
) {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: "scripted-model", retries: 0 }) as Model;
  const registry = tools(options.onRun ?? (() => undefined));
  const pipeline = createPermissionPipeline(
    { mode: "default", interactive: true, policyVersion: "p1", ask: [{ tool: "refund" }], ...options.config },
    registry,
  );
  const harness = createHarness({ registry, model, system: "You triage tickets.", pipeline, signer: signer() });
  return { adapter, harness };
}

const open = (backend: Backend, key = KEY) =>
  openSession({ store: backend.store, index: backend.index, lock: backend.lock, key });

const entriesOf = async (backend: Backend) => {
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) found.push(entry);
  return found;
};

describe.each(BACKENDS)("%s", (_name, make) => {
  test("a gate ask ends the turn awaiting approval with one approval_requested entry, and toContext() matches the run's context", async () => {
    const backend = make();
    const { harness } = setup([call()]);
    const session = await open(backend);
    const result = await runTurn(session, harness, { input: "refund o1" });
    assert.equal(result.stopReason, "awaiting_approval");
    const requested = (await entriesOf(backend)).filter((entry) => entry.type === "approval_requested");
    assert.equal(requested.length, 1);
    const entry = requested[0];
    assert.ok(
      entry?.type === "approval_requested" && entry.request.callId === "c1" && entry.request.kind === "approval",
    );
    assert.deepEqual(entry.input, { orderId: "o1" });
    assert.deepEqual(await session.toContext(), result.context);
    assert.deepEqual(
      (await createApprovals(harness).pending(session)).map((p) => p.request.id),
      [entry.request.id],
    );
    await session.close();
  });

  test("resolving an allow resumes the turn, runs the call once and records the answer before the result", async () => {
    const backend = make();
    let runs = 0;
    const first = setup([call()], { onRun: () => (runs += 1) });
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "refund o1" });
    const approvals = createApprovals(first.harness);
    const [waiting] = await approvals.pending(session);
    const second = setup([{ content: [{ type: "text", text: "Refunded." }] }], { onRun: () => (runs += 1) });
    const resumed = await createApprovals(second.harness).resolve(session, [
      { requestId: waiting?.request.id as string, decision: "allow", by: "ada" },
    ]);
    assert.equal(resumed.stopReason, "done");
    assert.equal(runs, 1);
    const types = (await entriesOf(backend)).map((entry) => entry.type);
    assert.ok(types.indexOf("approval_resolved") < types.indexOf("tool_result"), "the answer is logged first");
    assert.deepEqual(await approvals.pending(session), []);
    const start = (await entriesOf(backend)).findLast((entry) => entry.type === "turn_start");
    assert.ok(start?.type === "turn_start" && start.mode === "continue");
    await session.close();
  });
  test("a deny rule added after the pause turns an allow resolution into a denial result", async () => {
    const backend = make();
    let runs = 0;
    const first = setup([call()], { onRun: () => (runs += 1) });
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "refund o1" });
    const [waiting] = await createApprovals(first.harness).pending(session);
    const later = setup([{ content: [{ type: "text", text: "Understood." }] }], {
      onRun: () => (runs += 1),
      config: { deny: [{ tool: "refund", reason: "refunds are frozen" }] },
    });
    await createApprovals(later.harness).resolve(session, [
      { requestId: waiting?.request.id as string, decision: "allow", by: "ada" },
    ]);
    assert.equal(runs, 0, "the call never ran");
    const result = (await entriesOf(backend)).find((entry) => entry.type === "tool_result");
    assert.ok(result?.type === "tool_result" && result.isError);
    assert.match(JSON.stringify(result.content), /refunds are frozen/);
    await session.close();
  });

  test("a tampered signature runs nothing and asks again with a new request", async () => {
    const full = make();
    let runs = 0;
    const first = setup([call()], { onRun: () => (runs += 1) });
    const session = await open(full);
    await runTurn(session, first.harness, { input: "refund o1" });
    await session.close();
    const tampered = make();
    const entries = await entriesOf(full);
    await tampered.store.append(
      KEY,
      entries.map(
        ({ seq: _seq, ...rest }) =>
          (rest.type === "approval_requested"
            ? { ...rest, request: { ...rest.request, signature: `${rest.request.signature.slice(0, -2)}AA` } }
            : rest) as EntryInput,
      ),
    );
    const reopened = await open(tampered);
    const [waiting] = await createApprovals(first.harness).pending(reopened);
    const second = setup([{ content: [{ type: "text", text: "never" }] }], { onRun: () => (runs += 1) });
    const resumed = await createApprovals(second.harness).resolve(reopened, [
      { requestId: waiting?.request.id as string, decision: "allow", by: "ada" },
    ]);
    assert.equal(runs, 0, "nothing ran");
    assert.equal(resumed.stopReason, "awaiting_approval", "the call asks again");
    const requests = (await entriesOf(tampered)).filter((entry) => entry.type === "approval_requested");
    assert.equal(requests.length, 2);
    const [again] = await createApprovals(second.harness).pending(reopened);
    assert.notEqual(again?.request.id, waiting?.request.id);
    await reopened.close();
  });

  test("a resume whose remaining cap is below the next call's projection ends budget before the call", async () => {
    const backend = make();
    const priced = (steps: ConstructorParameters<typeof ScriptedModel>[0]) => {
      const adapter = new ScriptedModel(steps);
      const model = createModel({ adapter, id: "priced", catalog: CATALOG, retries: 0 }) as Model;
      const registry = tools(() => undefined);
      const pipeline = createPermissionPipeline(
        { mode: "default", interactive: true, policyVersion: "p1", ask: [{ tool: "refund" }] },
        registry,
      );
      return { adapter, harness: createHarness({ registry, model, system: "s", pipeline, signer: signer() }) };
    };
    const first = priced([call()]);
    const session = await open(backend);
    await runTurn(session, first.harness, { input: "refund o1" });
    const [waiting] = await createApprovals(first.harness).pending(session);
    const second = priced([{ content: [{ type: "text", text: "Done." }] }]);
    const resumed = await createApprovals(second.harness).resolve(
      session,
      [{ requestId: waiting?.request.id as string, decision: "allow", by: "ada" }],
      { budgetUsd: 0.000_001 },
    );
    assert.equal(resumed.stopReason, "budget");
    assert.equal(second.adapter.calls.length, 0, "no model call after the resume");
    await session.close();
  });

  test("no key byte appears in an entry or an event", async () => {
    const backend = make();
    const events: unknown[] = [];
    const { harness } = setup([call()]);
    const observed = { ...harness, observers: [(event: unknown) => void events.push(event)] };
    const session = await open(backend);
    await runTurn(session, observed as never, { input: "refund o1" });
    const [waiting] = await createApprovals(harness).pending(session);
    await createApprovals(observed as never)
      .resolve(session, [{ requestId: waiting?.request.id as string, decision: "allow", by: "ada" }])
      .catch(() => undefined);
    const text = JSON.stringify([await entriesOf(backend), events]);
    for (const form of [
      Buffer.from(KEY_BYTES).toString("base64url"),
      Buffer.from(KEY_BYTES).toString("base64"),
      Buffer.from(KEY_BYTES).toString("hex"),
      JSON.stringify([...KEY_BYTES]),
      JSON.stringify({ ...KEY_BYTES }),
    ]) {
      assert.ok(!text.includes(form), "key bytes in the log or an event");
    }
    assert.ok(text.includes('"keyId":"k1"'), "the request names its key by id");
    await session.close();
  });

  test("resolving a request that doesn't wait, or without a signer, throws", async () => {
    const backend = make();
    const { harness } = setup([call()]);
    const session = await open(backend);
    await runTurn(session, harness, { input: "refund o1" });
    await assert.rejects(
      () => createApprovals(harness).resolve(session, [{ requestId: "nope", decision: "allow" }]),
      (error) => isHarnessError(error) && error.code === "approval_not_pending",
    );
    const unsigned = { ...harness, signer: undefined };
    await assert.rejects(
      () => createApprovals(unsigned as never).resolve(session, [{ requestId: "nope", decision: "allow" }]),
      (error) => isHarnessError(error) && error.code === "approval_unavailable",
    );
    await session.close();
  });
});
