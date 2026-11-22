/**
 * The session pointer: which file holds a session's log now. A session's key stays the same while the file under it
 * changes, because a revert or a migration writes a new file and moves the pointer, and no file is ever rewritten. The
 * pointer is the only mutable state in the log. A session with no pointer is in the file named like its key.
 */
import { checkKey, type SessionKey } from "./store.js";

/** Where each session's current file is. Replacing a pointer must be atomic, so a crash leaves the old one or the new. */
export interface SessionIndex {
  /** The id of the session's current file, or `undefined` when it has no pointer. */
  get(key: SessionKey): Promise<string | undefined>;
  /** Points the session at another file. */
  set(key: SessionKey, file: string): Promise<void>;
}

const slot = (key: SessionKey): string => JSON.stringify([key.userId, key.sessionId]);

/** A pointer index in memory, for tests and for a process that keeps its sessions in `memoryStore()`. */
export function memoryIndex(): SessionIndex {
  const pointers = new Map<string, string>();
  return {
    async get(key) {
      checkKey(key);
      return pointers.get(slot(key));
    },
    async set(key, file) {
      checkKey(key);
      pointers.set(slot(key), file);
    },
  };
}
