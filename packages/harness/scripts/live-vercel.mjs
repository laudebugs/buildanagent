// The opt-in live run of the Vercel state adapters against a real Postgres database, such as the Neon database a
// Vercel project gets from the Marketplace. It runs the portability suite's store, lock and key store cases, a lease
// that lapses on the database's own clock, and the wake ledger. It never runs in CI or in `pnpm test`.
//
//   pnpm --filter "@buildanagent/harness..." build
//   HARNESS_LIVE_VERCEL=1 DATABASE_URL=<unpooled connection string> pnpm --filter @buildanagent/harness live:vercel
//
// It reads DATABASE_URL only to connect, and never prints it. Every table it makes lives in a schema of its own,
// harness_live_<random>, which it drops at the end. The key store case uses a ring made here, not your real one. Use
// the unpooled connection string: the script refuses a connection whose search path is not its own schema, which is
// what a transaction pooler's connection can turn into.
import { randomBytes } from "node:crypto";
import process from "node:process";
import { createPostgresTables, postgresEffectStore } from "@buildanagent/agent-safety/stores/postgres";
import { runPortabilityConformance } from "@buildanagent/harness/testing";
import {
  createPostgresHarnessTables,
  envKeyStore,
  postgresLock,
  postgresStore,
  postgresWakeLedger,
} from "@buildanagent/harness/vercel";
import pg from "pg";

const LEASE_MS = 2_000;

if (process.env.HARNESS_LIVE_VERCEL !== "1") {
  console.log("Skipped: set HARNESS_LIVE_VERCEL=1 and DATABASE_URL to run the live Vercel check.");
  process.exit(0);
}
const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString === "") {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schema = `harness_live_${randomBytes(6).toString("hex")}`;
// Each connection starts in the run's own schema, set as a startup option rather than by a later SET whose failure
// could pass unseen, so the run never touches the harness's real tables in the default schema.
const pool = new pg.Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
// A pg error names the statement or the host it could not reach, never the password, so it is safe to print.
const fail = (error) => {
  console.error(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
};

const TABLES = ["harness_session_entries", "harness_session_locks", "harness_wakes", "effect_records", "plan_steps"];

/** Throws unless the connection the pool hands out next works in the run's own schema. */
async function checkSchema() {
  const { rows } = await pool.query("SELECT current_schema() AS name");
  if (rows[0]?.name !== schema) throw new Error("a connection is not in the run's own schema, so the run stopped");
}

async function fresh() {
  await checkSchema();
  // Every table is named with the run's schema, so a connection that lost its search path still empties only the run's.
  await pool.query(`TRUNCATE ${TABLES.map((table) => `${schema}.${table}`).join(", ")}`);
  return pool;
}

async function leaseLapsesOnTheDatabaseClock() {
  const key = { userId: "live", sessionId: "lease" };
  const quiet = { now: Date.now, wake: async () => undefined, cancel: async () => undefined, onWake: () => () => {} };
  const first = await postgresLock(pool, { leaseMs: LEASE_MS, renewMs: LEASE_MS - 1, scheduler: quiet }).acquire(key);
  if (first === "would_block") throw new Error("the first acquire was refused");
  const peer = postgresLock(pool, { leaseMs: LEASE_MS, renewMs: LEASE_MS - 1, scheduler: quiet });
  if ((await peer.acquire(key)) !== "would_block") throw new Error("a live lease was taken");
  await new Promise((done) => setTimeout(done, LEASE_MS + 500));
  const taker = await peer.acquire(key);
  if (taker === "would_block") throw new Error("a lapsed lease was not taken over");
  if (!(taker.fence > first.fence)) throw new Error("the fence did not grow on takeover");
  await taker.release();
}

async function ledgerRoundTrip() {
  const ledger = postgresWakeLedger(await fresh());
  const nonce = await ledger.add("live", 1_000);
  if ((await ledger.add("live", 1_000)) !== nonce) throw new Error("a pending wake asked for again got a new nonce");
  await ledger.add("live", 2_000);
  const removed = (await ledger.removeAll("live")).map(({ at }) => at).sort((a, b) => a - b);
  if (removed.join() !== "1000,2000") throw new Error(`the ledger removed ${removed.join()}`);
}

try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  await checkSchema();
  await createPostgresHarnessTables(pool);
  await createPostgresTables(pool);
  let time = Date.now();
  const ring = JSON.stringify({ current: "live", keys: { live: randomBytes(32).toString("base64url") } });
  const quiet = { now: () => time, wake: async () => undefined, cancel: async () => undefined, onWake: () => () => {} };
  const report = await runPortabilityConformance({
    store: async () => ({ store: postgresStore(await fresh()) }),
    lock: async () => {
      const client = await fresh();
      const make = () => postgresLock(client, { leaseMs: LEASE_MS, renewMs: 1, now: () => time, scheduler: quiet });
      return {
        lock: make(),
        lease: { peer: make(), leaseMs: LEASE_MS, staleness: "lease_only", advanceClock: (ms) => (time += ms) },
      };
    },
    keyStore: () => ({ store: envKeyStore({ env: { HARNESS_KEY_RING: ring } }) }),
    effectStore: async () => postgresEffectStore(await fresh()),
  });
  console.log(`Passed ${report.passed.length}, skipped ${report.skipped.length}, failed ${report.failed.length}.`);
  for (const { name, error } of report.failed) console.error(`Failed: ${name}: ${error}`);
  if (report.failed.length > 0) process.exitCode = 1;
  await leaseLapsesOnTheDatabaseClock().then(() => console.log("Passed: a lease lapses on the database clock."), fail);
  await ledgerRoundTrip().then(() => console.log("Passed: the wake ledger round trip."), fail);
} catch (error) {
  fail(error);
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(fail);
  await pool.end();
}
