import type { SessionEntry } from "@buildanagent/protocol";
import {
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  planAppend,
  type SessionStore,
  type SessionSummary,
  stateOf,
  summaryOf,
} from "./store.js";

/** The options of `memoryStore()`. */
export interface MemoryStoreOptions {
  /** The bound on one entry's JSON, in bytes. Default 64 KiB. */
  readonly maxEntryBytes?: number;
}

/**
 * A store that keeps sessions in memory, for tests and for a process that doesn't need them after it ends. It follows
 * every rule of the interface and runs anywhere, workerd included. Entries are copied on the way in and out, so no
 * caller can change a stored one.
 */
export function memoryStore(options: MemoryStoreOptions = {}): SessionStore {
  const maxBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES;
  const users = new Map<string, Map<string, SessionEntry[]>>();
  const sessionsOf = (userId: string) => users.get(userId);
  return {
    async append(key, inputs, appendOptions) {
      checkKey(key);
      const log = sessionsOf(key.userId)?.get(key.sessionId) ?? [];
      const plan = planAppend(stateOf(log), inputs, appendOptions, maxBytes);
      if (plan.fresh.length > 0) {
        const sessions = sessionsOf(key.userId) ?? new Map<string, SessionEntry[]>();
        users.set(key.userId, sessions);
        sessions.set(key.sessionId, [...log, ...structuredClone(plan.fresh)]);
      }
      return structuredClone(plan.result);
    },
    async *load(key, loadOptions) {
      checkKey(key);
      const from = loadOptions?.fromSeq ?? 0;
      for (const entry of sessionsOf(key.userId)?.get(key.sessionId) ?? []) {
        if (entry.seq >= from) yield structuredClone(entry);
      }
    },
    async *list(userId) {
      checkKey({ userId, sessionId: "-" });
      const found: SessionSummary[] = [];
      for (const [sessionId, log] of sessionsOf(userId) ?? []) {
        const summary = summaryOf(sessionId, log);
        if (summary !== undefined) found.push(summary);
      }
      yield* found.sort(byAge);
    },
    async delete(key) {
      checkKey(key);
      sessionsOf(key.userId)?.delete(key.sessionId);
    },
  };
}
