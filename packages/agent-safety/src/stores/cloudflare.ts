/**
 * `@buildanagent/agent-safety/stores/cloudflare`: the effect store and the plan ledger on a Durable Object's SQLite
 * storage, `ctx.storage.sql`. SQL calls in a Durable Object complete synchronously, and none of the methods below
 * awaits between its statements, so no other event in the object runs between two of them. The SQL still makes every
 * change conditional, so the same code is correct if a host ever lets two callers interleave.
 *
 * A store belongs to one object: give every tenant or session that must keep its own records its own object, or pass
 * records whose keys are already unique across tenants, as `effectKey()` makes them.
 */
import type { EffectClaim, EffectRecord, EffectStore } from "../effect-store.js";
import type { PlanLedger } from "../plan-approval.js";
import { assertStepIndex } from "../plan-ledger.js";
import { lostClaim } from "./lost-claim.js";

/** What a query returns here: the rows, and `RETURNING` makes the written ones count. */
export interface SqlCursorLike {
  toArray(): Record<string, unknown>[];
}

/** The part of `SqlStorage` (`ctx.storage.sql`) these stores use. */
export interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
}

const SCHEMA = [
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

/** Creates the two tables if they are not there, as every store of this module needs; call it once per object. */
export function createCloudflareTables(sql: SqlStorageLike): void {
  for (const statement of SCHEMA) sql.exec(statement);
}

function parse(text: unknown): EffectRecord {
  return JSON.parse(String(text)) as EffectRecord;
}

/**
 * An `EffectStore` on Durable Object SQLite. Each record is one row: its key, the attempt and state that the
 * compare-and-set conditions read, and the record as JSON. Call `createCloudflareTables()` first.
 */
export function durableObjectEffectStore(sql: SqlStorageLike): EffectStore {
  const read = (key: string): EffectRecord | undefined => {
    const [row] = sql.exec("SELECT record FROM effect_records WHERE key = ?", key).toArray();
    return row === undefined ? undefined : parse(row.record);
  };
  const lost = (key: string): EffectClaim => lostClaim(key, read(key));
  return {
    async begin(record) {
      const rows = sql
        .exec(
          `INSERT INTO effect_records (key, attempt, state, record) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO NOTHING RETURNING key`,
          record.key,
          record.attempt,
          record.state,
          JSON.stringify(record),
        )
        .toArray();
      return rows.length === 1 ? "started" : lost(record.key);
    },
    async takeOver(record) {
      const rows = sql
        .exec(
          `INSERT INTO effect_records (key, attempt, state, record) VALUES (?, ?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET attempt = excluded.attempt, state = excluded.state, record = excluded.record
           WHERE effect_records.attempt = excluded.attempt - 1
           RETURNING key`,
          record.key,
          record.attempt,
          record.state,
          JSON.stringify(record),
        )
        .toArray();
      return rows.length === 1 ? "started" : lost(record.key);
    },
    async settle(record) {
      const rows = sql
        .exec(
          `UPDATE effect_records SET state = 'settled', record = ?
           WHERE key = ? AND state = 'started' AND attempt = ?
           RETURNING key`,
          JSON.stringify(record),
          record.key,
          record.attempt,
        )
        .toArray();
      return rows.length === 1;
    },
    async get(key) {
      return read(key);
    },
  };
}

/**
 * A `PlanLedger` on Durable Object SQLite. A plan's claimed steps are rows `0` to `n - 1`, so the next step to claim
 * is the row count, and a claim inserts its row only when the count equals its index. Call `createCloudflareTables()`
 * first.
 */
export function durableObjectPlanLedger(sql: SqlStorageLike): PlanLedger {
  return Object.freeze({
    async claim(planId: string, stepIndex: number) {
      assertStepIndex(stepIndex);
      const [row] = sql.exec("SELECT count(*) AS passed FROM plan_steps WHERE plan_id = ?", planId).toArray();
      const passed = Number(row?.passed ?? 0);
      if (stepIndex < passed) return "replayed" as const;
      if (stepIndex > passed) return "out_of_order" as const;
      sql.exec("INSERT INTO plan_steps (plan_id, step_index) VALUES (?, ?)", planId, stepIndex);
      return "claimed" as const;
    },
  });
}
