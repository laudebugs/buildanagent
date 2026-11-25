/**
 * The tables behind the Postgres session store, lock and wake ledger. Every statement the three run is one statement
 * that Postgres runs atomically, so they need no transaction and work through a pooled client, where two calls may use
 * two connections.
 */
import type { PgClientLike } from "@buildanagent/agent-safety/stores/postgres";

export type { PgClientLike } from "@buildanagent/agent-safety/stores/postgres";

/**
 * The statements that create the harness's three tables: `harness_session_entries` (one row per entry),
 * `harness_session_locks` (one lease row per session) and `harness_wakes` (one row per pending wake). Run them once,
 * as a migration or at deploy, or call `createPostgresHarnessTables()`.
 */
export const POSTGRES_HARNESS_SCHEMA: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS harness_session_entries (
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    entry_id TEXT NOT NULL,
    entry TEXT NOT NULL,
    PRIMARY KEY (user_id, session_id, seq),
    UNIQUE (user_id, session_id, entry_id)
  )`,
  `CREATE TABLE IF NOT EXISTS harness_session_locks (
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    token TEXT NOT NULL,
    fence BIGINT NOT NULL,
    expires_at_ms BIGINT NOT NULL,
    PRIMARY KEY (user_id, session_id)
  )`,
  `CREATE TABLE IF NOT EXISTS harness_wakes (
    session_id TEXT NOT NULL,
    at_ms BIGINT NOT NULL,
    PRIMARY KEY (session_id, at_ms)
  )`,
];

/** Creates the three tables of `POSTGRES_HARNESS_SCHEMA` where they are missing. */
export async function createPostgresHarnessTables(client: PgClientLike): Promise<void> {
  for (const statement of POSTGRES_HARNESS_SCHEMA) await client.query(statement);
}

/** Whether a client's error is Postgres's unique violation, SQLSTATE 23505, which `pg`, Neon and PGlite all report. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23505";
}

/** A `BIGINT` column as a number: `pg` returns one as a string, and PGlite as a number. */
export function toNumber(value: unknown): number {
  return Number(value);
}
