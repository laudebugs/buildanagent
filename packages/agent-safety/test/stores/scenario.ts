// The write rule on a store, end to end: what `guardedWrite()` does when an earlier attempt died holding its record.
// Each store's test runs it, so the rule that a started record is taken over only after its lease lapses is checked
// on every backend, not only on the memory store. It imports no test runner, so a Worker in workerd can run it too.
import {
  canonicalInputHash,
  type EffectRecord,
  type EffectStore,
  effectKey,
  guardedWrite,
  writeOutcome,
} from "../../src/index.js";

const SCOPE = { tenant: "user-1", session: "session-1", branch: "main", toolCallId: "call_1" };
const BUSINESS_KEY = "refund:4417";
const INPUT = { orderId: 4417, amount: 250 };
const START = Date.parse("2026-11-22T10:00:00.000Z");
const LEASE_MS = 60_000;

function fail(message: string): never {
  throw new Error(`store scenario: ${message}`);
}

/**
 * An earlier attempt stored its record and died. Until its lease lapses a call reports the write as in progress and
 * sends nothing; after it, the call checks with `reconcile`, runs the write once under the same key, and settles.
 */
export async function leaseScenario(makeStore: () => EffectStore | Promise<EffectStore>): Promise<void> {
  const store = await makeStore();
  const key = await effectKey(SCOPE, BUSINESS_KEY);
  const crashed: EffectRecord = {
    key,
    scope: SCOPE,
    businessKey: BUSINESS_KEY,
    operation: "refund_create",
    inputHash: await canonicalInputHash(INPUT),
    attempt: 1,
    state: "started",
    startedAt: new Date(START).toISOString(),
    leaseUntil: new Date(START + LEASE_MS).toISOString(),
  };
  if ((await store.begin(crashed)) !== "started") fail("the crashed attempt could not store its record");

  const sent: string[] = [];
  // Read through a function, so the checks below compare the count as it is now, not as an earlier check left it.
  const sentCount = () => sent.length;
  const call = (at: number) =>
    guardedWrite({
      store,
      scope: SCOPE,
      businessKey: BUSINESS_KEY,
      operation: "refund_create",
      input: INPUT,
      dedupe: "reconcile",
      leaseMs: LEASE_MS,
      now: () => at,
      reconcile: async () => "not_found",
      run: async (sentKey) => {
        sent.push(sentKey);
        return "re_1";
      },
      toOutcome: (id) => writeOutcome({ kind: "applied", operation: "refund_create", next: `Tell the user ${id}` }),
    });

  const early = await call(START + LEASE_MS - 1);
  if (early.kind !== "unknown" || early.reason !== "IN_PROGRESS") fail("a live attempt must report IN_PROGRESS");
  if (sentCount() !== 0) fail("a live attempt must not be sent again");

  const late = await call(START + LEASE_MS + 1);
  if (late.kind !== "applied") fail(`a lapsed attempt must run once and apply, got ${late.kind}`);
  if (sentCount() !== 1 || sent[0] !== key) fail("the write must run once, under the same key");

  const again = await call(START + 10 * LEASE_MS);
  if (again.kind !== "applied" || sentCount() !== 1) fail("a settled write must return its outcome without running");
  const stored = await store.get(key);
  if (stored?.state !== "settled" || stored.attempt !== 2) fail("the record must be settled at the second attempt");
}
