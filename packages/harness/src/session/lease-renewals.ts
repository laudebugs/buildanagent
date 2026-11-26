/**
 * The renewal timer a lock handle shares across adapters: it asks a `ProcessScheduler` for the next renewal, ignores a
 * wake delivered twice, and runs at most one renewal at a time. An adapter supplies what a renewal does and what losing
 * the lock means. This file is internal and is not exported from the package.
 */
import type { ProcessScheduler } from "./scheduler.js";
import { encodeName, type SessionKey } from "./store.js";

/** The scheduler id of a session's lease renewals, prefixed so it never meets a wake the host asks for the session. */
export function leaseId(key: SessionKey): string {
  return `lease:${encodeName(key.userId)}/${encodeName(key.sessionId)}`;
}

/**
 * Asks `scheduler` for the next renewal at least `renewMs` ahead and at least 1 ms after the last one, and returns the
 * time asked for. A scheduler that refuses the wake leaves no renewal coming, so `onRefused` runs and the hold reports
 * itself lost.
 */
export function armRenewal(
  { scheduler, renewMs }: { readonly scheduler: ProcessScheduler; readonly renewMs: number },
  armedAt: number,
  wakeId: string,
  onRefused: () => void,
): number {
  const at = new Date(Math.max(scheduler.now() + renewMs, armedAt + 1));
  scheduler.wake(at, wakeId).catch(onRefused);
  return at.getTime();
}

/** What a `LeaseRenewals` needs from the lock handle that owns it. */
export interface LeaseRenewalsOptions {
  readonly scheduler: ProcessScheduler;
  readonly renewMs: number;
  /** This hold's own id, so a hold that loses its lock never cancels the wake of a newer hold on the same session. */
  readonly wakeId: string;
  /** Whether the handle still holds the lock. A wake for a lost hold does nothing. */
  readonly held: () => boolean;
  /** One renewal. It handles its own errors; a renewal that fails is retried on the next tick. */
  readonly renew: () => Promise<void>;
  /** Called when the scheduler refuses a wake, because no renewal is then coming. */
  readonly lose: () => void;
}

export class LeaseRenewals {
  readonly #options: LeaseRenewalsOptions;
  readonly #stopListening: () => void;
  // The time of the renewal wake this hold is waiting for. A duplicate of a delivered wake carries an older time.
  #armedAt = 0;
  #renewing: Promise<void> | undefined;

  constructor(options: LeaseRenewalsOptions) {
    this.#options = options;
    this.#stopListening = options.scheduler.onWake((id, at) => {
      if (id !== options.wakeId || at.getTime() !== this.#armedAt || !options.held()) return;
      this.#arm();
      void this.#tick();
    });
    this.#arm();
  }

  /** Asks the scheduler for the next renewal. The scheduler may wake twice, so a wake only counts at the time asked for. */
  #arm(): void {
    // Each ask has its own time, even when the clock has not moved, so a wake delivered twice is told from the next.
    const { scheduler, renewMs, wakeId, lose } = this.#options;
    const at = new Date(Math.max(scheduler.now() + renewMs, this.#armedAt + 1));
    this.#armedAt = at.getTime();
    // A scheduler that refuses the wake leaves no renewal coming, so the hold reports itself lost and the writer stops.
    scheduler.wake(at, wakeId).catch(lose);
  }

  #tick(): Promise<void> {
    if (!this.#options.held() || this.#renewing !== undefined) return Promise.resolve();
    const renewal = this.#options.renew().finally(() => {
      this.#renewing = undefined;
    });
    this.#renewing = renewal;
    return renewal;
  }

  /** Stops listening and cancels the pending wake. */
  stop(): void {
    this.#stopListening();
    this.#options.scheduler.cancel(this.#options.wakeId).catch(() => undefined);
  }

  /** Resolves once a renewal in progress has finished, so a release can't be overtaken by it. */
  async idle(): Promise<void> {
    await this.#renewing;
  }
}
