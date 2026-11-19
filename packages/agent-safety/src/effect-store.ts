/**
 * `EffectStore`: the effects ledger. It keeps one record per effect key, written before the write runs and settled with
 * its outcome after, so a crash leaves a `started` record behind and the resume knows a write may have happened. Every
 * change is a compare-and-set on the record's attempt number, so two processes can never both run one write.
 */
import type { EffectScope } from "./effect-key.js";
import type { WriteOutcome } from "./outcome.js";

/**
 * One write's entry in the effects ledger. A `started` record belongs to a live attempt until `leaseUntil`; after
 * that, the attempt counts as crashed. A `settled` record holds the write's outcome.
 */
export interface EffectRecord {
  /** The effect key, from `effectKey()`. */
  readonly key: string;
  /** The scope of the call that last started this write. */
  readonly scope: EffectScope;
  /** The business key the tool declared, if any. */
  readonly businessKey?: string;
  /** The tool or business operation, such as `refund_create`. */
  readonly operation: string;
  /** `canonicalInputHash()` of the write's input, the same hash an approval signs. */
  readonly inputHash: string;
  /** Counts the attempts that have held this record: 1 for the first, one more for each takeover. */
  readonly attempt: number;
  /** `started` while an attempt may be running, `settled` once its outcome is recorded. */
  readonly state: "started" | "settled";
  /** The write's outcome, set when the record is settled. */
  readonly outcome?: WriteOutcome;
  /** When the current attempt started, as an ISO 8601 timestamp. */
  readonly startedAt: string;
  /** Until when the current attempt counts as live, as an ISO 8601 timestamp. */
  readonly leaseUntil: string;
  /** When the record was settled, as an ISO 8601 timestamp. */
  readonly settledAt?: string;
}

/** What `begin()` and `takeOver()` return: `"started"` if the caller now holds the record, or the record that won. */
export type EffectClaim = "started" | { readonly existing: EffectRecord };

/**
 * Stores effect records by key. Each method must be atomic: on Durable Object storage, within one object; in SQL, as
 * one statement such as `INSERT ... ON CONFLICT DO NOTHING` or `UPDATE ... WHERE attempt = ?`; never as a read
 * followed by a write. A store that isn't atomic lets two processes both run one write.
 *
 * Keep records at least as long as a business key can come back, and longer than any idempotency window of the API the
 * tool calls. A record that is gone lets the same business key run again.
 */
export interface EffectStore {
  /** Stores `record` if no record has its key, and returns `"started"`; otherwise returns the existing record. */
  begin(record: EffectRecord): Promise<EffectClaim>;
  /**
   * Replaces the stored record with `record` if the stored one's attempt is `record.attempt - 1`, or stores it if no
   * record has its key, and returns `"started"`; otherwise returns the stored record. The caller uses it to take over a
   * crashed attempt or to retry a settled one under the same key.
   */
  takeOver(record: EffectRecord): Promise<EffectClaim>;
  /**
   * Replaces the stored record with `record`, a settled record, if the stored one is `started` with the same attempt,
   * and returns true; otherwise changes nothing and returns false.
   */
  settle(record: EffectRecord): Promise<boolean>;
  /** Returns the record for `key`, or `undefined` if there is none. */
  get(key: string): Promise<EffectRecord | undefined>;
}

/**
 * An `EffectStore` in this process's memory, for tests and single-process hosts. Each method runs without awaiting,
 * so it is atomic within the process. It stores and returns copies, so changing a record object outside the store
 * never changes what the store holds. Records are kept until the process ends; a process that restarts forgets them,
 * so use a durable store wherever a crash must not repeat a write.
 */
export function memoryEffectStore(): EffectStore {
  const records = new Map<string, EffectRecord>();
  const copy = (record: EffectRecord): EffectRecord => structuredClone(record);
  return {
    async begin(record) {
      const existing = records.get(record.key);
      if (existing !== undefined) return { existing: copy(existing) };
      records.set(record.key, copy(record));
      return "started";
    },
    async takeOver(record) {
      const existing = records.get(record.key);
      if (existing !== undefined && existing.attempt !== record.attempt - 1) return { existing: copy(existing) };
      records.set(record.key, copy(record));
      return "started";
    },
    async settle(record) {
      const existing = records.get(record.key);
      if (existing === undefined || existing.state !== "started" || existing.attempt !== record.attempt) return false;
      records.set(record.key, copy(record));
      return true;
    },
    async get(key) {
      const existing = records.get(key);
      return existing === undefined ? undefined : copy(existing);
    },
  };
}
