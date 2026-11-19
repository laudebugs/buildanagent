/**
 * The observer channel: delivers each event to every subscriber, in order, without ever letting a subscriber change
 * or break the run. Each subscriber has its own queue, so a slow one delays only itself, and the run waits for the
 * queues to empty only where it must, before `agent_settled` and before the run ends, and then only for a bounded
 * time.
 */
import type { AgentEvent } from "./events.js";
import { frozenCopy } from "./freeze.js";
import type { Observer } from "./hooks.js";

/** The hook name a `hook_error` event gives for a failed observer. */
export const OBSERVER_HOOK = "observer";

interface Subscription {
  readonly observer: Observer;
  active: boolean;
  tail: Promise<void>;
  /** The events queued for it and not yet handled. */
  pending: number;
  /** The type of the event it is handling, for the report when it is dropped. */
  current: AgentEvent["type"] | undefined;
}

/** What a failed observer turns into: the run reports it as a `hook_error` event. */
export type ReportFailure = (hook: string, error: unknown) => void;

/** Delivers events to observers. `deliver` and `flush` never throw and never reject. */
export class ObserverBus {
  readonly #subscriptions = new Set<Subscription>();
  readonly #report: ReportFailure;
  readonly #timeoutMs: number;

  /** `timeoutMs` bounds how long `flush` waits for an observer before it drops it. */
  constructor(report: ReportFailure, timeoutMs: number) {
    this.#report = report;
    this.#timeoutMs = timeoutMs;
  }

  /** Starts delivering later events to `observer`, and returns the function that stops it. */
  add(observer: Observer): () => void {
    const subscription: Subscription = {
      observer,
      active: true,
      tail: Promise.resolve(),
      pending: 0,
      current: undefined,
    };
    this.#subscriptions.add(subscription);
    return () => this.#remove(subscription);
  }

  /**
   * Queues `event` for every subscriber. They all get one frozen copy, so an observer can neither change the event
   * the run and its iterators hold nor any message or result inside it.
   */
  deliver(event: AgentEvent): void {
    if (this.#subscriptions.size === 0) return;
    const frozen = frozenCopy(event);
    for (const subscription of this.#subscriptions) {
      subscription.pending += 1;
      subscription.tail = subscription.tail.then(() => this.#call(subscription, frozen));
    }
  }

  /**
   * Resolves once every subscriber has handled every event delivered so far, including events its failures add. A
   * subscriber that has not caught up within the timeout is dropped and reported, so an observer whose promise never
   * settles can't hold the run open.
   */
  async flush(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"expired">((resolve) => {
      timer = setTimeout(() => resolve("expired"), this.#timeoutMs);
    });
    try {
      let tails: Promise<void>[];
      do {
        tails = [...this.#subscriptions].map((subscription) => subscription.tail);
        const outcome = await Promise.race([Promise.all(tails), expired]);
        if (outcome === "expired") {
          this.#dropLagging();
          return;
        }
      } while ([...this.#subscriptions].some((subscription, index) => subscription.tail !== tails[index]));
    } finally {
      clearTimeout(timer);
    }
  }

  #dropLagging(): void {
    const lagging = [...this.#subscriptions].filter((subscription) => subscription.pending > 0);
    for (const subscription of lagging) this.#remove(subscription);
    for (const subscription of lagging) {
      const what = subscription.current === undefined ? "its events" : `a ${subscription.current} event`;
      this.#report(
        OBSERVER_HOOK,
        new Error(`an observer did not handle ${what} within ${this.#timeoutMs} ms, so it was removed`),
      );
    }
  }

  #remove(subscription: Subscription): void {
    subscription.active = false;
    this.#subscriptions.delete(subscription);
  }

  async #call(subscription: Subscription, event: AgentEvent): Promise<void> {
    try {
      // An unsubscribe call stops events that are queued but not yet handled, too.
      if (!subscription.active) return;
      subscription.current = event.type;
      await subscription.observer(event);
    } catch (error) {
      // A failure while handling `hook_error` or `run_end` is dropped: reporting the first would loop for ever, and
      // nothing may follow the second.
      if (subscription.active && event.type !== "hook_error" && event.type !== "run_end") {
        this.#report(OBSERVER_HOOK, error);
      }
    } finally {
      subscription.pending -= 1;
      subscription.current = undefined;
    }
  }
}
