// Code-initiated calls: a side effect the host's code chose runs through the permission pipeline, the signed pause and
// the log with no model step, and every check on its resolution fails closed.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { effectKey, pendingPayload } from "@buildanagent/agent-safety";
import { isHarnessError } from "@buildanagent/harness";
import type { CodeCallResult, Harness } from "@buildanagent/harness/server";
import {
  createApprovals,
  effectScope,
  openSession,
  quorumOf,
  runTurn,
  type SessionEntry,
  type SessionStore,
} from "@buildanagent/harness/session";
import { createPendingRequest, hmacSigner, type Resolution, verifyResolution } from "@buildanagent/sdk";
import { describe, test } from "vitest";
import { type Backend, fileBackend, KEY, memoryBackend } from "../session/session-helpers.js";
import { codeCallHarness, FIXTURE_KEYS } from "./code-call-fixture.js";

const open = (backend: Backend, store: SessionStore = backend.store) =>
  openSession({ store, index: backend.index, lock: backend.lock, key: KEY });

async function entriesOf(backend: Backend): Promise<SessionEntry[]> {
  const found: SessionEntry[] = [];
  for await (const entry of backend.store.load(KEY)) found.push(entry);
  return found;
}

const typesOf = (entries: readonly SessionEntry[]) => entries.map((entry) => entry.type);
const allow = (requestId: string, by = "ada"): Resolution => ({ requestId, decision: "allow", by });

function expectStatus<S extends CodeCallResult["status"]>(
  result: unknown,
  status: S,
): Extract<CodeCallResult, { status: S }> {
  assert.equal((result as CodeCallResult).status, status);
  return result as Extract<CodeCallResult, { status: S }>;
}

/** Asks for a refund of `orderId` in a fresh session, and returns the waiting call. */
async function paused(backend: Backend, hostContext?: unknown) {
  const fixture = await codeCallHarness();
  const session = await open(backend);
  const asked = expectStatus(
    await fixture.harness.invokeTool(session, {
      tool: "refund",
      input: { orderId: "o1" },
      ...(hostContext === undefined ? {} : { hostContext }),
    }),
    "awaiting_approval",
  );
  return { ...fixture, session, asked };
}

/** Rejects with a `HarnessError` that has `code`. */
async function rejectsWith(promise: Promise<unknown>, code: string): Promise<Error> {
  let caught: unknown;
  await promise.catch((error: unknown) => {
    caught = error;
  });
  assert.ok(isHarnessError(caught), `expected a HarnessError ${code}, got ${String(caught)}`);
  assert.equal(caught.code, code);
  return caught;
}

describe("a code call", () => {
  test("an allowed call runs the tool once and writes code_call, permission_decision and tool_result in order, with no model call", async () => {
    const backend = memoryBackend();
    const { harness, adapter, runs } = await codeCallHarness();
    const session = await open(backend);
    const done = expectStatus(await harness.invokeTool(session, { tool: "lookup", input: { orderId: "o1" } }), "done");
    assert.deepEqual(runs, [`lookup:o1:${done.callId}`]);
    const entries = await entriesOf(backend);
    assert.deepEqual(typesOf(entries), [
      "session_header",
      "env_stamp",
      "code_call",
      "permission_decision",
      "tool_result",
    ]);
    const [call, decision, result] = entries.slice(2);
    assert.ok(call?.type === "code_call" && decision?.type === "permission_decision" && result?.type === "tool_result");
    assert.equal(call.id, done.callId, "the call id is the code_call entry's id");
    assert.equal(call.origin, "harness");
    assert.deepEqual([decision.callId, decision.decision, result.callId], [done.callId, "allow", done.callId]);
    assert.equal(result.id, done.entryId);
    assert.equal(result.isError, false);
    assert.equal(adapter.calls.length, 0, "no model call was made");
    await session.close();
  });

  test("a denied call writes an isError tool_result and never runs the tool", async () => {
    const backend = memoryBackend();
    const { harness, runs } = await codeCallHarness();
    const session = await open(backend);
    const denied = expectStatus(
      await harness.invokeTool(session, { tool: "cancel", input: { orderId: "o1" } }),
      "denied",
    );
    assert.equal(denied.reason, "cancelling is not allowed");
    assert.deepEqual(runs, []);
    const last = (await entriesOf(backend)).at(-1);
    assert.ok(last?.type === "tool_result" && last.isError && last.id === denied.entryId);
    await session.close();
  });

  test("an ask writes an approval_requested entry that verifies with the key ring and is byte-identical to createPendingRequest()", async () => {
    const backend = memoryBackend();
    const host = { user: "ada" };
    const { asked, session, runs, adapter } = await paused(backend, host);
    const entries = await entriesOf(backend);
    assert.deepEqual(typesOf(entries).slice(2), ["code_call", "permission_decision", "approval_requested"]);
    const requested = entries.at(-1);
    assert.ok(requested?.type === "approval_requested");
    const { request } = requested;
    assert.deepEqual(request, asked.pending);
    const signer = hmacSigner(FIXTURE_KEYS);
    const check = await verifyResolution(request, allow(request.id), {
      signer,
      call: { callId: asked.callId, tool: "refund", input: { orderId: "o1" } },
      app: host,
    });
    assert.equal(check.ok, true);
    const rebuilt = await createPendingRequest(
      {
        kind: "approval",
        callId: asked.callId,
        tool: "refund",
        input: { orderId: "o1" },
        policyVersion: "p1",
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        app: host,
      },
      signer,
      { generateId: () => request.id, now: () => new Date(request.createdAt) },
    );
    assert.deepEqual(rebuilt, request);
    assert.deepEqual(pendingPayload(rebuilt), pendingPayload(request), "the signed bytes are the same");
    assert.deepEqual(runs, []);
    assert.equal(adapter.calls.length, 0);
    await session.close();
  });

  test("the pending list holds the code call's request, with its input", async () => {
    const backend = memoryBackend();
    const { harness, asked, session } = await paused(backend);
    const pending = await createApprovals(harness).pending(session);
    assert.deepEqual(pending, [{ request: asked.pending, input: { orderId: "o1" } }]);
    await session.close();
  });

  test("an allow runs the tool exactly once with no model call and returns done", async () => {
    const backend = memoryBackend();
    const { harness, asked, session, runs, adapter } = await paused(backend);
    const done = expectStatus(await createApprovals(harness).resolve(session, [allow(asked.pending.id)]), "done");
    assert.equal(done.callId, asked.callId);
    assert.deepEqual(runs, [`refund:o1:${asked.callId}`]);
    assert.equal(adapter.calls.length, 0);
    assert.deepEqual(typesOf(await entriesOf(backend)).slice(-3), [
      "approval_resolved",
      "permission_decision",
      "tool_result",
    ]);
    await session.close();
  });

  test("a deny rule added after the pause turns an allow into a denial, and the tool never runs", async () => {
    const backend = memoryBackend();
    const { asked, session, runs } = await paused(backend);
    const stricter = await codeCallHarness({ deny: [{ tool: "refund", reason: "refunds are frozen" }] });
    const denied = expectStatus(
      await createApprovals(stricter.harness).resolve(session, [allow(asked.pending.id)]),
      "denied",
    );
    assert.equal(denied.reason, "refunds are frozen");
    assert.deepEqual([...runs, ...stricter.runs], []);
    await session.close();
  });

  test("a person's deny ends the call denied with their reason", async () => {
    const backend = memoryBackend();
    const { harness, asked, session, runs } = await paused(backend);
    const denied = expectStatus(
      await createApprovals(harness).resolve(session, [
        { requestId: asked.pending.id, decision: "deny", reason: "not this one", by: "ada" },
      ]),
      "denied",
    );
    assert.equal(denied.reason, "not this one");
    assert.deepEqual(runs, []);
    await session.close();
  });

  test("a quorum of two keeps the call waiting after one approver and runs it after a second distinct one", async () => {
    const backend = memoryBackend();
    const { harness, asked, session, runs } = await paused(backend);
    const approvals = createApprovals(harness, { quorum: quorumOf(2) });
    const one = expectStatus(await approvals.resolve(session, [allow(asked.pending.id, "ada")]), "awaiting_approval");
    assert.equal(one.pending.id, asked.pending.id);
    expectStatus(await approvals.resolve(session, [allow(asked.pending.id, "ada")]), "awaiting_approval");
    assert.deepEqual(runs, [], "the same approver twice is one approver");
    expectStatus(await approvals.resolve(session, [allow(asked.pending.id, "grace")]), "done");
    assert.deepEqual(runs, [`refund:o1:${asked.callId}`]);
    await session.close();
  });

  test("the model never reads a code call: the next turn's request holds only the user's message", async () => {
    const backend = memoryBackend();
    const { harness, adapter } = await codeCallHarness({ steps: [{ content: [{ type: "text", text: "Hi." }] }] });
    const session = await open(backend);
    expectStatus(await harness.invokeTool(session, { tool: "lookup", input: { orderId: "o1" } }), "done");
    const turn = await runTurn(session, harness, { input: "hello" });
    assert.equal(turn.stopReason, "done");
    assert.deepEqual(
      adapter.calls[0]?.context.messages.map((message) => message.role),
      ["user"],
    );
    await session.close();
  });
});

describe("a code call's effect key", () => {
  test("comes from the code_call entry's id when the tool declares no business key", async () => {
    const backend = memoryBackend();
    const { harness } = await codeCallHarness();
    const session = await open(backend);
    const done = expectStatus(await harness.invokeTool(session, { tool: "lookup", input: { orderId: "o1" } }), "done");
    const call = (await entriesOf(backend)).find((entry) => entry.type === "code_call");
    assert.equal(call?.id, done.callId);
    assert.equal(done.effectKey, await effectKey(effectScope(session, harness, call?.id as string)));
    await session.close();
  });

  test("comes from the business key when the tool declares one, and a resolution in a new harness finds the same key", async () => {
    const backend = memoryBackend();
    const { harness, asked, session } = await paused(backend);
    const expected = await effectKey(effectScope(session, harness, asked.callId), "refund:o1");
    assert.equal(asked.effectKey, expected);
    await session.close();
    const later = await codeCallHarness();
    const reopened = await open(backend);
    const done = expectStatus(
      await createApprovals(later.harness).resolve(reopened, [allow(asked.pending.id)]),
      "done",
    );
    assert.equal(done.effectKey, expected);
    assert.equal(done.effectKey, await effectKey(effectScope(reopened, later.harness, asked.callId), "refund:o1"));
    await reopened.close();
  });

  test("takes the harness's tenant, so another tenant's call gets another key", async () => {
    const backend = memoryBackend();
    const { asked, session } = await paused(backend);
    const other = await codeCallHarness({ tenant: "acme" });
    const theirs = await effectKey(effectScope(session, other.harness, asked.callId), "refund:o1");
    assert.notEqual(asked.effectKey, theirs);
    await session.close();
  });
});

describe("a compensation", () => {
  /** A refund that ran, in a fresh session. */
  async function refunded(backend: Backend) {
    const fixture = await paused(backend);
    const approvals = createApprovals(fixture.harness);
    const done = expectStatus(await approvals.resolve(fixture.session, [allow(fixture.asked.pending.id)]), "done");
    return { ...fixture, approvals, done };
  }

  test("runs through invokeTool with its own key, and its code_call names the call it undoes", async () => {
    const backend = memoryBackend();
    const { harness, session, approvals, done, runs } = await refunded(backend);
    const undo = expectStatus(
      await harness.invokeTool(session, { tool: "refund_reverse", input: { orderId: "o1" }, compensates: done.callId }),
      "awaiting_approval",
    );
    const undone = expectStatus(await approvals.resolve(session, [allow(undo.pending.id)]), "done");
    assert.notEqual(undone.effectKey, done.effectKey);
    assert.equal(undone.effectKey, await effectKey(effectScope(session, harness, undone.callId), "refund-reverse:o1"));
    const link = (await entriesOf(backend)).find((entry) => entry.type === "code_call" && entry.callId === undo.callId);
    assert.ok(link?.type === "code_call" && link.compensates === done.callId);
    assert.deepEqual(runs, [`refund:o1:${done.callId}`, `refund_reverse:o1:${undone.callId}`]);
    await session.close();
  });

  test("that would share the key of the call it undoes is refused, and nothing is written", async () => {
    const backend = memoryBackend();
    const { harness, session, done } = await refunded(backend);
    const before = (await entriesOf(backend)).length;
    await rejectsWith(
      harness.invokeTool(session, { tool: "refund", input: { orderId: "o1" }, compensates: done.callId }),
      "invalid_code_call",
    );
    assert.equal((await entriesOf(backend)).length, before);
    await session.close();
  });

  test("that names no call that ran is refused: an unknown call id, or a call that was denied", async () => {
    const backend = memoryBackend();
    const { harness } = await codeCallHarness();
    const session = await open(backend);
    const denied = expectStatus(
      await harness.invokeTool(session, { tool: "cancel", input: { orderId: "o1" } }),
      "denied",
    );
    const before = (await entriesOf(backend)).length;
    for (const compensates of ["no-such-call", denied.callId]) {
      await rejectsWith(
        harness.invokeTool(session, { tool: "refund_reverse", input: { orderId: "o1" }, compensates }),
        "invalid_code_call",
      );
    }
    assert.equal((await entriesOf(backend)).length, before);
    await session.close();
  });
});

describe("a code call's sticky and grouped answers", () => {
  test("are refused for a tool whose approvalReuse forbids them, and nothing is written", async () => {
    const backend = memoryBackend();
    const { harness, runs } = await codeCallHarness();
    const session = await open(backend);
    const asked = expectStatus(
      await harness.invokeTool(session, { tool: "notify", input: { orderId: "o1" } }),
      "awaiting_approval",
    );
    const before = (await entriesOf(backend)).length;
    const approvals = createApprovals(harness);
    for (const options of [{ sticky: "session" as const }, { group: true }]) {
      await rejectsWith(approvals.resolve(session, [allow(asked.pending.id)], options), "approval_reuse_refused");
    }
    assert.equal((await entriesOf(backend)).length, before);
    assert.deepEqual(runs, []);
    await session.close();
  });

  test("a sticky allow lets the same call run again without asking", async () => {
    const backend = memoryBackend();
    const { harness, asked, session, runs } = await paused(backend);
    expectStatus(
      await createApprovals(harness).resolve(session, [allow(asked.pending.id)], { sticky: "session" }),
      "done",
    );
    const again = expectStatus(await harness.invokeTool(session, { tool: "refund", input: { orderId: "o1" } }), "done");
    const decisions = (await entriesOf(backend)).filter(
      (entry) => entry.type === "permission_decision" && entry.callId === again.callId,
    );
    assert.deepEqual(
      decisions.map((entry) => (entry.type === "permission_decision" ? [entry.decision, entry.by] : [])),
      [
        ["ask", undefined],
        ["allow", "sticky"],
      ],
    );
    assert.equal(runs.length, 2);
    await session.close();
  });
});

describe("a code call fails closed", () => {
  test("a resolution replayed after the call ran is refused, and the tool ran once", async () => {
    const backend = memoryBackend();
    const { harness, asked, session, runs } = await paused(backend);
    const approvals = createApprovals(harness);
    expectStatus(await approvals.resolve(session, [allow(asked.pending.id)]), "done");
    await rejectsWith(approvals.resolve(session, [allow(asked.pending.id)]), "approval_not_pending");
    assert.equal(runs.length, 1);
    await session.close();
  });

  test("a resolution whose request names no code call and no turn is refused", async () => {
    const backend = memoryBackend();
    const { harness, session } = await paused(backend);
    await rejectsWith(createApprovals(harness).resolve(session, [allow("no-such-request")]), "approval_not_pending");
    await session.close();
  });

  test("a code call's answer given with any other answer is refused", async () => {
    const backend = memoryBackend();
    const { harness, asked, session, runs } = await paused(backend);
    await rejectsWith(
      createApprovals(harness).resolve(session, [allow(asked.pending.id), allow("another-request")]),
      "invalid_code_call",
    );
    assert.deepEqual(runs, []);
    await session.close();
  });

  /** Appends `request` as a later approval_requested entry for the waiting call, as a tampered log would hold it. */
  async function forge(
    session: Awaited<ReturnType<typeof open>>,
    request: unknown,
    input: unknown = { orderId: "o1" },
  ) {
    await session.append([
      {
        id: "forged",
        parentId: session.head(),
        timestamp: "2026-11-22T00:00:00.000Z",
        origin: "harness",
        type: "approval_requested",
        request: request as never,
        input,
      },
    ]);
  }

  /** Resolves `requestId` and checks it is refused with nothing written and nothing run. */
  async function refused(
    backend: Backend,
    fixture: { harness: Harness; runs: string[]; session: Awaited<ReturnType<typeof open>> },
    requestId: string,
    options = {},
  ) {
    const before = (await entriesOf(backend)).length;
    const error = await rejectsWith(
      createApprovals(fixture.harness).resolve(fixture.session, [allow(requestId)], options),
      "approval_refused",
    );
    assert.equal((await entriesOf(backend)).length, before, "nothing was written");
    assert.deepEqual(fixture.runs, [], "nothing ran");
    return error;
  }

  test("a forged signature is refused, and the error holds neither the signature nor the key", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    const signature = `${fixture.asked.pending.signature.slice(0, -2)}AA`;
    await forge(fixture.session, { ...fixture.asked.pending, signature });
    const error = await refused(backend, fixture, fixture.asked.pending.id);
    assert.match(error.message, /signature_invalid/);
    assert.ok(!error.message.includes(signature) && !error.message.includes(fixture.asked.pending.signature));
    assert.ok(!error.message.includes(Buffer.from(FIXTURE_KEYS.keys.k1).toString("base64url")));
    await fixture.session.close();
  });

  test("a request signed under a key the ring lacks is refused", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    const stranger = hmacSigner({ keys: { k2: new Uint8Array(32).fill(9) }, current: "k2" });
    const { pending } = fixture.asked;
    const request = await createPendingRequest(
      { kind: "approval", callId: pending.callId, tool: "refund", input: { orderId: "o1" }, policyVersion: "p1" },
      stranger,
      { generateId: () => pending.id },
    );
    await forge(fixture.session, request);
    assert.match((await refused(backend, fixture, pending.id)).message, /signature_invalid/);
    await fixture.session.close();
  });

  test("an input shown to the approver that differs from the signed one is refused", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    await forge(fixture.session, fixture.asked.pending, { orderId: "o2" });
    assert.match((await refused(backend, fixture, fixture.asked.pending.id)).message, /input_changed/);
    await fixture.session.close();
  });

  test("a code_call input edited in the session file is refused, with or without its hash", async () => {
    for (const rehash of [false, true]) {
      const backend = fileBackend();
      const fixture = await paused(backend);
      await fixture.session.close();
      const file = join(backend.dir as string, "sessions", KEY.userId, `${KEY.sessionId}.jsonl`);
      const lines = readFileSync(file, "utf8").trimEnd().split("\n");
      const edited = lines.map((line) => {
        const entry = JSON.parse(line) as SessionEntry;
        if (entry.type !== "code_call") return line;
        const inputHash = rehash ? "0".repeat(64) : entry.inputHash;
        return JSON.stringify({ ...entry, input: { orderId: "o2" }, inputHash });
      });
      writeFileSync(file, `${edited.join("\n")}\n`);
      const session = await open(backend);
      const error = await refused(backend, { ...fixture, session }, fixture.asked.pending.id);
      assert.match(error.message, /input_changed/);
      await session.close();
    }
  });

  test("a request bound to one caller's host context is refused for another, and the right caller can still resolve it", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend, { user: "ada" });
    const id = fixture.asked.pending.id;
    assert.match((await refused(backend, fixture, id, { hostContext: { user: "eve" } })).message, /app_mismatch/);
    await refused(backend, fixture, id);
    const done = await createApprovals(fixture.harness).resolve(fixture.session, [allow(id)], {
      hostContext: { user: "ada" },
    });
    expectStatus(done, "done");
    assert.equal(fixture.runs.length, 1);
    await fixture.session.close();
  });

  test("a call let run before a crash, with no result, never runs again and is settled as a write that may have applied", async () => {
    const backend = memoryBackend();
    const fixture = await paused(backend);
    await fixture.session.close();
    // The store refuses the first tool_result, as a crash after the tool ran and before its result was durable would.
    let failing = true;
    const crashing = new Proxy(backend.store, {
      get(target, property) {
        const value = Reflect.get(target, property);
        if (property !== "append") return typeof value === "function" ? value.bind(target) : value;
        return (async (key, entries, options) => {
          if (failing && entries.some((entry) => entry.type === "tool_result")) {
            failing = false;
            throw new Error("the disk is full");
          }
          return target.append(key, entries, options);
        }) satisfies SessionStore["append"];
      },
    });
    const crashed = await open(backend, crashing);
    await assert.rejects(createApprovals(fixture.harness).resolve(crashed, [allow(fixture.asked.pending.id)]));
    await crashed.close();
    assert.equal(fixture.runs.length, 1, "the tool ran before the result was lost");
    const session = await open(backend);
    const approvals = createApprovals(fixture.harness);
    await rejectsWith(approvals.resolve(session, [allow(fixture.asked.pending.id)]), "approval_not_pending");
    assert.deepEqual(await approvals.pending(session), []);
    expectStatus(await fixture.harness.invokeTool(session, { tool: "lookup", input: { orderId: "o9" } }), "done");
    const settled = (await entriesOf(backend)).find(
      (entry) => entry.type === "tool_result" && entry.callId === fixture.asked.callId,
    );
    assert.ok(settled?.type === "tool_result" && settled.isError);
    assert.equal((settled.details as { outcome: { kind: string } }).outcome.kind, "unknown");
    assert.deepEqual(
      fixture.runs.map((run) => run.split(":")[0]),
      ["refund", "lookup"],
    );
    await session.close();
  });
});

describe("invokeTool() refuses before it writes anything", () => {
  test("for a tool the registry lacks, an input with no canonical form, or an aborted signal", async () => {
    const backend = memoryBackend();
    const { harness, runs } = await codeCallHarness();
    const session = await open(backend);
    await rejectsWith(harness.invokeTool(session, { tool: "nope", input: {} }), "invalid_code_call");
    await rejectsWith(
      harness.invokeTool(session, { tool: "lookup", input: { orderId: "o1", at: Number.NaN } }),
      "invalid_code_call",
    );
    await rejectsWith(
      harness.invokeTool(session, { tool: "refund", input: { orderId: "o1" }, hostContext: { at: () => 1 } }),
      "invalid_code_call",
    );
    const stop = new AbortController();
    stop.abort(new Error("stopped"));
    await assert.rejects(
      harness.invokeTool(session, { tool: "lookup", input: { orderId: "o1" }, signal: stop.signal }),
      /stopped/,
    );
    assert.deepEqual(await entriesOf(backend), []);
    assert.deepEqual(runs, []);
    await session.close();
  });

  test("for a harness with no permission pipeline or no signer", async () => {
    const backend = memoryBackend();
    const { harness } = await codeCallHarness();
    const session = await open(backend);
    const unchecked = { ...harness, pipeline: undefined } as unknown as Harness;
    await rejectsWith(unchecked.invokeTool(session, { tool: "lookup", input: { orderId: "o1" } }), "invalid_code_call");
    const unsigned = { ...harness, signer: undefined } as unknown as Harness;
    await rejectsWith(
      unsigned.invokeTool(session, { tool: "lookup", input: { orderId: "o1" } }),
      "approval_unavailable",
    );
    assert.deepEqual(await entriesOf(backend), []);
    await session.close();
  });
});
