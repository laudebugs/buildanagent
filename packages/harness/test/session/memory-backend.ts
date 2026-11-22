// The memory backend of the session tests, kept apart from session-helpers.ts because that file registers an
// `afterAll` hook, and a process that the server tests spawn loads this one outside Vitest.
import {
  memoryIndex,
  memoryStore,
  type SessionIndex,
  type SessionLock,
  type SessionStore,
} from "@buildanagent/harness/session";

export interface Backend {
  readonly name: string;
  readonly store: SessionStore;
  readonly index: SessionIndex;
  readonly lock: SessionLock;
  /** The folder the files are in, for a test that reads them, or `undefined` for memory. */
  readonly dir: string | undefined;
}

/** A lock for the memory backend: it holds a name and never expires. */
export function memoryLock(): SessionLock {
  const held = new Set<string>();
  return {
    async acquire(key) {
      const name = JSON.stringify([key.userId, key.sessionId]);
      if (held.has(name)) return "would_block";
      held.add(name);
      let live = true;
      return {
        token: name,
        held: () => live,
        async release() {
          live = false;
          held.delete(name);
        },
      };
    },
  };
}

export function memoryBackend(): Backend {
  return { name: "memory", store: memoryStore(), index: memoryIndex(), lock: memoryLock(), dir: undefined };
}
