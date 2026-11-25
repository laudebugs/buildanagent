/**
 * `doSqliteStore()` and `doSqliteIndex()`: the session log and its pointer index in a Durable Object's SQLite storage.
 * Each entry is one row, keyed by user, session and `seq`, with its id unique within the session. The append rules
 * are `planAppend()`'s, as for every other store, and an append reads only the rows its batch names and the log's
 * last row, so it costs the batch and not the log.
 *
 * SQL calls in a Durable Object complete synchronously, and an append runs its reads, its checks and its writes in one
 * `transactionSync()` with no `await` inside, so no other request in the object runs between them and a failed append
 * writes nothing.
 */
import { parseEntry, type SessionEntry } from "@buildanagent/protocol";
import { HarnessError } from "../errors.js";
import type { SessionIndex } from "../session/pointer.js";
import {
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  type LoadOptions,
  type LogState,
  planAppend,
  type SessionKey,
  type SessionStore,
  type SessionSummary,
  summaryFromEnds,
} from "../session/store.js";
import { integer, type SqlDurableStorageLike, type SqlStorageLike, text } from "./storage.js";

/** The largest entry bound the store accepts: well under the 8 MB a Durable Object's SQLite row can hold. */
const MAX_ENTRY_BOUND = 1024 * 1024;
/** How many rows one read of `load()` takes, so a long log is never held in memory whole. */
const PAGE_ROWS = 256;

const ENTRIES_TABLE = `CREATE TABLE IF NOT EXISTS harness_session_entries (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  entry_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id, seq),
  UNIQUE (user_id, session_id, entry_id)
)`;

const POINTERS_TABLE = `CREATE TABLE IF NOT EXISTS harness_session_pointers (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  file TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
)`;

/** The options of `doSqliteStore()`. */
export interface DoSqliteStoreOptions {
  /** The bound on one entry's JSON, in bytes. Default 64 KiB, at most 1 MiB. */
  readonly maxEntryBytes?: number;
}

function checkBound(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRY_BYTES;
  if (Number.isSafeInteger(value) && value > 0 && value <= MAX_ENTRY_BOUND) return value;
  throw new HarnessError(
    "invalid_store_options",
    `maxEntryBytes must be a whole number from 1 to ${MAX_ENTRY_BOUND}, got ${String(value)}`,
  );
}

/** A stored entry, parsed back through the protocol's own parser, so `load()` checks the format as other stores do. */
function parsed(json: string): SessionEntry {
  try {
    return parseEntry(JSON.parse(json));
  } catch (cause) {
    throw new HarnessError("session_corrupt", "a stored session entry is not a valid entry", { cause });
  }
}

/** The log as `planAppend()` needs it for one batch: the stored entries the batch names, and the log's last row. */
function stateFor(sql: SqlStorageLike, key: SessionKey, ids: readonly string[]): LogState {
  const byId = new Map<string, SessionEntry>();
  for (const id of new Set(ids)) {
    const [row] = sql
      .exec(
        "SELECT entry FROM harness_session_entries WHERE user_id = ? AND session_id = ? AND entry_id = ?",
        key.userId,
        key.sessionId,
        id,
      )
      .toArray();
    if (row !== undefined) byId.set(id, parsed(text(row, "entry")));
  }
  const [last] = sql
    .exec(
      "SELECT entry_id, seq FROM harness_session_entries WHERE user_id = ? AND session_id = ? ORDER BY seq DESC LIMIT 1",
      key.userId,
      key.sessionId,
    )
    .toArray();
  return {
    byId,
    lastId: last === undefined ? null : text(last, "entry_id"),
    lastSeq: last === undefined ? -1 : integer(last, "seq"),
  };
}

/** The rows of a session from `fromSeq` to `toSeq`, a page at a time, each yielded through `read`. */
async function* rowsOf<T>(
  sql: SqlStorageLike,
  key: SessionKey,
  fromSeq: number,
  read: (json: string) => T,
): AsyncGenerator<T> {
  // The end is fixed when the iteration begins, so an append made while a caller iterates doesn't extend the loop.
  const [end] = sql
    .exec(
      "SELECT MAX(seq) AS last FROM harness_session_entries WHERE user_id = ? AND session_id = ?",
      key.userId,
      key.sessionId,
    )
    .toArray();
  const toSeq = typeof end?.last === "number" ? end.last : -1;
  let next = fromSeq;
  while (next <= toSeq) {
    const rows = sql
      .exec(
        `SELECT seq, entry FROM harness_session_entries
         WHERE user_id = ? AND session_id = ? AND seq >= ? AND seq <= ? ORDER BY seq LIMIT ?`,
        key.userId,
        key.sessionId,
        next,
        toSeq,
        PAGE_ROWS,
      )
      .toArray();
    if (rows.length === 0) return;
    for (const row of rows) yield read(text(row, "entry"));
    next = integer(rows.at(-1), "seq") + 1;
  }
}

function entryAt(sql: SqlStorageLike, userId: string, sessionId: string, seq: number): SessionEntry | undefined {
  const [row] = sql
    .exec(
      "SELECT entry FROM harness_session_entries WHERE user_id = ? AND session_id = ? AND seq = ?",
      userId,
      sessionId,
      seq,
    )
    .toArray();
  return row === undefined ? undefined : parsed(text(row, "entry"));
}

async function* summariesOf(sql: SqlStorageLike, userId: string): AsyncGenerator<SessionSummary> {
  const sessions = sql
    .exec(
      `SELECT session_id, COUNT(*) AS entries, MIN(seq) AS first, MAX(seq) AS last FROM harness_session_entries
       WHERE user_id = ? GROUP BY session_id`,
      userId,
    )
    .toArray();
  const found: SessionSummary[] = [];
  for (const row of sessions) {
    const sessionId = text(row, "session_id");
    const header = entryAt(sql, userId, sessionId, integer(row, "first"));
    const last = entryAt(sql, userId, sessionId, integer(row, "last"));
    const summary = summaryFromEnds(sessionId, header, last, integer(row, "entries"));
    if (summary !== undefined) found.push(summary);
  }
  yield* found.sort(byAge);
}

/**
 * A `SessionStore` in a Durable Object's SQLite storage: pass the object's `ctx.storage`. It follows every rule of the
 * interface and creates its table when it is made, so make it where the object's storage is ready, such as the
 * object's constructor. One object can hold many users' sessions, and a session under another
 * user looks like one that was never created; most hosts still give each session, or each user, an object of its own,
 * so the object is also the session's single writer.
 *
 * Entries are rows, so no write can be torn and `load()` never reports a torn line. A loaded entry goes back through
 * the protocol's parser, and a row that fails it throws a `HarnessError`, code `session_corrupt`. An entry over
 * `maxEntryBytes` throws an `EntryTooLargeError`. A `maxEntryBytes` that is not a whole number from 1 to 1 MiB
 * throws a `HarnessError`, code `invalid_store_options`.
 */
export function doSqliteStore(storage: SqlDurableStorageLike, options: DoSqliteStoreOptions = {}): SessionStore {
  const maxBytes = checkBound(options.maxEntryBytes);
  const { sql } = storage;
  sql.exec(ENTRIES_TABLE);
  return {
    async append(key, inputs, appendOptions) {
      checkKey(key);
      return storage.transactionSync(() => {
        const state = stateFor(
          sql,
          key,
          inputs.map((input) => input.id),
        );
        const plan = planAppend(state, inputs, appendOptions, maxBytes);
        for (const entry of plan.fresh) {
          sql.exec(
            "INSERT INTO harness_session_entries (user_id, session_id, seq, entry_id, entry) VALUES (?, ?, ?, ?, ?)",
            key.userId,
            key.sessionId,
            entry.seq,
            entry.id,
            JSON.stringify(entry),
          );
        }
        return structuredClone(plan.result);
      });
    },
    load(key, loadOptions?: LoadOptions) {
      checkKey(key);
      return rowsOf(sql, key, loadOptions?.fromSeq ?? 0, parsed);
    },
    loadRaw(key) {
      checkKey(key);
      return rowsOf(sql, key, 0, (json): unknown => JSON.parse(json));
    },
    list(userId) {
      checkKey({ userId, sessionId: "-" });
      return summariesOf(sql, userId);
    },
    async delete(key) {
      checkKey(key);
      sql.exec("DELETE FROM harness_session_entries WHERE user_id = ? AND session_id = ?", key.userId, key.sessionId);
    },
  };
}

/**
 * A `SessionIndex` in a Durable Object's SQLite storage, beside `doSqliteStore()`, so a session's pointer survives the
 * object leaving memory as its entries do. Setting a pointer is one statement, so it is atomic.
 */
export function doSqliteIndex(storage: SqlDurableStorageLike): SessionIndex {
  const { sql } = storage;
  sql.exec(POINTERS_TABLE);
  return {
    async get(key) {
      checkKey(key);
      const [row] = sql
        .exec(
          "SELECT file FROM harness_session_pointers WHERE user_id = ? AND session_id = ?",
          key.userId,
          key.sessionId,
        )
        .toArray();
      return row === undefined ? undefined : text(row, "file");
    },
    async set(key, file) {
      checkKey(key);
      sql.exec(
        `INSERT INTO harness_session_pointers (user_id, session_id, file) VALUES (?, ?, ?)
         ON CONFLICT (user_id, session_id) DO UPDATE SET file = excluded.file`,
        key.userId,
        key.sessionId,
        file,
      );
    },
  };
}
