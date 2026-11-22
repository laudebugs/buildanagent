import type { SessionEntry } from "@buildanagent/protocol";
import {
  byAge,
  checkKey,
  DEFAULT_MAX_ENTRY_BYTES,
  extendState,
  type LoadOptions,
  type LogState,
  planAppend,
  type SessionKey,
  type SessionStore,
  type SessionSummary,
  stateOf,
  summaryOf,
} from "./store.js";

/** One session's entries and the index over them. */
interface Stored {
  readonly entries: SessionEntry[];
  state: LogState;
}

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
  const users = new Map<string, Map<string, Stored>>();
  const sessionsOf = (userId: string) => users.get(userId);
  async function* entriesOf(key: SessionKey, loadOptions: LoadOptions | undefined) {
    const from = loadOptions?.fromSeq ?? 0;
    // A snapshot, as the JSONL store's load is, so an append made while a caller iterates doesn't extend the loop.
    const snapshot = (sessionsOf(key.userId)?.get(key.sessionId)?.entries ?? []).filter((entry) => entry.seq >= from);
    for (const entry of structuredClone(snapshot)) yield entry;
  }
  async function* summaries(userId: string) {
    const found: SessionSummary[] = [];
    for (const [sessionId, log] of sessionsOf(userId) ?? []) {
      const summary = summaryOf(sessionId, log.entries);
      if (summary !== undefined) found.push(summary);
    }
    yield* found.sort(byAge);
  }
  return {
    async append(key, inputs, appendOptions) {
      checkKey(key);
      const log = sessionsOf(key.userId)?.get(key.sessionId) ?? { entries: [], state: stateOf([]) };
      const plan = planAppend(log.state, inputs, appendOptions, maxBytes);
      if (plan.fresh.length > 0) {
        const stored = structuredClone(plan.fresh);
        log.entries.push(...stored);
        log.state = extendState(log.state, stored);
        const sessions = sessionsOf(key.userId) ?? new Map<string, Stored>();
        users.set(key.userId, sessions);
        sessions.set(key.sessionId, log);
      }
      return structuredClone(plan.result);
    },
    load(key, loadOptions) {
      checkKey(key);
      return entriesOf(key, loadOptions);
    },
    list(userId) {
      checkKey({ userId, sessionId: "-" });
      return summaries(userId);
    },
    loadRaw(key) {
      checkKey(key);
      return entriesOf(key, undefined);
    },
    async delete(key) {
      checkKey(key);
      sessionsOf(key.userId)?.delete(key.sessionId);
    },
  };
}
