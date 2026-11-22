/**
 * `@buildanagent/agent-safety/stores/postgres`: the effect store and the plan ledger on Postgres, through any client
 * with a `query(text, values)` method that resolves to `{ rows }`, such as `pg`'s `Pool` or `Client` and PGlite. Every
 * change is one statement that Postgres runs atomically (`INSERT … ON CONFLICT`, or an `UPDATE … WHERE` on the
 * attempt), never a read followed by a write, so two processes can't both start one write.
 */
import type { EffectClaim, EffectRecord, EffectStore } from "../effect-store.js";
import type { PlanLedger } from "../plan-approval.js";
import { assertStepIndex } from "../plan-ledger.js";

/** The part of a Postgres client these stores use. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The statements that create the two tables. Run them once, as a migration or at deploy. */
export const POSTGRES_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS effect_records (
    key TEXT PRIMARY KEY,
    attempt INTEGER NOT NULL,
    state TEXT NOT NULL,
    record TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS plan_steps (
    plan_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    PRIMARY KEY (plan_id, step_index)
  )`,
];

/** Creates the two tables if they are not there. */
export async function createPostgresTables(client: PgClientLike): Promise<void> {
  for (const statement of POSTGRES_SCHEMA) await client.query(statement);
}

// The record is stored as the JSON text it was written as, so a read gives back exactly what was stored: a JSONB column
// would reorder an object's keys and normalise its numbers.
function parse(value: unknown): EffectRecord {
  return JSON.parse(String(value)) as EffectRecord;
}

/**
 * An `EffectStore` on Postgres. Each record is one row: its key, the attempt and state that the conditions read, and
 * the record as JSON text. Run `POSTGRES_SCHEMA` first.
 */
export function postgresEffectStore(client: PgClientLike): EffectStore {
  const read = async (key: string): Promise<EffectRecord | undefined> => {
    const { rows } = await client.query("SELECT record FROM effect_records WHERE key = $1", [key]);
    return rows[0] === undefined ? undefined : parse(rows[0].record);
  };
  const lost = async (key: string): Promise<EffectClaim> => {
    const existing = await read(key);
    // A record that vanished between the failed write and this read would mean that another process won and was then
    // deleted, which no store method does. The claim can't be answered, so this throws.
    if (existing === undefined) throw new Error(`the effect record ${key} changed while it was being claimed`);
    return { existing };
  };
  const values = (record: EffectRecord) => [record.key, record.attempt, record.state, JSON.stringify(record)];
  return {
    async begin(record) {
      const { rows } = await client.query(
        `INSERT INTO effect_records (key, attempt, state, record) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING RETURNING key`,
        values(record),
      );
      return rows.length === 1 ? "started" : lost(record.key);
    },
    async takeOver(record) {
      const { rows } = await client.query(
        `INSERT INTO effect_records AS current (key, attempt, state, record) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET attempt = EXCLUDED.attempt, state = EXCLUDED.state, record = EXCLUDED.record
         WHERE current.attempt = EXCLUDED.attempt - 1
         RETURNING key`,
        values(record),
      );
      return rows.length === 1 ? "started" : lost(record.key);
    },
    async settle(record) {
      const { rows } = await client.query(
        `UPDATE effect_records SET state = 'settled', record = $3
         WHERE key = $1 AND state = 'started' AND attempt = $2
         RETURNING key`,
        [record.key, record.attempt, JSON.stringify(record)],
      );
      return rows.length === 1;
    },
    get: read,
  };
}

/**
 * A `PlanLedger` on Postgres. A plan's claimed steps are rows `0` to `n - 1`, so a claim inserts its row only when the
 * row count equals its index, in one statement. Two claims of one step insert the same primary key, and one of them
 * loses, so a step is claimed once.
 */
export function postgresPlanLedger(client: PgClientLike): PlanLedger {
  return Object.freeze({
    async claim(planId: string, stepIndex: number) {
      assertStepIndex(stepIndex);
      const { rows } = await client.query(
        `INSERT INTO plan_steps (plan_id, step_index)
         SELECT $1::text, $2::int WHERE (SELECT count(*) FROM plan_steps WHERE plan_id = $1::text) = $2::int
         ON CONFLICT DO NOTHING RETURNING step_index`,
        [planId, stepIndex],
      );
      if (rows.length === 1) return "claimed" as const;
      const { rows: counted } = await client.query(
        "SELECT count(*)::int AS passed FROM plan_steps WHERE plan_id = $1",
        [planId],
      );
      return stepIndex < Number(counted[0]?.passed ?? 0) ? ("replayed" as const) : ("out_of_order" as const);
    },
  });
}
