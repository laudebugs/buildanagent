// The Cloudflare adapters refuse options they can't use before they touch the object's storage, so a storage stand-in
// that records nothing is enough here, and one that fails shows how a storage error reaches the caller. Everything
// they do with real storage runs in workerd, in cloudflare.test.ts.
import assert from "node:assert/strict";
import { isHarnessError } from "@buildanagent/harness";
import { type DurableStorageLike, doAlarmScheduler, doLock, doSqliteStore } from "@buildanagent/harness/cloudflare";
import { test } from "vitest";

const untouched: DurableStorageLike = {
  sql: {
    exec: () => {
      throw new Error("the adapter touched storage before it checked its options");
    },
  },
  transactionSync: (closure) => closure(),
  setAlarm: async () => undefined,
  deleteAlarm: async () => undefined,
};

const code = (expected: string) => (error: unknown) => isHarnessError(error) && error.code === expected;

test("doSqliteStore refuses an entry bound that is not a whole number from 1 to 1 MiB", () => {
  for (const maxEntryBytes of [0, -1, 1.5, 1024 * 1024 + 1, Number.NaN]) {
    assert.throws(() => doSqliteStore(untouched, { maxEntryBytes }), code("invalid_store_options"));
  }
});

test("doLock refuses a lease and renewal it can't keep", () => {
  for (const options of [{ leaseMs: 0 }, { leaseMs: 1_000, renewMs: 1_000 }, { renewMs: -1 }, { leaseMs: Infinity }]) {
    assert.throws(() => doLock(untouched, options), code("invalid_lock_options"));
  }
});

test("doAlarmScheduler refuses a retry delay that is not a whole number of at least 1", () => {
  for (const retryMs of [0, -5, 2.5]) {
    assert.throws(() => doAlarmScheduler(untouched, { retryMs }), code("invalid_scheduler_options"));
  }
});

test("doAlarmScheduler's wake and cancel reject, not throw, when storage fails", async () => {
  let made = false;
  const failing: DurableStorageLike = {
    ...untouched,
    sql: {
      exec: () => {
        if (made) throw new Error("storage is full");
        made = true;
        return { toArray: () => [] };
      },
    },
  };
  const scheduler = doAlarmScheduler(failing);
  const woken = scheduler.wake(new Date(0), "s1");
  const cancelled = scheduler.cancel("s1");
  await assert.rejects(woken, /storage is full/);
  await assert.rejects(cancelled, /storage is full/);
});
