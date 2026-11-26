/**
 * The session-lock conformance suite: what every `SessionLock` must do. One writer holds a session at a time, and a
 * second writer gets `"would_block"` without waiting. Calling `release()` twice is safe and never drops another
 * writer's hold. Regardless of local process ids, an off-host lock stays held until its lease expires. The cases
 * import no test runner and no Node module, so any runner, including workerd, can call them.
 */
import type { LockHandle, SessionLock } from "../session/lock.js";
import type { SessionKey } from "../session/store.js";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";

/**
 * Lease-expiry hooks supplied by a lock factory. Off-host locks (`staleness: "lease_only"`) reclaim a session as soon
 * as its lease expires, as on DynamoDB, Postgres or a Durable Object. Local file locks
 * (`staleness: "lease_and_dead_pid"`) reclaim it only when the lease expires and the holding process on the same host
 * is dead.
 */
export interface LockLeaseHarness {
  /** A second lock instance representing another writer (dead PID on same host for local locks, or any peer off-host). */
  readonly peer: SessionLock;
  /** The lease duration in milliseconds. */
  readonly leaseMs: number;
  /** Advances the lock's clock by `ms` milliseconds without running background renewals. */
  readonly advanceClock: (ms: number) => Promise<void> | void;
  /** Staleness rule enforced by this lock backend. */
  readonly staleness: "lease_only" | "lease_and_dead_pid";
}

/** What a lock factory returns for one case. */
export interface LockUnderTest {
  /** The primary writer's lock instance. */
  readonly lock: SessionLock;
  /** Optional lease-expiry harness so the suite can verify takeover once the lease expires. */
  readonly lease?: LockLeaseHarness;
  /** Optional cleanup run after the case finishes. */
  readonly dispose?: () => Promise<void> | void;
}

/** Makes a fresh session lock for each case. */
export type LockFactory = () => LockUnderTest | Promise<LockUnderTest>;

/** One case of the lock conformance suite. */
export type LockCase = RunnableCase;

/** The report the lock conformance suite returns. */
export type LockConformanceReport = CaseReport;

const KEY_A: SessionKey = { userId: "alice", sessionId: "s1" };
const KEY_B: SessionKey = { userId: "alice", sessionId: "s2" };
const KEY_BOB: SessionKey = { userId: "bob", sessionId: "s1" };

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`SessionLock conformance: ${message}`);
}

function assertHandle(acquired: LockHandle | "would_block", message: string): LockHandle {
  check(acquired !== "would_block", message);
  return acquired;
}

async function checkLeaseTakeover({ lock, lease }: LockUnderTest): Promise<{ readonly skipped: string } | undefined> {
  if (lease === undefined) {
    return { skipped: "factory supplied no lease harness and controllable clock" };
  }
  const initial = assertHandle(await lease.peer.acquire(KEY_A), "peer acquire must succeed");
  try {
    const beforeExpiry = await lock.acquire(KEY_A);
    check(beforeExpiry === "would_block", "lock must not be stolen before its lease expires");

    await lease.advanceClock(lease.leaseMs + 1);
    const takeover = assertHandle(await lock.acquire(KEY_A), `expired lock (${lease.staleness}) must allow takeover`);
    try {
      check(takeover.token !== initial.token, "takeover handle must carry a new token");
      // A late release from the expired holder must not disturb the new holder.
      await initial.release();
      const contested = await lease.peer.acquire(KEY_A);
      check(contested === "would_block", "expired holder release must not free the takeover lock");
    } finally {
      await takeover.release();
    }
  } finally {
    await initial.release();
  }
  return undefined;
}

/** The lock conformance cases, each run against a fresh lock from `factory`. */
export function lockConformanceCases(factory: LockFactory): readonly LockCase[] {
  const named = (
    name: string,
    body: (under: LockUnderTest) => Promise<{ readonly skipped: string } | undefined>,
  ): LockCase => ({
    name,
    run: async () => {
      const under = await factory();
      try {
        return await body(under);
      } finally {
        await under.dispose?.();
      }
    },
  });

  return [
    named("acquire grants a held lock with a non-empty token and blocks a second writer at once", async ({ lock }) => {
      const first = assertHandle(await lock.acquire(KEY_A), "initial acquire must succeed");
      try {
        check(first.token.length > 0, "handle token must be non-empty");
        check(first.held() === true, "handle must report held() === true after acquire");
        const second = await lock.acquire(KEY_A);
        check(second === "would_block", "second writer on the same session must get would_block");
      } finally {
        await first.release();
      }
      return undefined;
    }),

    named("different sessions and different users with the same session id lock independently", async ({ lock }) => {
      const a = assertHandle(await lock.acquire(KEY_A), "acquire KEY_A must succeed");
      const b = assertHandle(await lock.acquire(KEY_B), "acquire KEY_B must succeed");
      const bob = assertHandle(await lock.acquire(KEY_BOB), "acquire KEY_BOB must succeed");
      try {
        check(a.token !== b.token && a.token !== bob.token, "independent locks must carry distinct tokens");
      } finally {
        await Promise.all([a.release(), b.release(), bob.release()]);
      }
      return undefined;
    }),

    named("release frees the session for the next writer and is safe to call twice", async ({ lock }) => {
      const first = assertHandle(await lock.acquire(KEY_A), "first acquire must succeed");
      await first.release();
      check(first.held() === false, "handle must report held() === false after release");
      const second = assertHandle(await lock.acquire(KEY_A), "second acquire after release must succeed");
      try {
        // Releasing the first handle a second time must never free the second writer's lock.
        await first.release();
        check(second.held() === true, "stale release must not drop the new writer's hold");
        const third = await lock.acquire(KEY_A);
        check(third === "would_block", "second writer must still block a third writer after stale release");
      } finally {
        await second.release();
      }
      return undefined;
    }),

    named("of many concurrent acquires on one session, exactly one wins", async ({ lock }) => {
      const results = await Promise.all(Array.from({ length: 8 }, () => lock.acquire(KEY_A)));
      const winners = results.filter((result): result is LockHandle => result !== "would_block");
      try {
        check(winners.length === 1, `expected exactly 1 winner, got ${winners.length}`);
        check(results.length - winners.length === 7, "all losing writers must receive would_block");
      } finally {
        await Promise.all(winners.map((handle) => handle.release()));
      }
      return undefined;
    }),

    named("stale lock stays held until its lease expires and allows takeover afterwards", checkLeaseTakeover),
  ];
}

/** Runs every lock conformance case and reports which passed, skipped and failed. */
export function runLockConformance(factory: LockFactory): Promise<LockConformanceReport> {
  return runCases(lockConformanceCases(factory));
}
