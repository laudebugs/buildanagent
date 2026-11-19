/**
 * `PendingStore`: where an agent keeps its signed pending requests between a pause and its resume, keyed by the tool
 * call's id. A record is taken, not read, when the call resumes, so one approval runs its call at most once.
 */
import type { SignedPendingRequest } from "./pending.js";

/**
 * Holds signed pending requests by call id. A store may live anywhere, even where others can write, because every
 * record is verified against its signature before it counts. On a serverless host, use storage that outlives the
 * isolate or function, such as Durable Object storage.
 *
 * `take()` must remove and return the record in one atomic step, or two concurrent resumes of one approval could
 * both receive it and both run the call. Durable Object storage gives that within one object; elsewhere use an atomic
 * primitive, such as Redis `GETDEL` or SQL `DELETE ... RETURNING`, never a read followed by a delete.
 *
 * A record is taken whenever its call comes back approved, even when the check then fails, so a forged approval uses
 * up the real one and the model has to ask again. A call the person denies, or never answers, is never taken: expire
 * records after a while, as `memoryPendingStore()` does, so the store doesn't grow without bound and the keys that
 * signed old records can be pruned.
 */
export interface PendingStore {
  /** Stores `request` under its `callId`, replacing any earlier request for that call. */
  put(request: SignedPendingRequest): Promise<void>;
  /** Removes and returns the request for `callId`, or `undefined` if there is none. It must do both atomically. */
  take(callId: string): Promise<SignedPendingRequest | undefined>;
}

/** The options of `memoryPendingStore()`. */
export interface MemoryPendingStoreOptions {
  /**
   * How long a request stays in the store, in milliseconds, from when it was put. An older request is dropped, and
   * an approval that arrives after that fails closed. Defaults to 24 hours.
   */
  readonly maxAgeMs?: number;
  /** Returns the current time in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A `PendingStore` in this process's memory, for tests and single-process hosts. It stores a copy of each request and
 * hands back a copy, so changing a request object outside the store never changes what the store holds. It drops each
 * request `maxAgeMs` after it was put, so pauses nobody approves don't pile up.
 */
export function memoryPendingStore(options: MemoryPendingStoreOptions = {}): PendingStore {
  const maxAgeMs = options.maxAgeMs ?? DAY_MS;
  const now = options.now ?? Date.now;
  // In insertion order, which is also expiry order, because `put` re-inserts a replaced request at the end.
  const requests = new Map<string, { readonly request: SignedPendingRequest; readonly expires: number }>();
  const sweep = (time: number) => {
    for (const [callId, entry] of requests) {
      if (entry.expires > time) break;
      requests.delete(callId);
    }
  };
  return {
    async put(request) {
      const time = now();
      sweep(time);
      requests.delete(request.callId);
      requests.set(request.callId, { request: structuredClone(request), expires: time + maxAgeMs });
    },
    async take(callId) {
      const time = now();
      sweep(time);
      const entry = requests.get(callId);
      requests.delete(callId);
      // Checked again here, because a clock that steps back can leave an expired entry behind a live one.
      return entry !== undefined && entry.expires > time ? entry.request : undefined;
    },
  };
}
