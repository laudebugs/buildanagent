/**
 * The `EffectStore` conformance cases: what every store must do for `guardedWrite()` to run a write at most once. The
 * memory store runs them in this package's tests, and each durable store, on Cloudflare, AWS or Vercel, runs the same
 * list. The cases throw plain `Error`s and import no test runner, so any runner, and workerd, can call them.
 */
import type { EffectRecord, EffectStore } from "./effect-store.js";
import { writeOutcome } from "./outcome.js";

/** One conformance case: a name a test runner can show, and a check that rejects if the store breaks the rule. */
export interface EffectStoreCase {
  /** What the case checks, as a sentence. */
  readonly name: string;
  /** Runs the check against a fresh, empty store from `makeStore`. */
  run(makeStore: () => EffectStore | Promise<EffectStore>): Promise<void>;
}

const START = "2026-11-19T10:00:00.000Z";

function record(key: string, attempt = 1, changes: Partial<EffectRecord> = {}): EffectRecord {
  return {
    key,
    scope: { tenant: "tenant-1", session: "session-1", branch: "main", toolCallId: `call-${attempt}` },
    businessKey: "refund:4417",
    operation: "refund_create",
    inputHash: "a".repeat(64),
    attempt,
    state: "started",
    startedAt: START,
    leaseUntil: "2026-11-19T10:05:00.000Z",
    ...changes,
  };
}

function settled(key: string, attempt = 1): EffectRecord {
  const outcome = writeOutcome({ kind: "applied", operation: "refund_create", effectKey: key, next: "Tell the user" });
  return record(key, attempt, { state: "settled", outcome, settledAt: "2026-11-19T10:01:00.000Z" });
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`EffectStore conformance: ${message}`);
}

// Compares records as JSON, so a store that serializes them passes, while a missing or changed field fails.
function same(actual: unknown, expected: unknown, message: string): void {
  check(JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected)), message);
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, sorted(item)]),
  );
}

const CASES: readonly EffectStoreCase[] = [
  {
    name: "begin stores a new record, and get returns it with every field",
    async run(makeStore) {
      const store = await makeStore();
      check((await store.begin(record("k1"))) === "started", "begin of a new key must return started");
      same(await store.get("k1"), record("k1"), "get must return the record begin stored");
      check((await store.get("absent")) === undefined, "get of an absent key must return undefined");
    },
  },
  {
    name: "begin on a key that exists returns the existing record and replaces nothing",
    async run(makeStore) {
      const store = await makeStore();
      await store.begin(record("k1"));
      const claim = await store.begin(record("k1", 1, { inputHash: "b".repeat(64) }));
      check(claim !== "started", "a second begin must not start");
      same(claim === "started" ? undefined : claim.existing, record("k1"), "begin must return the stored record");
      same(await store.get("k1"), record("k1"), "a second begin must not replace the record");
    },
  },
  {
    name: "of many concurrent begins on one key, exactly one starts",
    async run(makeStore) {
      const store = await makeStore();
      const claims = await Promise.all(Array.from({ length: 8 }, () => store.begin(record("k1"))));
      check(claims.filter((claim) => claim === "started").length === 1, "exactly one begin must start");
    },
  },
  {
    name: "takeOver succeeds only from the attempt before it",
    async run(makeStore) {
      const store = await makeStore();
      await store.begin(record("k1"));
      check((await store.takeOver(record("k1", 3))) !== "started", "a takeover that skips an attempt must fail");
      check((await store.takeOver(record("k1", 2))) === "started", "a takeover from the stored attempt must start");
      const stale = await store.takeOver(record("k1", 2));
      check(stale !== "started", "a second takeover from the same attempt must fail");
      same(stale === "started" ? undefined : stale.existing, record("k1", 2), "a failed takeover returns the record");
    },
  },
  {
    name: "of many concurrent takeovers from one attempt, exactly one starts",
    async run(makeStore) {
      const store = await makeStore();
      await store.begin(record("k1"));
      const claims = await Promise.all(Array.from({ length: 8 }, () => store.takeOver(record("k1", 2))));
      check(claims.filter((claim) => claim === "started").length === 1, "exactly one takeover must start");
    },
  },
  {
    name: "takeOver of a settled record starts a new attempt",
    async run(makeStore) {
      const store = await makeStore();
      await store.begin(record("k1"));
      await store.settle(settled("k1"));
      check((await store.takeOver(record("k1", 2))) === "started", "a settled record must be taken over");
      same(await store.get("k1"), record("k1", 2), "the takeover must replace the settled record");
    },
  },
  {
    name: "settle stores the outcome only for the started attempt that holds the record",
    async run(makeStore) {
      const store = await makeStore();
      await store.begin(record("k1"));
      await store.takeOver(record("k1", 2));
      check(!(await store.settle(settled("k1", 1))), "a settle from a superseded attempt must fail");
      same(await store.get("k1"), record("k1", 2), "a failed settle must change nothing");
      check(await store.settle(settled("k1", 2)), "a settle from the current attempt must succeed");
      same(await store.get("k1"), settled("k1", 2), "get must return the settled record with its outcome");
      check(!(await store.settle(settled("k1", 2))), "a second settle of a settled record must fail");
      check(!(await store.settle(settled("absent"))), "a settle of an absent key must fail");
    },
  },
  {
    name: "a record changed after it was stored or read leaves the stored one as it was",
    async run(makeStore) {
      const store = await makeStore();
      const original = { ...record("k1"), scope: { ...record("k1").scope } };
      await store.begin(original);
      (original.scope as { tenant: string }).tenant = "someone-else";
      const read = await store.get("k1");
      if (read !== undefined) (read.scope as { tenant: string }).tenant = "someone-else";
      same(await store.get("k1"), record("k1"), "the store must keep its own copy");
    },
  },
];

/**
 * The cases every `EffectStore` must pass. Run each against a fresh store:
 *
 * @example
 * ```ts
 * for (const conformance of effectStoreConformance()) {
 *   test(conformance.name, () => conformance.run(() => myEffectStore()));
 * }
 * ```
 */
export function effectStoreConformance(): readonly EffectStoreCase[] {
  return CASES;
}
