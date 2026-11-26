// Wakes on Vercel Workflow: each wake is one workflow run that sleeps until its time and then delivers the wake in a
// single step, so the engine never replays an agent's turn. The Workflow SDK's compiler turns the two directives into
// a workflow and a step, so this file belongs in your app. `connect()` and `onWake` are your app's database client and
// wake handler, such as a function that calls `continueRun` for the session.

import {
  deliverWake,
  type PgClientLike,
  postgresWakeLedger,
  type WakeRequest,
  workflowScheduler,
} from "@buildanagent/harness/vercel";
import { runWakeWorkflow } from "@buildanagent/harness/vercel/workflow";
import { createHook, sleep } from "workflow";
import { resumeHook, start } from "workflow/api";

/** What the step reaches through module scope: set once when the app starts. */
export const app: {
  connect?: () => PgClientLike;
  onWake?: (sessionId: string, at: Date) => Promise<void>;
} = {};

export async function harnessWake(request: WakeRequest) {
  "use workflow";
  return runWakeWorkflow(request, { sleep, createHook, deliver: deliverHarnessWake });
}

export async function deliverHarnessWake(request: WakeRequest) {
  "use step";
  const { connect, onWake } = app;
  if (connect === undefined || onWake === undefined) throw new Error("set app.connect and app.onWake first");
  return deliverWake(request, { ledger: postgresWakeLedger(connect()), handler: onWake });
}

/** The `Scheduler` to give the harness: it records each wake and starts a `harnessWake` run for it. */
export function harnessScheduler(client: PgClientLike) {
  return workflowScheduler({
    ledger: postgresWakeLedger(client),
    start: (request) => start(harnessWake, [request]),
    resumeHook,
  });
}
