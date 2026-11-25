/**
 * `doAlarmScheduler()`: the `Scheduler` seam on a Durable Object's alarm. An object has one alarm, so every pending
 * wake is a row in its SQLite storage and the alarm is set to the earliest one. The object's `alarm()` handler calls
 * the scheduler's `alarm()`, which delivers each wake that has come due and sets the alarm for the next.
 *
 * A wake survives the object leaving memory, because the row and the alarm are both durable. It arrives at least
 * once: Cloudflare runs an alarm at least once, and a wake is deleted only after its handlers return, so an object
 * that fails in the middle of a delivery delivers it again. A handler that throws keeps its wake, which comes back
 * after `retryMs`, so a downstream outage longer than Cloudflare's own six alarm retries still can't lose it.
 */
import { HarnessError } from "../errors.js";
import type { ProcessScheduler, WakeHandler } from "../session/scheduler.js";
import { type DurableStorageLike, integer, type SqlStorageLike, text } from "./storage.js";

const DEFAULT_RETRY_MS = 30_000;

const WAKES_TABLE = `CREATE TABLE IF NOT EXISTS harness_wakes (
  wake_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  due INTEGER NOT NULL,
  PRIMARY KEY (wake_id, at)
)`;

/** The options of `doAlarmScheduler()`. */
export interface DoAlarmSchedulerOptions {
  /** The clock, in milliseconds since the epoch, that decides which wakes are due. Default `Date.now`. */
  readonly now?: () => number;
  /** How long a wake whose handler threw waits before it is delivered again, in milliseconds. Default 30,000. */
  readonly retryMs?: number;
  /** Receives an error a handler threw or rejected with. Default ignores it; the wake is kept and retried either way. */
  readonly onError?: (error: unknown, sessionId: string) => void;
}

/** A `Scheduler` on a Durable Object's alarm, whose `alarm()` the object's own `alarm()` handler calls. */
export interface AlarmScheduler extends ProcessScheduler {
  /**
   * Delivers every wake that is due, one at a time, to the handlers registered with `onWake()`, deletes each wake
   * whose handlers all returned, and sets the object's alarm for the next pending wake. Call it from the Durable
   * Object's `alarm()` method. It never throws for a handler's error, so Cloudflare's limited retries are kept for the
   * object's own failures.
   */
  alarm(): Promise<void>;
}

interface Due {
  readonly id: string;
  readonly at: number;
}

function checkRetry(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RETRY_MS;
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw new HarnessError("invalid_scheduler_options", `retryMs must be a whole number of at least 1, got ${value}`);
}

/** Sets the alarm to the earliest pending wake, or removes it when none is pending. */
function arm(storage: DurableStorageLike): Promise<void> {
  // The earliest time is read and the alarm set in the same synchronous step, so the last call issued always sees
  // every wake written before it.
  const [row] = storage.sql.exec("SELECT MIN(due) AS next FROM harness_wakes").toArray();
  const next = row?.next;
  return typeof next === "number" ? storage.setAlarm(next) : storage.deleteAlarm();
}

function dueWakes(sql: SqlStorageLike, time: number): Due[] {
  return sql
    .exec("SELECT wake_id, at FROM harness_wakes WHERE due <= ? ORDER BY due, at, wake_id", time)
    .toArray()
    .map((row) => ({ id: text(row, "wake_id"), at: integer(row, "at") }));
}

function stillPending(sql: SqlStorageLike, wake: Due): boolean {
  return sql.exec("SELECT 1 FROM harness_wakes WHERE wake_id = ? AND at = ?", wake.id, wake.at).toArray().length > 0;
}

/** Runs every handler for one wake and reports whether all of them returned. */
async function deliver(
  handlers: ReadonlySet<WakeHandler>,
  wake: Due,
  onError: DoAlarmSchedulerOptions["onError"],
): Promise<boolean> {
  let ok = true;
  for (const handler of [...handlers]) {
    try {
      await handler(wake.id, new Date(wake.at));
    } catch (error) {
      ok = false;
      try {
        onError?.(error, wake.id);
      } catch {
        // A reporter that throws must not stop the handlers after it.
      }
    }
  }
  return ok;
}

/**
 * A `Scheduler` on the object's alarm: pass the object's `ctx.storage`, and call the scheduler's `alarm()` from the
 * object's `alarm()` method. It keeps its wakes in its own table and owns the object's one alarm, so nothing else in
 * the object may call `setAlarm()`; share one scheduler for every wake the object needs, prefixing ids by purpose.
 *
 * `wake(at, id)` stores the wake and sets the alarm to the earliest one; asking twice for the same id and time is one
 * wake, and a time in the past is due at once. `cancel(id)` removes every pending wake of `id`. A wake is delivered
 * with the time it was asked for, never before that time by `now`, and at least once. The alarm handler runs for at
 * most 15 minutes, so a handler should do one step of work and ask for another wake rather than run a long turn.
 *
 * A due wake goes to the handlers registered when `alarm()` runs, and once they return it is deleted, even when none is
 * registered. After an eviction the object's constructor runs before `alarm()`, so register every handler whose wakes
 * must survive an eviction there, not when a session is opened. A lock's renewal wakes need no handler after an
 * eviction, because the hold they renewed left memory with the object.
 */
export function doAlarmScheduler(storage: DurableStorageLike, options: DoAlarmSchedulerOptions = {}): AlarmScheduler {
  const now = options.now ?? Date.now;
  const retryMs = checkRetry(options.retryMs);
  const handlers = new Set<WakeHandler>();
  const { sql } = storage;
  sql.exec(WAKES_TABLE);
  return {
    // Both are async so that a storage error rejects the promise the `Scheduler` contract returns instead of throwing.
    async wake(at, sessionId) {
      const time = at.getTime();
      if (Number.isNaN(time)) throw new TypeError("Scheduler.wake needs a valid date.");
      sql.exec("INSERT OR IGNORE INTO harness_wakes (wake_id, at, due) VALUES (?, ?, ?)", sessionId, time, time);
      return arm(storage);
    },
    async cancel(sessionId) {
      sql.exec("DELETE FROM harness_wakes WHERE wake_id = ?", sessionId);
      return arm(storage);
    },
    now,
    onWake(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    async alarm() {
      for (const wake of dueWakes(sql, now())) {
        // An earlier handler in this run may have cancelled this wake, and a cancelled wake must not be delivered.
        if (!stillPending(sql, wake)) continue;
        const ok = await deliver(handlers, wake, options.onError);
        // A wake cancelled during its delivery is already gone, and neither statement brings it back.
        if (ok) sql.exec("DELETE FROM harness_wakes WHERE wake_id = ? AND at = ?", wake.id, wake.at);
        else
          sql.exec("UPDATE harness_wakes SET due = ? WHERE wake_id = ? AND at = ?", now() + retryMs, wake.id, wake.at);
      }
      await arm(storage);
    },
  };
}
