import assert from "node:assert/strict";
import {
  type EffectScope,
  type EffectStore,
  effectKey,
  type GuardedWriteOptions,
  guardedWrite,
  isSafetyError,
  memoryEffectStore,
  type WriteOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";
import { effectStoreConformance } from "@buildanagent/agent-safety/testing";
import { test } from "vitest";

const LEASE_MS = 60_000;
const SCOPE: EffectScope = { tenant: "user-1", session: "session-1", branch: "main", toolCallId: "call_1" };
const REFUND = { orderId: 4417, amount: 250 };

/** A fake payment API that records every request it receives, keyed by the idempotency key the tool sent. */
function fakeApi() {
  const requests: { key: string; body: unknown }[] = [];
  return {
    requests,
    async refund(key: string, body: unknown) {
      requests.push({ key, body });
      return { id: `re_${requests.length}` };
    },
    async find(key: string): Promise<WriteOutcome | "not_found"> {
      const found = requests.find((request) => request.key === key);
      return found === undefined ? "not_found" : applied();
    },
  };
}

function applied(): WriteOutcome {
  return writeOutcome({ kind: "applied", operation: "refund_create", next: "Tell the user the refund is on its way" });
}

/** A clock the test moves by hand. */
function clock(start = Date.parse("2026-11-19T10:00:00.000Z")) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

type Api = ReturnType<typeof fakeApi>;

function refundWrite(
  api: Api,
  store: EffectStore,
  changes: Partial<GuardedWriteOptions<{ id: string }>> = {},
): GuardedWriteOptions<{ id: string }> {
  return {
    store,
    scope: SCOPE,
    businessKey: `refund:${REFUND.orderId}`,
    operation: "refund_create",
    input: REFUND,
    dedupe: "idempotency_key",
    run: (key) => api.refund(key, REFUND),
    toOutcome: () => applied(),
    leaseMs: LEASE_MS,
    ...changes,
  };
}

/** Starts a write whose `run` reaches the API and then never returns, as a process that dies there would. */
async function crashAfterSend(api: Api, store: EffectStore, now: () => number) {
  let sent!: () => void;
  const reached = new Promise<void>((resolve) => {
    sent = resolve;
  });
  void guardedWrite(
    refundWrite(api, store, {
      now,
      run: async (key) => {
        await api.refund(key, REFUND);
        sent();
        return new Promise<never>(() => {});
      },
    }),
  );
  await reached;
}

/** Starts a write that stores its record and then never sends, as a process that dies before the request leaves. */
async function crashBeforeSend(api: Api, store: EffectStore, now: () => number) {
  let begun!: () => void;
  const reached = new Promise<void>((resolve) => {
    begun = resolve;
  });
  void guardedWrite(
    refundWrite(api, store, {
      now,
      run: () => {
        begun();
        return new Promise<never>(() => {});
      },
    }),
  );
  await reached;
}

test("a write runs once and returns its outcome with the effect key stamped on it", async () => {
  const api = fakeApi();
  const outcome = await guardedWrite(refundWrite(api, memoryEffectStore()));
  assert.equal(outcome.kind, "applied");
  assert.equal(outcome.effectKey, await effectKey(SCOPE, "refund:4417"));
  assert.deepEqual(
    api.requests.map((request) => request.key),
    [outcome.effectKey],
  );
});

test("a settled record returns its stored outcome without calling run", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const first = await guardedWrite(refundWrite(api, store));
  let ran = 0;
  const again = await guardedWrite(
    refundWrite(api, store, {
      run: async () => {
        ran++;
        return { id: "never" };
      },
    }),
  );
  assert.equal(ran, 0);
  assert.deepEqual(again, first);
  assert.equal(api.requests.length, 1);
});

test("the same key with a different input returns not_applied, IDEMPOTENCY_KEY_REUSED, and sends nothing", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  await guardedWrite(refundWrite(api, store));
  const outcome = await guardedWrite(refundWrite(api, store, { input: { ...REFUND, amount: 25_000 } }));
  assert.equal(outcome.kind, "not_applied");
  assert.equal(outcome.retry, "never");
  assert.equal(outcome.reason, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(api.requests.length, 1);
});

test("the same key under another operation is refused as a reused key", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  await guardedWrite(refundWrite(api, store));
  const outcome = await guardedWrite(refundWrite(api, store, { operation: "credit_create" }));
  assert.equal(outcome.reason, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(api.requests.length, 1);
});

test("two tool calls with different call ids and the same business key produce one external request", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const first = await guardedWrite(refundWrite(api, store));
  const regenerated = await guardedWrite(refundWrite(api, store, { scope: { ...SCOPE, toolCallId: "call_9" } }));
  assert.equal(api.requests.length, 1);
  assert.deepEqual(regenerated, first);
});

test("the business key spans the tenant's sessions and branches but never another tenant", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  await guardedWrite(refundWrite(api, store));
  await guardedWrite(
    refundWrite(api, store, { scope: { ...SCOPE, session: "session-2", branch: "fork", toolCallId: "call_2" } }),
  );
  assert.equal(api.requests.length, 1, "a new session of the same tenant repeats nothing");
  await guardedWrite(refundWrite(api, store, { scope: { ...SCOPE, tenant: "user-2" } }));
  assert.equal(api.requests.length, 2, "another tenant's refund of the same order id is its own effect");
});

test("without a business key, a fresh call id is a fresh effect, which is why writes declare one", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const { businessKey: _none, ...noBusinessKey } = refundWrite(api, store);
  await guardedWrite(noBusinessKey);
  await guardedWrite({ ...noBusinessKey, scope: { ...SCOPE, toolCallId: "call_2" } });
  assert.equal(api.requests.length, 2);
});

test("effectKey is 64 hex digits that the business key fixes and the call scope varies without one", async () => {
  const key = await effectKey(SCOPE, "refund:4417");
  assert.match(key, /^[0-9a-f]{64}$/);
  const elsewhere = { ...SCOPE, session: "s2", branch: "b2", toolCallId: "c2" };
  assert.equal(await effectKey(elsewhere, "refund:4417"), key);
  assert.notEqual(await effectKey({ ...SCOPE, tenant: "user-2" }, "refund:4417"), key);
  assert.notEqual(await effectKey(SCOPE), await effectKey({ ...SCOPE, branch: "fork" }));
  assert.notEqual(await effectKey(SCOPE), key);
});

test("a call while another attempt's lease is live gets unknown, IN_PROGRESS, and calls neither run nor reconcile", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const time = clock();
  await crashAfterSend(api, store, time.now);
  time.advance(LEASE_MS - 1);
  let calls = 0;
  const outcome = await guardedWrite(
    refundWrite(api, store, {
      now: time.now,
      scope: { ...SCOPE, toolCallId: "call_2" },
      run: async () => {
        calls++;
        return { id: "never" };
      },
      reconcile: async () => {
        calls++;
        return "not_found";
      },
    }),
  );
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.reason, "IN_PROGRESS");
  assert.equal(outcome.retry, "same_key");
  assert.equal(calls, 0);
});

test("after a crash once the lease lapses, with no reconcile hook, the resume is unknown and sends nothing", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const time = clock();
  await crashAfterSend(api, store, time.now);
  time.advance(LEASE_MS);
  const outcome = await guardedWrite(refundWrite(api, store, { now: time.now }));
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.retry, "reconcile_first");
  assert.equal(outcome.reason, "WRITE_INTERRUPTED");
  assert.equal(api.requests.length, 1);
});

test("after a crash past the request, a reconcile hook that finds it returns applied and sends nothing more", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const time = clock();
  await crashAfterSend(api, store, time.now);
  time.advance(LEASE_MS);
  const outcome = await guardedWrite(refundWrite(api, store, { now: time.now, reconcile: api.find }));
  assert.equal(outcome.kind, "applied");
  assert.equal(api.requests.length, 1);
  assert.equal((await store.get(outcome.effectKey ?? ""))?.state, "settled");
});

test("after a crash before the request left, reconcile's not_found sends once, under the same key", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const time = clock();
  await crashBeforeSend(api, store, time.now);
  time.advance(LEASE_MS);
  const outcome = await guardedWrite(refundWrite(api, store, { now: time.now, reconcile: api.find }));
  assert.equal(outcome.kind, "applied");
  assert.deepEqual(
    api.requests.map((request) => request.key),
    [await effectKey(SCOPE, "refund:4417")],
  );
});

test("two resumes that race after a lapsed lease run the write once", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const time = clock();
  await crashBeforeSend(api, store, time.now);
  time.advance(LEASE_MS);
  // The winner's reconcile waits until the loser has answered, so the loser meets the winner's live lease.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reconcile = async (key: string) => {
    await gate;
    return api.find(key);
  };
  const resume = () => guardedWrite(refundWrite(api, store, { now: time.now, reconcile }));
  const [first, second] = [resume(), resume()];
  const loser = await Promise.race([first, second]);
  assert.equal(loser.kind, "unknown");
  assert.equal(loser.reason, "IN_PROGRESS");
  release();
  const outcomes = await Promise.all([first, second]);
  assert.deepEqual(outcomes.map((outcome) => outcome.kind).sort(), ["applied", "unknown"]);
  assert.equal(api.requests.length, 1);
});

test("a run that throws settles as unknown, and a later call reconciles it instead of sending again", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const failing = await guardedWrite(
    refundWrite(api, store, {
      run: async (key) => {
        await api.refund(key, REFUND);
        throw new Error("socket hang up");
      },
    }),
  );
  assert.equal(failing.kind, "unknown");
  assert.equal(failing.reason, "WRITE_FAILED");
  assert.equal(failing.retry, "reconcile_first");
  const unchecked = await guardedWrite(refundWrite(api, store));
  assert.deepEqual(unchecked, failing, "without reconcile the stored unknown stands");
  const checked = await guardedWrite(refundWrite(api, store, { reconcile: api.find }));
  assert.equal(checked.kind, "applied");
  assert.equal(api.requests.length, 1);
});

test("onError turns a known rejection into not_applied, and a same-key retry then runs under the same key", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const rejected = await guardedWrite(
    refundWrite(api, store, {
      run: async () => {
        throw new Error("card_declined");
      },
      onError: () => writeOutcome({ kind: "not_applied", operation: "refund_create", next: "Ask for another card" }),
    }),
  );
  assert.equal(rejected.kind, "not_applied");
  assert.equal(rejected.retry, "same_key");
  const retried = await guardedWrite(refundWrite(api, store));
  assert.equal(retried.kind, "applied");
  assert.deepEqual(
    api.requests.map((request) => request.key),
    [rejected.effectKey],
  );
});

test("a toOutcome that throws settles the record as unknown and rethrows", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  await assert.rejects(
    guardedWrite(
      refundWrite(api, store, {
        toOutcome: () => {
          throw new Error("bad report");
        },
      }),
    ),
    /bad report/,
  );
  const record = await store.get(await effectKey(SCOPE, "refund:4417"));
  assert.equal(record?.state, "settled");
  assert.equal(record?.outcome?.reason, "REPORT_FAILED");
});

test("onError gets the effect key, so it can report unknown with a same_key retry that reruns under that key", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const conflicted = await guardedWrite(
    refundWrite(api, store, {
      run: async () => {
        throw new Error("409 conflict");
      },
      onError: (_error, key) =>
        writeOutcome({
          kind: "unknown",
          operation: "refund_create",
          effectKey: key,
          retry: "same_key",
          next: "Call the tool again for the same refund",
        }),
    }),
  );
  assert.equal(conflicted.kind, "unknown");
  assert.equal(conflicted.retry, "same_key");
  const retried = await guardedWrite(refundWrite(api, store));
  assert.equal(retried.kind, "applied");
  assert.deepEqual(
    api.requests.map((request) => request.key),
    [conflicted.effectKey],
  );
});

test("toOutcome gets the effect key as its second argument", async () => {
  const api = fakeApi();
  const keys: string[] = [];
  const outcome = await guardedWrite(
    refundWrite(api, memoryEffectStore(), {
      toOutcome: (_refund, key) => {
        keys.push(key);
        return applied();
      },
    }),
  );
  assert.deepEqual(keys, [outcome.effectKey]);
});

test("a settled partial outcome with retry reconcile_first goes to reconcile on the next call", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const partial = await guardedWrite(
    refundWrite(api, store, {
      toOutcome: () =>
        writeOutcome({
          kind: "partial",
          operation: "refund_create",
          retry: "reconcile_first",
          applied: ["refund issued"],
          notReversible: ["receipt email"],
          next: "Check the refund",
        }),
    }),
  );
  assert.equal(partial.kind, "partial");
  let checks = 0;
  const checked = await guardedWrite(
    refundWrite(api, store, {
      reconcile: async () => {
        checks++;
        return applied();
      },
    }),
  );
  assert.equal(checks, 1);
  assert.equal(checked.kind, "applied");
  assert.equal(api.requests.length, 1);
});

test("an onError that throws settles as unknown without saying the write ran, and rethrows even if settling fails", async () => {
  const api = fakeApi();
  const failingRun = async (): Promise<{ id: string }> => {
    throw new Error("validation failed");
  };
  const brokenHook = (): WriteOutcome => {
    throw new Error("onError bug");
  };
  const store = memoryEffectStore();
  await assert.rejects(guardedWrite(refundWrite(api, store, { run: failingRun, onError: brokenHook })), /onError bug/);
  const record = await store.get(await effectKey(SCOPE, "refund:4417"));
  assert.equal(record?.outcome?.reason, "REPORT_FAILED");
  assert.doesNotMatch(record?.outcome?.currentState ?? "", /ran/);

  const unreachable: EffectStore = {
    ...memoryEffectStore(),
    settle: async () => {
      throw new Error("store unreachable");
    },
  };
  await assert.rejects(
    guardedWrite(refundWrite(api, unreachable, { run: failingRun, onError: brokenHook })),
    /onError bug/,
  );
});

test("an unknown_only write that crashed stays unknown with retry never, so a person checks it", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const time = clock();
  await crashAfterSend(api, store, time.now);
  time.advance(LEASE_MS);
  const outcome = await guardedWrite(refundWrite(api, store, { now: time.now, dedupe: "unknown_only" }));
  assert.equal(outcome.kind, "unknown");
  assert.equal(outcome.retry, "never");
  assert.equal(api.requests.length, 1);
});

test("dedupe must match the reconcile hook, and scope fields and the business key must be non-empty", async () => {
  const api = fakeApi();
  const store = memoryEffectStore();
  const refused = async (changes: Partial<GuardedWriteOptions<{ id: string }>>) =>
    assert.rejects(
      guardedWrite(refundWrite(api, store, changes)),
      (e) => isSafetyError(e) && e.code === "invalid_effect",
    );
  await refused({ dedupe: "reconcile" });
  await refused({ dedupe: "unknown_only", reconcile: api.find });
  await refused({ businessKey: " " });
  await refused({ scope: { ...SCOPE, tenant: "" } });
  await refused({ operation: "" });
  await refused({ leaseMs: 0 });
  assert.equal(api.requests.length, 0);
});

for (const conformance of effectStoreConformance()) {
  test(`memoryEffectStore: ${conformance.name}`, () => conformance.run(() => memoryEffectStore()));
}
