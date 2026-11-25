/**
 * `dynamoLock()`: a `SessionLock` that is one lease item per session in DynamoDB. Every change is a conditional update,
 * so DynamoDB decides each race: an acquire needs the item to be absent or its lease to have lapsed on the caller's
 * clock, and a renewal or a release needs the item to still hold the caller's token.
 */
import { type DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { HarnessError } from "../errors.js";
import type { LockHandle, SessionLock } from "../session/lock.js";
import { type ProcessScheduler, processScheduler } from "../session/scheduler.js";
import { checkKey, encodeName, type SessionKey } from "../session/store.js";
import {
  checkTableName,
  conditionFailed,
  type DynamoTableOptions,
  type Layout,
  layoutOf,
  num,
  str,
} from "./dynamodb-common.js";
import { checkClient } from "./sdk.js";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RENEW_MS = 10_000;
const DEFAULT_MAX_CLOCK_SKEW_MS = 1_000;
// A timer's delay is a 32-bit number of milliseconds.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** The options of `dynamoLock()`. */
export interface DynamoLockOptions extends DynamoTableOptions {
  /** How long a lease lasts without a renewal. Default 30 seconds. */
  readonly leaseMs?: number;
  /** How often the holder renews. Default 10 seconds or a third of the lease, whichever is less. */
  readonly renewMs?: number;
  /**
   * The most that two hosts' clocks may differ, in milliseconds. A holder stops reporting `held()` this long before its
   * lease ends on its own clock, so a host whose clock runs that far ahead can't take the lease while the holder still
   * writes. Default 1 second. `renewMs` plus this must be less than `leaseMs`.
   */
  readonly maxClockSkewMs?: number;
  /** The clock, in milliseconds since the epoch. Default `Date.now`. A test sets it. */
  readonly now?: () => number;
  /**
   * What wakes a hold to renew its lease. Default: a timer-backed scheduler of the lock's own. Each renewal's id starts
   * with `lease:`, so a host that shares its scheduler keeps its own wakes apart.
   */
  readonly scheduler?: ProcessScheduler;
}

/** A hold on a DynamoDB lease. */
export interface DynamoLockHandle extends LockHandle {
  /**
   * A number that grows with every acquire of this session's lock, and never repeats, because a release keeps the item.
   * A host that guards another system's writes with the lock sends it along, so that system can refuse a writer whose
   * number is older than one it has seen.
   */
  readonly fence: number;
}

function invalid(message: string): HarnessError {
  return new HarnessError("invalid_lock_options", `dynamoLock() ${message}`);
}

/**
 * A `SessionLock` on a DynamoDB table with a string partition key `pk` and a string sort key `sk`, which may be the
 * session store's own table. Each session has one lease item. `acquire(key)` is one conditional update that writes a
 * new token, a lease end of `now() + leaseMs` and the next `fence`; it succeeds when the item is absent, released or
 * past its lease end, and otherwise returns `"would_block"` at once. A lapsed lease is the only staleness signal,
 * because no other host's process can be checked.
 *
 * The holder renews every `renewMs` through `scheduler`, with an update that needs the item to still hold its token, so
 * a holder that lost the lease can't extend a successor's. `held()` turns `false` when a renewal finds another token,
 * when the scheduler refuses a renewal, and when the holder's own clock comes within `maxClockSkewMs` of the lease end
 * it last wrote, whichever is first, and once `false` it stays `false`. `release()` clears the token on the same
 * condition and keeps the item, so `fence` keeps growing.
 *
 * Lease ends are compared on the clock of the host that acquires, so the lease outlasts the holder's view of it only by
 * the clock skew between them. Keep `leaseMs` above `renewMs`, plus the slowest renewal, plus `maxClockSkewMs`. A
 * lock is a liveness guard, not the only fence: the store's `expectedLastId` still refuses a second writer. The default
 * `renewMs` is a third of `leaseMs` and the default skew is 1 second, so a `leaseMs` of 1.5 seconds or less needs an
 * explicit `maxClockSkewMs`.
 */
export function dynamoLock(client: DynamoDBClient, options: DynamoLockOptions): SessionLock {
  checkClient("dynamoLock()", client);
  const table = checkTableName("dynamoLock()", options);
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const renewMs = options.renewMs ?? Math.min(DEFAULT_RENEW_MS, leaseMs / 3);
  const skewMs = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
  const now = options.now ?? Date.now;
  if (
    !(Number.isFinite(leaseMs) && leaseMs > 0) ||
    !(Number.isFinite(renewMs) && renewMs > 0 && renewMs <= MAX_TIMER_MS) ||
    !(Number.isFinite(skewMs) && skewMs >= 0) ||
    renewMs + skewMs >= leaseMs
  ) {
    throw invalid(
      "needs a positive leaseMs, renewMs and maxClockSkewMs whose renewMs + maxClockSkewMs is under leaseMs",
    );
  }
  const scheduler = options.scheduler ?? processScheduler({ now });
  const layout = layoutOf("dynamoLock()", options);
  const settings: HoldSettings = { client, table, layout, leaseMs, renewMs, skewMs, now, scheduler };

  return {
    async acquire(key) {
      checkKey(key);
      const token = globalThis.crypto.randomUUID();
      const at = now();
      try {
        const out = await client.send(
          new UpdateItemCommand({
            TableName: table,
            Key: layout.itemKey("l", key),
            UpdateExpression: "SET #token = :token, #leaseUntil = :until ADD #fence :one",
            ConditionExpression: "attribute_not_exists(#sk) OR #leaseUntil < :now",
            ExpressionAttributeNames: {
              "#sk": "sk",
              "#token": "token",
              "#leaseUntil": "leaseUntil",
              "#fence": "fence",
            },
            ExpressionAttributeValues: {
              ":token": { S: token },
              ":until": { N: String(at + leaseMs) },
              ":now": { N: String(at) },
              ":one": { N: "1" },
            },
            ReturnValues: "ALL_NEW",
            ReturnValuesOnConditionCheckFailure: "ALL_OLD",
          }),
        );
        return new LeaseHold(key, token, num(out.Attributes, "fence") ?? 0, at + leaseMs, settings);
      } catch (error) {
        const failed = conditionFailed(error);
        if (failed === undefined) throw error;
        // The SDK resends an update whose response was lost, and the resent update meets this acquire's own lease.
        if (str(failed.item, "token") !== token) return "would_block";
        return new LeaseHold(key, token, num(failed.item, "fence") ?? 0, at + leaseMs, settings);
      }
    },
  };
}

interface HoldSettings {
  readonly client: DynamoDBClient;
  readonly table: string;
  readonly layout: Layout;
  readonly leaseMs: number;
  readonly renewMs: number;
  readonly skewMs: number;
  readonly now: () => number;
  readonly scheduler: ProcessScheduler;
}

class LeaseHold implements DynamoLockHandle {
  readonly token: string;
  readonly fence: number;
  readonly #key: SessionKey;
  readonly #settings: HoldSettings;
  readonly #wakeId: string;
  readonly #stopListening: () => void;
  #leaseUntil: number;
  #held = true;
  // Whether a release reached DynamoDB, so a release that failed can be called again and one that worked is not resent.
  #released = false;
  #renewing: Promise<void> | undefined;
  // The time of the renewal wake this hold waits for. A duplicate of a delivered wake carries an older time.
  #armedAt = 0;

  constructor(key: SessionKey, token: string, fence: number, leaseUntil: number, settings: HoldSettings) {
    this.token = token;
    this.fence = fence;
    this.#key = key;
    this.#leaseUntil = leaseUntil;
    this.#settings = settings;
    // Each hold's own id, so a hold that lost its lease never cancels a newer hold's renewal.
    this.#wakeId = `lease:${encodeName(key.userId)}/${encodeName(key.sessionId)}/${token}`;
    this.#stopListening = settings.scheduler.onWake((id, at) => {
      if (id !== this.#wakeId || at.getTime() !== this.#armedAt || !this.#held) return;
      this.#arm();
      void this.#tick();
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

  held(): boolean {
    // Once false it stays false, even if a late renewal then extends the lease, so a writer that stopped stays stopped.
    if (this.#held && this.#settings.now() >= this.#leaseUntil - this.#settings.skewMs) this.#lose();
    return this.#held;
  }

  #tick(): Promise<void> {
    if (!this.#held || this.#renewing !== undefined) return Promise.resolve();
    this.#renewing = this.#renew().finally(() => {
      this.#renewing = undefined;
    });
    return this.#renewing;
  }

  /** Extends the lease if the item still holds this token. Any other error is retried on the next tick. */
  async #renew(): Promise<void> {
    const { client, table, leaseMs, now } = this.#settings;
    const until = now() + leaseMs;
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: table,
          Key: this.#settings.layout.itemKey("l", this.#key),
          UpdateExpression: "SET #leaseUntil = :until",
          ConditionExpression: "#token = :token",
          ExpressionAttributeNames: { "#token": "token", "#leaseUntil": "leaseUntil" },
          ExpressionAttributeValues: { ":token": { S: this.token }, ":until": { N: String(until) } },
        }),
      );
      if (this.#held) this.#leaseUntil = until;
    } catch (error) {
      if (conditionFailed(error) !== undefined) this.#lose();
    }
  }

  #lose(): void {
    this.#held = false;
    this.#stopListening();
    this.#settings.scheduler.cancel(this.#wakeId).catch(() => undefined);
  }

  async release(): Promise<void> {
    if (this.#held) this.#lose();
    // A renewal in progress finishes first, so it can't touch the item after the release.
    await this.#renewing;
    if (this.#released) return;
    const { client, table } = this.#settings;
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: table,
          Key: this.#settings.layout.itemKey("l", this.#key),
          UpdateExpression: "SET #leaseUntil = :zero REMOVE #token",
          ConditionExpression: "#token = :token",
          ExpressionAttributeNames: { "#token": "token", "#leaseUntil": "leaseUntil" },
          ExpressionAttributeValues: { ":token": { S: this.token }, ":zero": { N: "0" } },
        }),
      );
    } catch (error) {
      // Another writer holds the lease now, which this release must leave alone.
      if (conditionFailed(error) === undefined) throw error;
    }
    this.#released = true;
  }
}
