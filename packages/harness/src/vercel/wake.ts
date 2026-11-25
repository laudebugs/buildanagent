/**
 * `workflowScheduler()`: a `Scheduler` whose wakes are Vercel Workflow runs. Each wake is one run that sleeps until its
 * time and then delivers the wake in one step. A ledger of pending wakes, one Postgres row each, is what makes `cancel()`
 * exact across function instances: the delivery step delivers only a wake still in the ledger. This file imports no
 * Node module and no Workflow SDK code; the host passes the SDK's functions in.
 */
import { HarnessError } from "../errors.js";
import type { Scheduler, WakeHandler } from "../session/scheduler.js";
import { encodeName } from "../session/store.js";
import { type PgClientLike, toNumber } from "./postgres-schema.js";
import type { WakeRequest, WakeSignal } from "./workflow.js";

/**
 * The wakes still pending, kept where every function instance can read them. `postgresWakeLedger()` keeps them in the
 * `harness_wakes` table.
 */
export interface WakeLedger {
  /** Records a pending wake. Recording one that is already there is no error. */
  add(sessionId: string, at: number): Promise<void>;
  /** Whether the wake is still pending. */
  has(sessionId: string, at: number): Promise<boolean>;
  /** Removes one wake, after it was delivered. */
  remove(sessionId: string, at: number): Promise<void>;
  /** Removes every pending wake of `sessionId` and returns their times. */
  removeAll(sessionId: string): Promise<number[]>;
}

const TABLE = "harness_wakes";

/** A `WakeLedger` in the `harness_wakes` table that `POSTGRES_HARNESS_SCHEMA` creates. Each method is one statement. */
export function postgresWakeLedger(client: PgClientLike): WakeLedger {
  return {
    async add(sessionId, at) {
      await client.query(`INSERT INTO ${TABLE} (session_id, at_ms) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        sessionId,
        at,
      ]);
    },
    async has(sessionId, at) {
      const { rows } = await client.query(`SELECT 1 FROM ${TABLE} WHERE session_id = $1 AND at_ms = $2`, [
        sessionId,
        at,
      ]);
      return rows.length > 0;
    },
    async remove(sessionId, at) {
      await client.query(`DELETE FROM ${TABLE} WHERE session_id = $1 AND at_ms = $2`, [sessionId, at]);
    },
    async removeAll(sessionId) {
      const { rows } = await client.query(`DELETE FROM ${TABLE} WHERE session_id = $1 RETURNING at_ms`, [sessionId]);
      return rows.map((row) => toNumber(row.at_ms));
    },
  };
}

/** The options of `workflowScheduler()`. */
export interface WorkflowSchedulerOptions {
  /** Where pending wakes are recorded. Use `postgresWakeLedger()` on the session store's database. */
  readonly ledger: WakeLedger;
  /**
   * Starts one wake run. Pass `(request) => start(harnessWake, [request])`, with `start` from `workflow/api` and
   * `harnessWake` your `"use workflow"` function that calls `runWakeWorkflow()`.
   */
  readonly start: (request: WakeRequest) => Promise<unknown>;
  /**
   * Resumes a waiting run's hook to end it early. Pass `resumeHook` from `workflow/api`. An error it throws, such as
   * the SDK's `HookNotFoundError` for a run that already ended, is ignored, because the ledger already holds the cancel.
   */
  readonly resumeHook: (token: string, signal: WakeSignal) => Promise<unknown>;
}

/** The hook token of one wake: the id, encoded so it holds no `:`, and the time. */
export function wakeToken(sessionId: string, at: number): string {
  return `harness-wake:${encodeName(sessionId)}:${at}`;
}

/**
 * A `Scheduler` on Vercel Workflow. `wake(at, id)` records the wake in the ledger and starts a run of your workflow
 * with a `WakeRequest`; that run calls `runWakeWorkflow()`, which sleeps until `at` with the SDK's `sleep()` and then
 * calls your step, which calls `deliverWake()`. `cancel(id)` removes the session's wakes from the ledger, so a run that
 * wakes later delivers nothing, and resumes each run's hook so it ends at once instead of sleeping on.
 *
 * Wakes are at-least-once. A step that fails is retried by the Workflow SDK, and a wake asked for twice may start two
 * runs; the second finds the hook token taken and ends without delivering. The wake handler must still treat a
 * second delivery as harmless, because a step that delivered and then failed to record it runs again.
 */
export function workflowScheduler(options: WorkflowSchedulerOptions): Scheduler {
  const { ledger, start, resumeHook } = options;
  if (
    typeof start !== "function" ||
    typeof resumeHook !== "function" ||
    ["add", "has", "remove", "removeAll"].some(
      (name) => typeof (ledger as unknown as Record<string, unknown>)?.[name] !== "function",
    )
  ) {
    throw new HarnessError(
      "invalid_scheduler_options",
      "workflowScheduler() needs a ledger with add, has, remove and removeAll, a start function and a resumeHook function",
    );
  }
  return {
    async wake(at, sessionId) {
      const time = at.getTime();
      if (Number.isNaN(time)) throw new TypeError("Scheduler.wake needs a valid date.");
      // The ledger comes first, so a run that starts can always find its wake. A wake asked for again starts a run
      // again, which covers a start that failed after the row was written; a duplicate run ends without delivering.
      await ledger.add(sessionId, time);
      await start({ sessionId, at: time, token: wakeToken(sessionId, time) });
    },
    async cancel(sessionId) {
      const times = await ledger.removeAll(sessionId);
      await Promise.all(
        times.map((time) => resumeHook(wakeToken(sessionId, time), { cancel: true }).catch(() => undefined)),
      );
    },
  };
}

/** The options of `deliverWake()`. */
export interface DeliverWakeOptions {
  /** The same ledger the scheduler records wakes in. */
  readonly ledger: WakeLedger;
  /** What receives the wake, such as a function that calls `continueRun` for the session. */
  readonly handler: WakeHandler;
}

/**
 * Delivers one wake from inside a workflow step: it calls `handler` if the wake is still in the ledger, and then
 * removes it. A wake that `cancel()` removed is not delivered, and returns `"cancelled"`. Call it from the
 * `"use step"` function you pass to `runWakeWorkflow()` as `deliver`, so the handler runs once per step and a replay
 * reads the step's recorded result. A handler that throws leaves the wake in the ledger, so the SDK's retry of the step
 * delivers it again.
 */
export async function deliverWake(
  request: WakeRequest,
  options: DeliverWakeOptions,
): Promise<"delivered" | "cancelled"> {
  const { ledger, handler } = options;
  if (!(await ledger.has(request.sessionId, request.at))) return "cancelled";
  await handler(request.sessionId, new Date(request.at));
  await ledger.remove(request.sessionId, request.at);
  return "delivered";
}
