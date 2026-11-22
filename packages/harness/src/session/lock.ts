/** The session lock's interface: one writer per session. The file-backed implementation is in `./file-lock.ts`. */
import type { SessionKey } from "./store.js";

/** What `acquire()` returns to the writer that got the lock. */
export interface LockHandle {
  /** A random value that names this hold, so a release or a renewal only ever touches its own lock. */
  readonly token: string;
  /**
   * Whether this writer still holds the lock. It turns `false` when a renewal finds another writer's token in the lock,
   * which means the lease lapsed and someone took over. A writer that sees `false` must stop writing.
   */
  held(): boolean;
  /** Gives the lock up and stops renewing it. It is safe to call again, and it never frees another writer's lock. */
  release(): Promise<void>;
}

/** Keeps two writers from extending one session's log at once. Readers never lock. */
export interface SessionLock {
  /** The lock for this session, or `"would_block"` at once when another writer holds it. It never waits. */
  acquire(key: SessionKey): Promise<LockHandle | "would_block">;
}
