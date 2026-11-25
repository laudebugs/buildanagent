/**
 * `postgresLock()`: a `SessionLock` on a Postgres lease row. Acquiring, renewing and releasing are each one statement,
 * and the row's primary key makes acquiring an atomic set-if-absent-or-lapsed. Only a lapsed lease marks a lock stale,
 * because no host can check whether another host's process still runs. This file imports no Node module.
 */
import { HarnessError } from "../errors.js";
import { LeaseRenewals, leaseId } from "../session/lease-renewals.js";
import type { LockHandle, SessionLock } from "../session/lock.js";
import { type ProcessScheduler, processScheduler } from "../session/scheduler.js";
import { checkKey, type SessionKey } from "../session/store.js";
import { type PgClientLike, toNumber } from "./postgres-schema.js";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;
const MAX_TIMER_MS = 2 ** 31 - 1;
const TABLE = "harness_session_locks";

/** The options of `postgresLock()`. */
export interface PostgresLockOptions {
  /** How long a lock lasts without a renewal. Default 30 seconds. */
  readonly leaseMs?: number;
  /** How often the holder renews. Default 10 seconds or a third of the lease, whichever is less. It must be shorter than the lease. */
  readonly renewMs?: number;
  /**
   * The clock, in milliseconds since the epoch, for tests. By default the lease's start and end come from the
   * database's own clock, so every writer reads one clock, and a holder times its own lease on a monotonic local clock.
   * A clock passed here replaces both.
   */
  readonly now?: () => number;
  /**
   * What wakes a hold to renew its lease. Default: a scheduler of this lock's own, which uses timers in this process.
   * Each renewal's id starts with `lease:`, so a host's own wakes on a shared scheduler don't clash with it.
   */
  readonly scheduler?: ProcessScheduler;
  /** Makes each hold's token. Default `crypto.randomUUID()`. */
  readonly newToken?: () => string;
}

/** What `acquire()` returns: a `LockHandle` with the lease row's fencing number. */
export interface PostgresLockHandle extends LockHandle {
  /**
   * A number that grows each time a writer takes the session's lock, so a resource that remembers the highest number it
   * has seen can refuse a write from an older holder. The session store needs none: its expected-last-id check already
   * refuses an append from a writer whose log tail is out of date.
   */
  readonly fence: number;
}

// The database clock in milliseconds, or the test clock passed as $3 when there is one.
const NOW_MS = "COALESCE($3::bigint, (extract(epoch FROM clock_timestamp()) * 1000)::bigint)";

/**
 * Inserts the row, or takes over a row whose lease has lapsed, in one statement. `ON CONFLICT … DO UPDATE … WHERE` locks
 * the existing row and checks the lease under that row lock, so of two writers that race for one session exactly one
 * gets a row back. A released row keeps its fence, so the number never goes back.
 */
const ACQUIRE = `
  INSERT INTO ${TABLE} AS held (user_id, session_id, token, fence, expires_at_ms)
  SELECT $1, $2, $4, 1, now_ms + $5::bigint FROM (SELECT ${NOW_MS} AS now_ms) AS clock
  ON CONFLICT (user_id, session_id) DO UPDATE
    SET token = EXCLUDED.token, fence = held.fence + 1, expires_at_ms = EXCLUDED.expires_at_ms
    WHERE held.expires_at_ms <= EXCLUDED.expires_at_ms - $5::bigint
  RETURNING fence`;

/** Extends a live lease that still carries this hold's token. A lapsed lease is not revived, even if no one took it. */
const RENEW = `
  UPDATE ${TABLE} SET expires_at_ms = clock.now_ms + $5::bigint
  FROM (SELECT ${NOW_MS} AS now_ms) AS clock
  WHERE user_id = $1 AND session_id = $2 AND token = $4 AND expires_at_ms > clock.now_ms
  RETURNING fence`;

/** Frees the row for the next writer if it still carries this hold's token. The row stays, so its fence keeps counting. */
const RELEASE = `UPDATE ${TABLE} SET expires_at_ms = 0 WHERE user_id = $1 AND session_id = $2 AND token = $3`;

interface Settings {
  readonly client: PgClientLike;
  readonly leaseMs: number;
  readonly renewMs: number;
  readonly dbNow: (() => number) | undefined;
  readonly localNow: () => number;
  readonly scheduler: ProcessScheduler;
}

function monotonic(): number {
  return globalThis.performance.now();
}

class Hold implements PostgresLockHandle {
  readonly token: string;
  readonly fence: number;
  #held = true;
  // The local time by which this hold counts its lease as gone, measured from before the statement that set it was sent.
  #deadline: number;
  readonly #key: SessionKey;
  readonly #settings: Settings;
  readonly #renewals: LeaseRenewals;

  constructor(key: SessionKey, token: string, fence: number, sentAt: number, settings: Settings) {
    this.token = token;
    this.fence = fence;
    this.#key = key;
    this.#settings = settings;
    this.#deadline = sentAt + settings.leaseMs;
    this.#renewals = new LeaseRenewals({
      scheduler: settings.scheduler,
      renewMs: settings.renewMs,
      wakeId: `${leaseId(key)}/${token}`,
      held: () => this.#held,
      renew: () => this.#renew(),
      lose: () => this.#lose(),
    });
  }

  held(): boolean {
    // The lease is timed on this host's clock from before the statement that set it left, so network delay and the
    // database's queue only ever shorten it here, and no clock difference between hosts can make a holder outlive it.
    if (this.#held && this.#settings.localNow() >= this.#deadline) this.#lose();
    return this.#held;
  }

  async #renew(): Promise<void> {
    const { client, leaseMs, dbNow, localNow } = this.#settings;
    const sentAt = localNow();
    try {
      const { rows } = await client.query(RENEW, [
        this.#key.userId,
        this.#key.sessionId,
        dbNow?.() ?? null,
        this.token,
        leaseMs,
      ]);
      if (rows.length === 0) return this.#lose();
      if (this.#held) this.#deadline = sentAt + leaseMs;
    } catch {
      // Retried on the next tick. If renewals keep failing, the local deadline passes and held() turns false.
    }
  }

  #lose(): void {
    if (!this.#held) return;
    this.#held = false;
    this.#renewals.stop();
  }

  async release(): Promise<void> {
    this.#lose();
    // A renewal in progress finishes first, so it can't extend the lease after the release.
    await this.#renewals.idle();
    await this.#settings.client.query(RELEASE, [this.#key.userId, this.#key.sessionId, this.token]);
  }
}

/**
 * A `SessionLock` on one Postgres row per session, in the `harness_session_locks` table that `POSTGRES_HARNESS_SCHEMA`
 * creates. `acquire()` returns a handle, or `"would_block"` at once while another writer's lease is live. The holder
 * renews its lease every `renewMs` through `scheduler`, and a writer whose renewals stop, because its function ended or
 * its process died, loses the lock when the lease lapses. A lapsed lease is the only staleness rule.
 *
 * The database's clock, `clock_timestamp()`, sets every lease's end, so writers on hosts whose clocks disagree still
 * agree on when a lease lapses. The holder measures its own lease on a monotonic local clock from before it sent the
 * statement, so `held()` turns `false` no later than the row's lease ends, whatever the network delay. Only a difference
 * in how fast two clocks run can then matter, which is far smaller than any lease. Each handle carries a `fence`, a
 * number that grows on every acquire of the session.
 */
export function postgresLock(client: PgClientLike, options: PostgresLockOptions = {}): SessionLock {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const renewMs = options.renewMs ?? Math.min(DEFAULT_RENEW_MS, leaseMs / 3);
  const ok =
    Number.isSafeInteger(leaseMs) && leaseMs > 0 && renewMs > 0 && renewMs < leaseMs && renewMs <= MAX_TIMER_MS;
  if (!ok) {
    throw new HarnessError(
      "invalid_lock_options",
      `postgresLock() needs a whole leaseMs above 0 and a renewMs above 0, below the lease and at most ${MAX_TIMER_MS}`,
    );
  }
  const settings: Settings = {
    client,
    leaseMs,
    renewMs,
    dbNow: options.now,
    localNow: options.now ?? monotonic,
    scheduler: options.scheduler ?? processScheduler(),
  };
  const newToken = options.newToken ?? (() => globalThis.crypto.randomUUID());
  return {
    async acquire(key) {
      checkKey(key);
      const token = newToken();
      const sentAt = settings.localNow();
      const { rows } = await client.query(ACQUIRE, [
        key.userId,
        key.sessionId,
        options.now?.() ?? null,
        token,
        leaseMs,
      ]);
      const row = rows[0];
      if (row === undefined) return "would_block";
      return new Hold(key, token, toNumber(row.fence), sentAt, settings);
    },
  };
}
