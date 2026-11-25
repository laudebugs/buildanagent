// The Vercel target's state seams run the unified portability suite offline: postgresStore(), postgresLock() and the
// wake ledger on PGlite, which is Postgres compiled to WebAssembly and run in this process, so every statement is
// parsed and executed by a real Postgres engine; workflowScheduler() on an in-process stand-in for the Workflow SDK; and
// envKeyStore() on an environment the test supplies. The sandbox, egress and transport seams are N48b's and the
// existing transports', and are not part of this target.
import assert from "node:assert/strict";
import { createPostgresTables, postgresEffectStore } from "@buildanagent/agent-safety/stores/postgres";
import { processScheduler } from "@buildanagent/harness/session";
import {
  type KeyStoreFactory,
  type LockFactory,
  type PortabilityTarget,
  portabilityConformanceCases,
  runPortabilityConformance,
  type SchedulerFactory,
  type StoreFactory,
} from "@buildanagent/harness/testing";
import {
  createPostgresHarnessTables,
  envKeyStore,
  postgresLock,
  postgresStore,
  postgresWakeLedger,
} from "@buildanagent/harness/vercel";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, test } from "vitest";
import { fakeWorkflow } from "./fake-workflow.js";
import { TEST_RING } from "./ring.js";

const START = Date.parse("2026-11-24T00:00:00.000Z");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await createPostgresHarnessTables(db);
  await createPostgresTables(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** The client with every harness table emptied, so each case starts from nothing. */
async function fresh(): Promise<PGlite> {
  await db.query("TRUNCATE harness_session_entries, harness_session_locks, harness_wakes, effect_records, plan_steps");
  return db;
}

const storeFactory: StoreFactory = async () => ({ store: postgresStore(await fresh()) });

const lockFactory: LockFactory = async () => {
  const client = await fresh();
  let time = START;
  const leaseMs = 2_000;
  // Renewal timers never fire, so moving the clock expires the peer's lease cleanly.
  const quiet = processScheduler({ now: () => time, setTimer: () => 0, clearTimer: () => undefined });
  const make = () => postgresLock(client, { leaseMs, renewMs: 1_999, now: () => time, scheduler: quiet });
  return {
    lock: make(),
    lease: {
      peer: make(),
      leaseMs,
      staleness: "lease_only",
      advanceClock: (ms) => {
        time += ms;
      },
    },
  };
};

const schedulerFactory: SchedulerFactory = async () =>
  fakeWorkflow({ ledger: postgresWakeLedger(await fresh()), start: START }).under;

const keyStoreFactory: KeyStoreFactory = () => ({ store: envKeyStore({ env: { HARNESS_KEY_RING: TEST_RING } }) });

const VERCEL_TARGET: PortabilityTarget = {
  store: storeFactory,
  lock: lockFactory,
  scheduler: schedulerFactory,
  keyStore: keyStoreFactory,
  effectStore: async () => postgresEffectStore(await fresh()),
};

describe("the Vercel target passes the portability suite offline", () => {
  test("every case of the store, lock, scheduler, key store and effect store seams passes", async () => {
    const report = await runPortabilityConformance(VERCEL_TARGET);
    assert.deepEqual(report.failed, []);
    // The store has no file to tear, and the key store is read-only, so those cases skip with a reason.
    assert.deepEqual(
      report.skipped.map((entry) => entry.name),
      [
        "store: a torn last line is skipped by load and reported once, with every complete entry kept",
        "store: an append after a torn line cuts it off, so the next entry is not glued to it",
        "keyStore: rotate adds a new current key and keeps the old one",
        "keyStore: prune keeps the current key and every key in use, and returns the ids it removed",
      ],
    );
    assert.equal(report.passed.length, portabilityConformanceCases(VERCEL_TARGET).length - 4);
    const seams = new Set(report.passed.map((name) => name.slice(0, name.indexOf(":"))));
    assert.deepEqual([...seams].sort(), ["effectStore", "keyStore", "lock", "scheduler", "store"]);
  }, 60_000);
});
