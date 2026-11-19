/**
 * The observer channel: delivers each event to every subscriber, in order, without ever letting a subscriber change
 * or break the run. Each subscriber has its own queue, so a slow one delays only itself, and the run waits for the
 * queues to empty only where it must, before `agent_settled` and before the run ends.
 */
import type { AgentEvent } from "./events.js";
import type { Observer } from "./hooks.js";

/** The hook name a `hook_error` event gives for a failed observer. */
export const OBSERVER_HOOK = "observer";

interface Subscription {
  readonly observer: Observer;
  active: boolean;
  tail: Promise<void>;
}

/** What a failed observer turns into: the run reports it as a `hook_error` event. */
export type ReportFailure = (hook: string, error: unknown) => void;

/** Delivers events to observers. `deliver` and `flush` never throw and never reject. */
export class ObserverBus {
  readonly #subscriptions = new Set<Subscription>();
  readonly #report: ReportFailure;

  constructor(report: ReportFailure) {
    this.#report = report;
  }

  /** Starts delivering later events to `observer`, and returns the function that stops it. */
  add(observer: Observer): () => void {
    const subscription: Subscription = { observer, active: true, tail: Promise.resolve() };
    this.#subscriptions.add(subscription);
    return () => {
      subscription.active = false;
      this.#subscriptions.delete(subscription);
    };
  }

  /** Queues `event` for every subscriber. */
  deliver(event: AgentEvent): void {
    for (const subscription of this.#subscriptions) {
      subscription.tail = subscription.tail.then(() => this.#call(subscription, event));
    }
  }

  /** Resolves once every subscriber has handled every event delivered so far, including events its failures add. */
  async flush(): Promise<void> {
    let tails: Promise<void>[];
    do {
      tails = [...this.#subscriptions].map((subscription) => subscription.tail);
      await Promise.all(tails);
    } while ([...this.#subscriptions].some((subscription, index) => subscription.tail !== tails[index]));
  }

  async #call(subscription: Subscription, event: AgentEvent): Promise<void> {
    // An unsubscribe call stops events that are queued but not yet handled, too.
    if (!subscription.active) return;
    try {
      await subscription.observer(event);
    } catch (error) {
      // A failure while handling `hook_error` or `run_end` is dropped: reporting the first would loop for ever, and
      // nothing may follow the second.
      if (event.type !== "hook_error" && event.type !== "run_end") this.#report(OBSERVER_HOOK, error);
    }
  }
}
