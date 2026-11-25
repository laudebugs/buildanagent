// An in-process stand-in for the part of the Vercel Workflow SDK that workflowScheduler() and runWakeWorkflow() use:
// start(), resumeHook(), sleep() on a clock the test moves, and createHook() with getConflict() and dispose(). It keeps
// the SDK's documented rules that the scheduler relies on: one live hook per token, a conflict reported by
// getConflict() rather than thrown, and resumeHook() rejecting with HookNotFoundError for a token no run holds. It does
// not replay, retry steps or persist anything; the opt-in live run covers the real engine.

import type { DeliveredWake, SchedulerUnderTest } from "@buildanagent/harness/testing";
import {
  deliverWake,
  type WakeLedger,
  type WakeRequest,
  type WakeSignal,
  workflowScheduler,
} from "@buildanagent/harness/vercel";
import { runWakeWorkflow, type WakeHook, type WakeOutcome } from "@buildanagent/harness/vercel/workflow";

class HookNotFoundError extends Error {
  override name = "HookNotFoundError";
}

interface Sleeper {
  readonly until: number;
  readonly wake: () => void;
}

export interface FakeWorkflow {
  readonly under: SchedulerUnderTest;
  /** How each run ended, in the order the runs ended. */
  readonly outcomes: () => readonly WakeOutcome[];
  /** The tokens resumeHook() was called with. */
  readonly resumed: () => readonly string[];
  /** Waits until every run has finished or is blocked on a sleep or a hook. */
  readonly settle: () => Promise<void>;
}

export interface FakeWorkflowOptions {
  readonly ledger: WakeLedger;
  readonly start: number;
  /** Replaces the delivery handler, which by default records the wake. */
  readonly handler?: (sessionId: string, at: Date) => void | Promise<void>;
  /** Makes start() fail for the requests it returns true for. */
  readonly failStart?: (request: WakeRequest) => boolean;
}

export function fakeWorkflow(options: FakeWorkflowOptions): FakeWorkflow {
  let time = options.start;
  let busy = 0;
  const sleepers = new Set<Sleeper>();
  const hooks = new Map<string, (signal: WakeSignal) => void>();
  const delivered: DeliveredWake[] = [];
  const outcomes: WakeOutcome[] = [];
  const resumed: string[] = [];
  const handler =
    options.handler ??
    ((sessionId: string, at: Date) => {
      delivered.push({ sessionId, at });
    });

  const run = (request: WakeRequest): void => {
    busy += 1;
    // A run is busy unless it waits on a sleep or a hook. Whichever settles first makes it busy again, and the loser of
    // the race, which may settle long after the run ended, changes nothing.
    let waiting = false;
    const wait = <T>(promise: Promise<T>): Promise<T> => {
      if (!waiting) {
        waiting = true;
        busy -= 1;
      }
      return promise.finally(() => {
        if (!waiting) return;
        waiting = false;
        busy += 1;
      });
    };
    const createHook = ({ token }: { token: string }): WakeHook<WakeSignal> => {
      let resolve!: (signal: WakeSignal) => void;
      const received = new Promise<WakeSignal>((done) => {
        resolve = done;
      });
      let owner = false;
      return {
        // biome-ignore lint/suspicious/noThenProperty: a Workflow hook is a thenable, and runWakeWorkflow awaits it.
        then: (onFulfilled, onRejected) => wait(received).then(onFulfilled, onRejected),
        getConflict: async () => {
          if (hooks.has(token)) return { runId: "another-run" };
          hooks.set(token, resolve);
          owner = true;
          return null;
        },
        dispose: () => {
          if (owner && hooks.get(token) === resolve) hooks.delete(token);
        },
      };
    };
    const sleep = (until: Date) =>
      wait(
        new Promise<void>((done) => {
          sleepers.add({ until: until.getTime(), wake: done });
        }),
      );
    void runWakeWorkflow(request, {
      sleep,
      createHook,
      now: () => time,
      deliver: (req) => deliverWake(req, { ledger: options.ledger, handler }),
    })
      .then((outcome) => {
        outcomes.push(outcome);
      })
      .finally(() => {
        busy -= 1;
      });
  };

  const scheduler = workflowScheduler({
    ledger: options.ledger,
    start: async (request) => {
      if (options.failStart?.(request)) throw new Error("the workflow did not start");
      run(request);
      return { runId: `run-${request.token}` };
    },
    resumeHook: async (token, signal) => {
      resumed.push(token);
      const resolve = hooks.get(token);
      if (resolve === undefined) throw new HookNotFoundError(`no hook holds ${token}`);
      resolve(signal);
      return { token };
    },
  });

  const settle = async () => {
    for (let spins = 0; busy > 0; spins += 1) {
      if (spins > 10_000) throw new Error("a fake workflow run never settled");
      await new Promise((done) => setImmediate(done));
    }
  };

  const under: SchedulerUnderTest = {
    scheduler,
    now: () => new Date(time),
    delivered: () => [...delivered],
    async advanceTo(to) {
      await settle();
      const target = to.getTime();
      for (;;) {
        const due = [...sleepers].filter((s) => s.until <= target).sort((a, b) => a.until - b.until)[0];
        if (due === undefined) break;
        sleepers.delete(due);
        time = Math.max(time, due.until);
        due.wake();
        await settle();
      }
      time = Math.max(time, target);
      await settle();
    },
  };
  return { under, outcomes: () => [...outcomes], resumed: () => [...resumed], settle };
}
