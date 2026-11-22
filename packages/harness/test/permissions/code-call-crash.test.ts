// A code call's result always lands, and a crash between its entries never misreads it: a result over the store's
// bound is cut to fit and keeps its outcome, and a call that a deny refused after a person's allow never counts as run.
import assert from "node:assert/strict";
import { effectKey } from "@buildanagent/agent-safety";
import { isHarnessError } from "@buildanagent/harness";
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import type { CodeCallResult } from "@buildanagent/harness/server";
import {
  createApprovals,
  DEFAULT_MAX_ENTRY_BYTES,
  effectScope,
  openSession,
  type SessionEntry,
  type SessionStore,
} from "@buildanagent/harness/session";
import { describe, test } from "vitest";
import { type Backend, KEY, memoryBackend } from "../session/session-helpers.js";
import { codeCallHarness, EXPORT_BYTES } from "./code-call-fixture.js";

const open = (backend: Backend, store: SessionStore = backend.store) =>
  openSession({ store, index: backend.index, lock: backend.lock, key: KEY });

async function entriesOf(backend: Backend): Promise<SessionEntry[]> {
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) found.push(entry);
  return found;
}

function expectStatus<S extends CodeCallResult["status"]>(
  result: unknown,
  status: S,
): Extract<CodeCallResult, { status: S }> {
  assert.equal((result as CodeCallResult).status, status);
  return result as Extract<CodeCallResult, { status: S }>;
}

const resultsOf = (entries: readonly SessionEntry[], callId: string) =>
  entries.filter((entry): entry is Extract<SessionEntry, { type: "tool_result" }> => {
    return entry.type === "tool_result" && entry.callId === callId;
  });

const textOf = (entry: Extract<SessionEntry, { type: "tool_result" }>) =>
  entry.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");

/** The store, refusing the first append that holds a `tool_result`, as a crash before the result was durable would. */
function failingFirstResult(store: SessionStore): SessionStore {
  let failing = true;
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "append") return typeof value === "function" ? value.bind(target) : value;
      return (async (key, entries, options) => {
        if (failing && entries.some((entry) => entry.type === "tool_result")) {
          failing = false;
          throw new Error("the process stopped");
        }
        return target.append(key, entries, options);
      }) satisfies SessionStore["append"];
    },
  });
}

describe("a code call whose result is over the store's entry bound", () => {
  test("returns done with its effect key, writes a bounded tool_result that keeps the outcome, and is never settled again", async () => {
    const backend = memoryBackend();
    const { harness, runs } = await codeCallHarness();
    const session = await open(backend);
    const done = expectStatus(await harness.invokeTool(session, { tool: "export", input: { orderId: "o1" } }), "done");
    assert.equal(done.effectKey, await effectKey(effectScope(session, harness, done.callId)));
    const text = done.result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    assert.ok(text.length > EXPORT_BYTES, "the host is given the whole result");
    const [stored] = resultsOf(await entriesOf(backend), done.callId);
    assert.ok(stored !== undefined && stored.id === done.entryId);
    assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= DEFAULT_MAX_ENTRY_BYTES);
    assert.equal(stored.isError, false);
    assert.match(textOf(stored), /"outcome":\{[^}]*"kind":"applied"/);
    assert.match(textOf(stored), /\[output cut: the first \d+ of \d+ bytes are shown; the rest could not be saved\]/);

    expectStatus(await harness.invokeTool(session, { tool: "lookup", input: { orderId: "o2" } }), "done");
    const after = resultsOf(await entriesOf(backend), done.callId);
    assert.equal(after.length, 1, "the next code call writes no settlement for a call that has its result");
    assert.deepEqual(
      runs.map((run) => run.split(":")[0]),
      ["export", "lookup"],
    );
    await session.close();
  });

  test("goes through the harness's context policy first, which spills the full text and records where", async () => {
    const backend = memoryBackend();
    const spill = memorySpillStore();
    const fixture = await codeCallHarness();
    const harness = { ...fixture.harness, context: createContextPolicy({ spill }) };
    const session = await open(backend);
    const done = expectStatus(await harness.invokeTool(session, { tool: "export", input: { orderId: "o1" } }), "done");
    const [stored] = resultsOf(await entriesOf(backend), done.callId);
    assert.ok(stored?.spill !== undefined, "the entry names its spill");
    assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= DEFAULT_MAX_ENTRY_BYTES);
    assert.ok(spill.read(stored.spill.path)?.includes("e".repeat(EXPORT_BYTES)));
    assert.match(textOf(stored), /"kind":"applied"/);
    await session.close();
  });
});

describe("a code call refused after a person's allow, with no result before a crash", () => {
  test("is settled as never run, and a compensation for it is refused", async () => {
    const backend = memoryBackend();
    const fixture = await codeCallHarness();
    const first = await open(backend);
    const asked = expectStatus(
      await fixture.harness.invokeTool(first, { tool: "refund", input: { orderId: "o1" } }),
      "awaiting_approval",
    );
    await first.close();
    // A deny rule written since the pause refuses the call after the person's allow, and the deny's result is lost.
    const stricter = await codeCallHarness({ deny: [{ tool: "refund", reason: "refunds are frozen" }] });
    const crashed = await open(backend, failingFirstResult(backend.store));
    await assert.rejects(
      createApprovals(stricter.harness).resolve(crashed, [
        { requestId: asked.pending.id, decision: "allow", by: "ada" },
      ]),
    );
    await crashed.close();
    const logged = await entriesOf(backend);
    assert.deepEqual(
      logged.slice(-2).map((entry) => [entry.type, "decision" in entry ? entry.decision : undefined]),
      [
        ["approval_resolved", undefined],
        ["permission_decision", "deny"],
      ],
    );
    assert.equal(resultsOf(logged, asked.callId).length, 0);

    const session = await open(backend);
    const refusedBeforeSettling = await fixture.harness
      .invokeTool(session, { tool: "refund_reverse", input: { orderId: "o1" }, compensates: asked.callId })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    assert.ok(isHarnessError(refusedBeforeSettling) && refusedBeforeSettling.code === "invalid_code_call");
    assert.deepEqual(await createApprovals(fixture.harness).pending(session), []);

    expectStatus(await fixture.harness.invokeTool(session, { tool: "lookup", input: { orderId: "o9" } }), "done");
    const [settled] = resultsOf(await entriesOf(backend), asked.callId);
    assert.ok(settled?.isError && settled.origin === "harness");
    assert.match(textOf(settled), /never ran/);
    assert.equal(settled.details, undefined, "a call that never ran has no write outcome");
    await assert.rejects(
      fixture.harness.invokeTool(session, {
        tool: "refund_reverse",
        input: { orderId: "o1" },
        compensates: asked.callId,
      }),
      (error: unknown) => isHarnessError(error) && error.code === "invalid_code_call",
    );
    assert.deepEqual(
      [...fixture.runs, ...stricter.runs].map((run) => run.split(":")[0]),
      ["lookup"],
    );
    await session.close();
  });

  test("a person's allow for a tool no longer registered, lost before its denial, is settled as never run", async () => {
    const backend = memoryBackend();
    const fixture = await codeCallHarness();
    const first = await open(backend);
    const asked = expectStatus(
      await fixture.harness.invokeTool(first, { tool: "refund", input: { orderId: "o1" } }),
      "awaiting_approval",
    );
    await first.close();
    // The same harness with `refund` gone from its registry: the call is denied after the allow, before any decision.
    const registry = new Proxy(fixture.harness.registry, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property === "get") return (name: string) => (name === "refund" ? undefined : target.get(name));
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const without = { ...fixture.harness, registry };
    const crashed = await open(backend, failingFirstResult(backend.store));
    await assert.rejects(
      createApprovals(without).resolve(crashed, [{ requestId: asked.pending.id, decision: "allow", by: "ada" }]),
    );
    await crashed.close();
    assert.equal((await entriesOf(backend)).at(-1)?.type, "approval_resolved");
    const session = await open(backend);
    expectStatus(await fixture.harness.invokeTool(session, { tool: "lookup", input: { orderId: "o9" } }), "done");
    const [settled] = resultsOf(await entriesOf(backend), asked.callId);
    assert.ok(settled !== undefined && settled.origin === "harness" && /never ran/.test(textOf(settled)));
    assert.deepEqual(
      fixture.runs.map((run) => run.split(":")[0]),
      ["lookup"],
    );
    await session.close();
  });
});
