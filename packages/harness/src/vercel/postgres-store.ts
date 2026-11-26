/**
 * `postgresStore()`: a `SessionStore` on Postgres, one row per entry. An append is one multi-row `INSERT`, and the
 * primary key on `(user_id, session_id, seq)` makes it the compare-and-swap: two writers that read the same tail both
 * try to write the same `seq`, so Postgres refuses one of them whole. This file imports no Node module.
 */
import { isProtocolError, parseEntry, type SessionEntry } from "@buildanagent/protocol";
import { HarnessError, isHarnessError } from "../errors.js";
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

/** A stored entry through the protocol's parser, so a log in another format is refused as the JSONL store refuses it. */
function parseStored(text: unknown, key: SessionKey, seq: unknown): SessionEntry {
  try {
    return parseEntry(String(text));
  } catch (cause) {
    // A header from another format isn't corruption: the log is whole and needs a migration or a newer harness.
    const format = isProtocolError(cause) && cause.code === "unsupported_format_version";
    throw new HarnessError(
      format ? "unsupported_format" : "session_corrupt",
      `session ${key.sessionId} has ${format ? "a log in a format this harness doesn't read" : "a bad entry"} at seq ${String(seq)}`,
      { cause },
    );
  }
}

/** The part of the log an append reads: where it ends, and the stored entries that share an id with the batch. */
async function stateFor(client: PgClientLike, key: SessionKey, inputs: readonly EntryInput[]): Promise<LogState> {
  // planAppend reads `byId` only for the batch's own ids, so an append costs the batch and not the whole log. The tail
  // and the ids come from one statement, so they share one snapshot: read apart, another writer's append between them
  // could show part of this batch stored while the tail still ends before it.
  const ids = [...new Set(inputs.map((input) => input.id))];
  const marks = ids.map((_, index) => `$${index + 3}`).join(", ");
  const matches =
    ids.length === 0
      ? ""
      : ` UNION ALL (SELECT false, seq, entry_id, entry FROM ${TABLE}
           WHERE user_id = $1 AND session_id = $2 AND entry_id IN (${marks}))`;
  const { rows } = await client.query(
    `(SELECT true AS tail, seq, entry_id, NULL AS entry FROM ${TABLE}
       WHERE user_id = $1 AND session_id = $2 ORDER BY seq DESC LIMIT 1)${matches}`,
    [key.userId, key.sessionId, ...ids],
  );
  const byId = new Map<string, SessionEntry>();
  let last: Record<string, unknown> | undefined;
  for (const row of rows) {
    if (row.tail === true) {
      last = row;
      continue;
    }
    const entry = parse(row.entry);
    byId.set(entry.id, entry);
  }
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
  validate: boolean,
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
    for (const row of rows) yield validate ? parseStored(row.entry, key, row.seq) : parse(row.entry);
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
    const sessionId = String(row.session_id);
    const key = { userId, sessionId };
    try {
      const summary = summaryOf(sessionId, [parseStored(row.header, key, 0), parseStored(row.last, key, row.n)]);
      if (summary !== undefined) found.push({ ...summary, entryCount: toNumber(row.n) });
    } catch (error) {
      // As the JSONL store does, hide a session that can't be read, so one bad row hides no other session.
      if (!isHarnessError(error)) throw error;
    }
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
 * began, a page at a time, and passes each through the protocol's parser: a log written in another format throws a
 * `HarnessError` with code `unsupported_format`, and an entry the parser refuses throws one with code `session_corrupt`.
 * `list()` leaves out a session whose first or last entry can't be read, so one bad session hides no other. The store has no torn lines, because Postgres writes a row whole or not at all, and it offers `loadRaw()`, which reads
 * the same rows unparsed, for a migration.
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
      return entries(client, key, loadOptions, pageSize, true);
    },
    loadRaw(key) {
      checkKey(key);
      return entries(client, key, undefined, pageSize, false);
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
