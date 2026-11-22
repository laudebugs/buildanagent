/**
 * The scheduler seam: a promise to call back for a session at a time. A host that cannot keep a timer alive between
 * requests backs it with its own alarm, such as a Durable Object alarm, a delayed queue message or a workflow sleep, and
 * `processScheduler()` backs it with a timer for a host that stays up. The seam carries a lock's renewals and any wake a
 * run asks for, such as an approval deadline.
 */

/**
 * Promises a wake at a time. A wake is **at-least-once**: it can arrive more than once, and a caller must treat a second
 * wake as harmless. It never arrives before `at`.
 */
export interface Scheduler {
  /**
   * Asks for one wake of `sessionId` at `at`. A time in the past wakes at once. Asking twice for the same id and time is
   * one wake. The id is only a key to the scheduler, so a caller with a second purpose for a session prefixes it, as
   * `fileLock()` does for its renewals, and the two never cancel each other.
   */
  wake(at: Date, sessionId: string): Promise<void>;
  /** Drops every wake still pending for `sessionId`. A wake already delivered is not recalled, and an unknown id is fine. */
  cancel(sessionId: string): Promise<void>;
}

/** What receives a wake: the id it was asked for and the time it was asked for. */
export type WakeHandler = (sessionId: string, at: Date) => void | Promise<void>;

/** A scheduler that delivers its wakes in this process, to handlers registered with `onWake()`. */
export interface ProcessScheduler extends Scheduler {
  /** Calls `handler` for every wake, in the order they come due. The returned function stops it. */
  onWake(handler: WakeHandler): () => void;
}

/** The options of `processScheduler()`. A test sets all three to drive time by hand. */
export interface ProcessSchedulerOptions {
  /** The clock in milliseconds since the epoch. Default `Date.now`. */
  readonly now?: () => number;
  /** Starts a timer. Default `setTimeout`, unreferenced so a pending wake never keeps a process alive. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  /** Stops a timer `setTimer` started. Default `clearTimeout`. */
  readonly clearTimer?: (timer: unknown) => void;
  /** Receives an error a handler threw or rejected with, so one handler's failure never stops the others. Default ignores it. */
  readonly onError?: (error: unknown, sessionId: string) => void;
}

// A timer's delay is a 32-bit number, so a farther wake sleeps in steps.
const MAX_DELAY_MS = 2 ** 31 - 1;

interface Pending {
  readonly id: string;
  readonly at: number;
  timer: unknown;
}

function defaultSetTimer(callback: () => void, ms: number): unknown {
  const timer = setTimeout(callback, ms);
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

/**
 * A `Scheduler` for a host that stays up: each wake is a timer, and the handlers registered with `onWake()` receive it.
 * Wakes do not survive the process, which is the point of the seam: a host that restarts supplies a scheduler that does.
 */
export function processScheduler(options: ProcessSchedulerOptions = {}): ProcessScheduler {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const handlers = new Set<WakeHandler>();
  const pending = new Map<string, Pending>();

  const key = (id: string, at: number) => `${at}:${id}`;

  const deliver = async (id: string, at: number): Promise<void> => {
    for (const handler of [...handlers]) {
      try {
        await handler(id, new Date(at));
      } catch (error) {
        options.onError?.(error, id);
      }
    }
  };

  const arm = (entry: Pending): void => {
    const remaining = entry.at - now();
    entry.timer = setTimer(
      () => {
        // A wake that a cancel already removed must not fire, even when its timer was already due.
        if (pending.get(key(entry.id, entry.at)) !== entry) return;
        // A far wake sleeps in steps, and a timer can also fire a millisecond early, so both look at the clock again.
        if (now() < entry.at) return arm(entry);
        pending.delete(key(entry.id, entry.at));
        void deliver(entry.id, entry.at);
      },
      Math.min(MAX_DELAY_MS, Math.max(0, remaining)),
    );
  };

  return {
    wake(at, sessionId) {
      const time = at.getTime();
      if (Number.isNaN(time)) return Promise.reject(new TypeError("Scheduler.wake needs a valid date."));
      if (!pending.has(key(sessionId, time))) {
        const entry: Pending = { id: sessionId, at: time, timer: undefined };
        pending.set(key(sessionId, time), entry);
        arm(entry);
      }
      return Promise.resolve();
    },
    cancel(sessionId) {
      for (const [name, entry] of pending) {
        if (entry.id !== sessionId) continue;
        clearTimer(entry.timer);
        pending.delete(name);
      }
      return Promise.resolve();
    },
    onWake(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
