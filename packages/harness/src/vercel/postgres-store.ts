/**
 * `postgresStore()`: a `SessionStore` on Postgres, one row per entry. An append is one multi-row `INSERT`, and the
 * primary key on `(user_id, session_id, seq)` makes it the compare-and-swap: two writers that read the same tail both
 * try to write the same `seq`, so Postgres refuses one of them whole. This file imports no Node module.
 */
import type { SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import { ConflictError } from "../session/errors.js";
import {
  type AppendOptions,
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  type EntryInput,
  type LoadOptions,
  type LogState,
  planAppend,
  type SessionKey,
  type SessionStore,
  type SessionSummary,
  summaryOf,
} from "../session/store.js";
import { isUniqueViolation, type PgClientLike, toNumber } from "./postgres-schema.js";

/** The options of `postgresStore()`. */
export interface PostgresStoreOptions {
  /** The bound on one entry's JSON, in bytes. Default 64 KiB. */
  readonly maxEntryBytes?: number;
  /** How many rows one `load()` query reads before it asks for the next page. Default 256. */
  readonly pageSize?: number;
}

// A writer that keeps losing the race for the next seq gives up after this many tries, with a ConflictError.
const MAX_ATTEMPTS = 5;
const DEFAULT_PAGE_SIZE = 256;

const TABLE = "harness_session_entries";

function parse(text: unknown): SessionEntry {
  return JSON.parse(String(text)) as SessionEntry;
}

/** The part of the log an append reads: where it ends, and the stored entries that share an id with the batch. */
async function stateFor(client: PgClientLike, key: SessionKey, inputs: readonly EntryInput[]): Promise<LogState> {
  const tail = await client.query(
    `SELECT seq, entry_id FROM ${TABLE} WHERE user_id = $1 AND session_id = $2 ORDER BY seq DESC LIMIT 1`,
    [key.userId, key.sessionId],
  );
  const byId = new Map<string, SessionEntry>();
  const ids = [...new Set(inputs.map((input) => input.id))];
  if (ids.length > 0) {
    // planAppend reads `byId` only for the batch's own ids, so an append costs the batch and not the whole log.
    const marks = ids.map((_, index) => `$${index + 3}`).join(", ");
    const { rows } = await client.query(
      `SELECT entry FROM ${TABLE} WHERE user_id = $1 AND session_id = $2 AND entry_id IN (${marks})`,
      [key.userId, key.sessionId, ...ids],
    );
    for (const row of rows) {
      const entry = parse(row.entry);
      byId.set(entry.id, entry);
    }
  }
  const last = tail.rows[0];
  return {
    byId,
    lastId: last === undefined ? null : String(last.entry_id),
    lastSeq: last === undefined ? -1 : toNumber(last.seq),
  };
}

async function insert(client: PgClientLike, key: SessionKey, fresh: readonly SessionEntry[]): Promise<void> {
  const values: unknown[] = [key.userId, key.sessionId];
  const rows = fresh.map((entry) => {
    values.push(entry.seq, entry.id, JSON.stringify(entry));
    const at = values.length;
    return `($1, $2, $${at - 2}, $${at - 1}, $${at})`;
  });
  await client.query(
    `INSERT INTO ${TABLE} (user_id, session_id, seq, entry_id, entry) VALUES ${rows.join(", ")}`,
    values,
  );
}

async function append(
  client: PgClientLike,
  key: SessionKey,
  inputs: readonly EntryInput[],
  options: AppendOptions | undefined,
  maxBytes: number,
): Promise<SessionEntry[]> {
  checkKey(key);
  for (let attempt = 1; ; attempt += 1) {
    // Each attempt plans again from what is stored now, so a retry after a lost race applies every rule afresh: a
    // stale expectedLastId conflicts, and a batch another writer stored meanwhile comes back as stored.
    const plan = planAppend(await stateFor(client, key, inputs), inputs, options, maxBytes);
    if (plan.fresh.length === 0) return plan.result;
    try {
      await insert(client, key, plan.fresh);
      return plan.result;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      if (attempt >= MAX_ATTEMPTS) {
        throw new ConflictError(`another writer kept extending the session, so ${MAX_ATTEMPTS} appends lost the race`);
      }
    }
  }
}

async function* entries(
  client: PgClientLike,
  key: SessionKey,
  options: LoadOptions | undefined,
  pageSize: number,
): AsyncGenerator<SessionEntry> {
  // The last seq when the load began bounds every page, so an append made while a caller iterates doesn't extend it.
  const { rows: top } = await client.query(
    `SELECT MAX(seq) AS last FROM ${TABLE} WHERE user_id = $1 AND session_id = $2`,
    [key.userId, key.sessionId],
  );
  const last = top[0]?.last;
  if (last === null || last === undefined) return;
  const end = toNumber(last);
  let from = options?.fromSeq ?? 0;
  while (from <= end) {
    const { rows } = await client.query(
      `SELECT seq, entry FROM ${TABLE} WHERE user_id = $1 AND session_id = $2 AND seq >= $3 AND seq <= $4
       ORDER BY seq LIMIT $5`,
      [key.userId, key.sessionId, from, end, pageSize],
    );
    for (const row of rows) yield parse(row.entry);
    const lastRow = rows.at(-1);
    if (rows.length < pageSize || lastRow === undefined) return;
    from = toNumber(lastRow.seq) + 1;
  }
}

async function* summaries(client: PgClientLike, userId: string): AsyncGenerator<SessionSummary> {
  const { rows } = await client.query(
    `SELECT s.session_id, s.n, h.entry AS header, l.entry AS last
     FROM (SELECT session_id, MIN(seq) AS first_seq, MAX(seq) AS last_seq, COUNT(*) AS n
           FROM ${TABLE} WHERE user_id = $1 GROUP BY session_id) s
     JOIN ${TABLE} h ON h.user_id = $1 AND h.session_id = s.session_id AND h.seq = s.first_seq
     JOIN ${TABLE} l ON l.user_id = $1 AND l.session_id = s.session_id AND l.seq = s.last_seq`,
    [userId],
  );
  const found: SessionSummary[] = [];
  for (const row of rows) {
    const summary = summaryOf(String(row.session_id), [parse(row.header), parse(row.last)]);
    if (summary !== undefined) found.push({ ...summary, entryCount: toNumber(row.n) });
  }
  yield* found.sort(byAge);
}

/**
 * A `SessionStore` on Postgres, through any client with a `query(text, values)` method that resolves to `{ rows }`,
 * such as `pg`'s `Pool`, Neon's serverless `Pool` or PGlite. Run `POSTGRES_HARNESS_SCHEMA` first.
 *
 * Each entry is one row, keyed by user, session and `seq`, holding the entry as the JSON text it was written as. An
 * append reads the log's tail and the stored entries that share an id with the batch, applies the store's rules, and
 * writes the new entries in one `INSERT`. When another writer took the next `seq` first, Postgres refuses the whole
 * `INSERT` and the append plans again, so it never writes part of a batch. A load reads the entries present when it
 * began, a page at a time. The store has no torn lines, because Postgres writes a row whole or not at all, and it
 * offers `loadRaw()`, which reads the same rows.
 */
export function postgresStore(client: PgClientLike, options: PostgresStoreOptions = {}): SessionStore {
  const maxBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new HarnessError("invalid_store_options", "postgresStore() needs a whole pageSize of 1 or more");
  }
  return {
    append: (key, inputs, appendOptions) => append(client, key, inputs, appendOptions, maxBytes),
    load(key, loadOptions) {
      checkKey(key);
      return entries(client, key, loadOptions, pageSize);
    },
    loadRaw(key) {
      checkKey(key);
      return entries(client, key, undefined, pageSize);
    },
    list(userId) {
      checkKey({ userId, sessionId: "-" });
      return summaries(client, userId);
    },
    async delete(key) {
      checkKey(key);
      await client.query(`DELETE FROM ${TABLE} WHERE user_id = $1 AND session_id = $2`, [key.userId, key.sessionId]);
    },
  };
}
