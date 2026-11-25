/**
 * `doLock()`: the Durable Object as a session's single writer. A hold is one row in the object's SQLite storage, with
 * a random token and a lease, and a lapsed lease is the only sign that a holder is gone: an object has no process id
 * to check, and the instance that held the lock may have left memory with its timers.
 *
 * Exclusivity rests on two things. A Durable Object runs one event at a time, and `acquire()` runs its single
 * conditional statement with no `await` before it, so no other request in the object can run between the check and
 * the write. The statement itself is also conditional, an insert that takes over only a lapsed lease, so two holds
 * can't both win even if a host ever let two callers interleave.
 */
import { HarnessError } from "../errors.js";
import type { LockHandle, SessionLock } from "../session/lock.js";
import { type ProcessScheduler, processScheduler } from "../session/scheduler.js";
import { checkKey, type SessionKey } from "../session/store.js";
import { integer, type SqlDurableStorageLike, type SqlStorageLike, text } from "./storage.js";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;
const MAX_TIMER_MS = 2_147_483_647;

const LOCKS_TABLE = `CREATE TABLE IF NOT EXISTS harness_session_locks (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  token TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_id)
)`;

/** The options of `doLock()`. */
export interface DoLockOptions {
  /** How long a hold lasts without a renewal, in milliseconds. Default 30,000. */
  readonly leaseMs?: number;
  /** How often a hold renews its lease, in milliseconds; below `leaseMs`. Default 10,000, or a third of the lease. */
  readonly renewMs?: number;
  /** The clock, in milliseconds since the epoch. Default `Date.now`. */
  readonly now?: () => number;
  /**
   * What wakes a hold to renew its lease. Default: a scheduler of this lock's own, on timers, which keep the object in
   * memory while a turn holds the lock. Each renewal's id starts with `lease:`, so a shared scheduler's other wakes
   * don't clash with it.
   */
  readonly scheduler?: ProcessScheduler;
}

interface Settings {
  readonly sql: SqlStorageLike;
  readonly leaseMs: number;
  readonly renewMs: number;
  readonly now: () => number;
  readonly scheduler: ProcessScheduler;
}

function settingsOf(storage: SqlDurableStorageLike, options: DoLockOptions): Settings {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const renewMs = options.renewMs ?? Math.min(DEFAULT_RENEW_MS, leaseMs / 3);
  const ok = Number.isFinite(leaseMs) && leaseMs > 0 && Number.isFinite(renewMs) && renewMs > 0 && renewMs < leaseMs;
  if (!ok || renewMs > MAX_TIMER_MS) {
    throw new HarnessError(
      "invalid_lock_options",
      `doLock() needs a finite leaseMs above 0 and a renewMs above 0, below the lease and at most ${MAX_TIMER_MS}`,
    );
  }
  return {
    sql: storage.sql,
    leaseMs,
    renewMs,
    now: options.now ?? Date.now,
    scheduler: options.scheduler ?? processScheduler(),
  };
}

/** Whether `token` holds the session's row now, with a lease that has not lapsed. */
function holds(settings: Settings, key: SessionKey, token: string): boolean {
  const [row] = settings.sql
    .exec(
      "SELECT token, lease_until FROM harness_session_locks WHERE user_id = ? AND session_id = ?",
      key.userId,
      key.sessionId,
    )
    .toArray();
  return row !== undefined && text(row, "token") === token && integer(row, "lease_until") >= settings.now();
}

class Hold implements LockHandle {
  readonly token: string;
  readonly #key: SessionKey;
  readonly #settings: Settings;
  readonly #wakeId: string;
  readonly #stopListening: () => void;
  #held = true;
  // The time of the renewal this hold waits for; a duplicate of a delivered wake carries an older time.
  #armedAt = 0;

  constructor(key: SessionKey, token: string, settings: Settings) {
    this.token = token;
    this.#key = key;
    this.#settings = settings;
    this.#wakeId = `lease:${JSON.stringify([key.userId, key.sessionId])}/${token}`;
    this.#stopListening = settings.scheduler.onWake((id, at) => {
      if (id !== this.#wakeId || at.getTime() !== this.#armedAt || !this.#held) return;
      this.#renew();
      if (this.#held) this.#arm();
    });
    this.#arm();
  }

  #arm(): void {
    const { scheduler, renewMs } = this.#settings;
    const at = new Date(Math.max(scheduler.now() + renewMs, this.#armedAt + 1));
    this.#armedAt = at.getTime();
    // A scheduler that refuses the wake leaves no renewal coming, so the hold reports itself lost and the writer stops.
    scheduler.wake(at, this.#wakeId).catch(() => this.#lose());
  }

  /** Extends the lease, only while this hold's token still holds it unlapsed. Any other outcome ends the hold. */
  #renew(): void {
    const { sql, now, leaseMs } = this.#settings;
    const time = now();
    const renewed = sql
      .exec(
        `UPDATE harness_session_locks SET lease_until = ?
         WHERE user_id = ? AND session_id = ? AND token = ? AND lease_until >= ? RETURNING token`,
        time + leaseMs,
        this.#key.userId,
        this.#key.sessionId,
        this.token,
        time,
      )
      .toArray();
    if (renewed.length === 0) this.#lose();
  }

  held(): boolean {
    if (this.#held && !holds(this.#settings, this.#key, this.token)) this.#lose();
    return this.#held;
  }

  #lose(): void {
    if (!this.#held) return;
    this.#held = false;
    this.#stopListening();
    this.#settings.scheduler.cancel(this.#wakeId).catch(() => undefined);
  }

  async release(): Promise<void> {
    this.#lose();
    // Deleting by token never frees a hold that took over after this one's lease lapsed.
    this.#settings.sql.exec(
      "DELETE FROM harness_session_locks WHERE user_id = ? AND session_id = ? AND token = ?",
      this.#key.userId,
      this.#key.sessionId,
      this.token,
    );
  }
}

/**
 * A `SessionLock` in a Durable Object's SQLite storage: pass the object's `ctx.storage`. `acquire()` gives a hold, or
 * `"would_block"` at once while another hold's lease has not lapsed; it never waits. A hold renews its lease every
 * `renewMs` through `scheduler`, and once the lease lapses, because the object left memory mid-turn or a renewal
 * found another token, the next `acquire()` takes the session over and `held()` turns `false` for the old hold.
 *
 * Every lock built over the same storage shares its rows, so two dispatchers in one object, or two objects that share
 * nothing, can't both write a session that one storage holds. Options out of range throw a `HarnessError`, code
 * `invalid_lock_options`; a key that is not a valid session key rejects with code `invalid_session_key`.
 */
export function doLock(storage: SqlDurableStorageLike, options: DoLockOptions = {}): SessionLock {
  const settings = settingsOf(storage, options);
  settings.sql.exec(LOCKS_TABLE);
  return {
    async acquire(key) {
      checkKey(key);
      const time = settings.now();
      const token = crypto.randomUUID();
      // One statement: insert a hold, or take over one whose lease has lapsed. RETURNING tells which happened.
      const won = settings.sql
        .exec(
          `INSERT INTO harness_session_locks (user_id, session_id, token, lease_until) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, session_id) DO UPDATE SET token = excluded.token, lease_until = excluded.lease_until
           WHERE harness_session_locks.lease_until < ?
           RETURNING token`,
          key.userId,
          key.sessionId,
          token,
          time + settings.leaseMs,
          time,
        )
        .toArray();
      return won.length === 1 ? new Hold(key, token, settings) : "would_block";
    },
  };
}
