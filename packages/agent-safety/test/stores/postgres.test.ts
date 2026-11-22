import {
  createPostgresTables,
  postgresEffectStore,
  postgresPlanLedger,
} from "@buildanagent/agent-safety/stores/postgres";
import { effectStoreConformance, planLedgerConformance } from "@buildanagent/agent-safety/testing";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, test } from "vitest";
import { leaseScenario } from "./scenario.js";

// PGlite is Postgres compiled to WebAssembly and run in this process, so every statement below is parsed and executed
// by a real Postgres engine, offline. It serves one connection, so concurrent calls run one after another; the
// `ON CONFLICT` and `WHERE attempt = …` conditions are what make one of them win, and they are exercised in full.
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await createPostgresTables(db);
}, 60_000);

afterAll(async () => {
  await db.close();
});

/** A store on tables emptied by the test, so each case starts from nothing. */
async function fresh() {
  await db.query("TRUNCATE effect_records, plan_steps");
  return db;
}

for (const conformance of effectStoreConformance()) {
  test(`postgres effect store: ${conformance.name}`, () =>
    conformance.run(async () => postgresEffectStore(await fresh())));
}

for (const conformance of planLedgerConformance()) {
  test(`postgres plan ledger: ${conformance.name}`, () =>
    conformance.run(async () => postgresPlanLedger(await fresh())));
}

test("postgres: a started record is taken over only after its lease lapses", () =>
  leaseScenario(async () => postgresEffectStore(await fresh())));
