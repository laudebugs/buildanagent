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
 * `harness_wakes` table. Each wake carries a nonce, which names one asking of it: asking again for a pending wake keeps
 * its nonce, so a second run for it is a duplicate, while asking again once it was cancelled or claimed for delivery
 * makes a new nonce, so the new run never meets the old run's hook token.
 */
export interface WakeLedger {
  /**
   * Records a pending wake and returns its nonce. Recording one that is pending already is no error and returns the
   * nonce it has. Recording one that a delivery has claimed records a new wake with a new nonce.
   */
  add(sessionId: string, at: number): Promise<string>;
  /** Marks the wake with this nonce as being delivered, and returns whether it is still in the ledger. */
  claim(sessionId: string, at: number, nonce: string): Promise<boolean>;
  /** Removes the wake with this nonce, after it was delivered. A newer asking of the same wake stays. */
  remove(sessionId: string, at: number, nonce: string): Promise<void>;
  /** Removes every wake of `sessionId`, pending or claimed, and returns their times and nonces. */
  removeAll(sessionId: string): Promise<{ readonly at: number; readonly nonce: string }[]>;
}

const TABLE = "harness_wakes";

/**
 * A `WakeLedger` in the `harness_wakes` table that `POSTGRES_HARNESS_SCHEMA` creates. Each method is one statement, and
 * the database makes each nonce with `gen_random_uuid()`.
 */
export function postgresWakeLedger(client: PgClientLike): WakeLedger {
  return {
    async add(sessionId, at) {
      // A pending row keeps its nonce; a claimed row is being delivered already, so this asking is a new wake.
      const { rows } = await client.query(
        `INSERT INTO ${TABLE} AS w (session_id, at_ms) VALUES ($1, $2)
         ON CONFLICT (session_id, at_ms) DO UPDATE
           SET nonce = CASE WHEN w.claimed THEN EXCLUDED.nonce ELSE w.nonce END, claimed = false
         RETURNING nonce`,
        [sessionId, at],
      );
      return String(rows[0]?.nonce);
    },
    async claim(sessionId, at, nonce) {
      const { rows } = await client.query(
        `UPDATE ${TABLE} SET claimed = true WHERE session_id = $1 AND at_ms = $2 AND nonce = $3 RETURNING 1`,
        [sessionId, at, nonce],
      );
      return rows.length > 0;
    },
    async remove(sessionId, at, nonce) {
      await client.query(`DELETE FROM ${TABLE} WHERE session_id = $1 AND at_ms = $2 AND nonce = $3`, [
        sessionId,
        at,
        nonce,
      ]);
    },
    async removeAll(sessionId) {
      const { rows } = await client.query(`DELETE FROM ${TABLE} WHERE session_id = $1 RETURNING at_ms, nonce`, [
        sessionId,
      ]);
      return rows.map((row) => ({ at: toNumber(row.at_ms), nonce: String(row.nonce) }));
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

/** The hook token of one wake: the id, encoded so it holds no `:`, the time and the nonce the ledger gave it. */
export function wakeToken(sessionId: string, at: number, nonce: string): string {
  return `harness-wake:${encodeName(sessionId)}:${at}:${encodeName(nonce)}`;
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
 *
 * The id is the only key, as with every `Scheduler`, so a host that serves several users puts the user in the id, or
 * one user's `cancel()` drops another's wakes of the same session id.
 */
export function workflowScheduler(options: WorkflowSchedulerOptions): Scheduler {
  const { ledger, start, resumeHook } = options;
  if (
    typeof start !== "function" ||
    typeof resumeHook !== "function" ||
    ["add", "claim", "remove", "removeAll"].some(
      (name) => typeof (ledger as unknown as Record<string, unknown>)?.[name] !== "function",
    )
  ) {
    throw new HarnessError(
      "invalid_scheduler_options",
      "workflowScheduler() needs a ledger with add, claim, remove and removeAll, a start function and a resumeHook function",
    );
  }
  return {
    async wake(at, sessionId) {
      const time = at.getTime();
      if (Number.isNaN(time)) throw new TypeError("Scheduler.wake needs a valid date.");
      // The ledger comes first, so a run that starts can always find its wake. A wake asked for again starts a run
      // again, which covers a start that failed after the row was written; a duplicate run ends without delivering.
      const nonce = await ledger.add(sessionId, time);
      await start({ sessionId, at: time, nonce, token: wakeToken(sessionId, time, nonce) });
    },
    async cancel(sessionId) {
      const removed = await ledger.removeAll(sessionId);
      await Promise.all(
        removed.map(({ at, nonce }) =>
          resumeHook(wakeToken(sessionId, at, nonce), { cancel: true }).catch(() => undefined),
        ),
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
 * Delivers one wake from inside a workflow step: it claims the wake if it is still in the ledger, calls `handler`, and
 * then removes it. A wake that `cancel()` removed is not delivered, and returns `"cancelled"`. Call it from the
 * `"use step"` function you pass to `runWakeWorkflow()` as `deliver`, so the handler runs once per step and a replay
 * reads the step's recorded result. A handler that throws leaves the wake in the ledger, so the SDK's retry of the step
 * delivers it again; a wake whose retries all fail stays in the table until `cancel()` removes it. A handler that asks
 * for the same id and time again gets a new wake, which the removal leaves in place.
 */
export async function deliverWake(
  request: WakeRequest,
  options: DeliverWakeOptions,
): Promise<"delivered" | "cancelled"> {
  const { ledger, handler } = options;
  if (!(await ledger.claim(request.sessionId, request.at, request.nonce))) return "cancelled";
  await handler(request.sessionId, new Date(request.at));
  await ledger.remove(request.sessionId, request.at, request.nonce);
  return "delivered";
}
