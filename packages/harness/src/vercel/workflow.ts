/**
 * `@buildanagent/harness/vercel/workflow`: the body of the Vercel Workflow run behind `workflowScheduler()`. It imports
 * nothing, not even the rest of the harness, so the Workflow SDK's bundler can put it in a workflow bundle, where code
 * must be deterministic and has no Node API. Call `runWakeWorkflow()` from your own `"use workflow"` function and pass
 * it the SDK's `sleep` and `createHook` and a `"use step"` function that delivers the wake.
 *
 * @module @buildanagent/harness/vercel/workflow
 */

/** What one wake run is started with. It is plain data, so the Workflow SDK can serialize it into the run's input. */
export interface WakeRequest {
  /** The id the wake was asked for. */
  readonly sessionId: string;
  /** The wake's time, in milliseconds since the epoch. */
  readonly at: number;
  /** The nonce the ledger gave this asking of the wake, which the delivery step claims and removes it by. */
  readonly nonce: string;
  /** The token of the run's hook, unique to this id, time and nonce, which `cancel()` resumes to end the run early. */
  readonly token: string;
}

/** What `cancel()` sends to a waiting run's hook. */
export interface WakeSignal {
  readonly cancel: true;
}

/** The part of a Workflow SDK hook the run uses. The hook from `createHook()` in `workflow` is one. */
export interface WakeHook<T> extends PromiseLike<T> {
  /** Resolves to the run that already holds the token, or `null` once this hook holds it. */
  getConflict(): Promise<unknown>;
  /** Releases the token. */
  dispose(): void;
}

/** What `runWakeWorkflow()` needs from the Workflow SDK and from your step. */
export interface WakeWorkflowRuntime {
  /** The SDK's `sleep`, from `workflow`. */
  readonly sleep: (until: Date) => Promise<unknown>;
  /** The SDK's `createHook`, from `workflow`. */
  readonly createHook: (options: { token: string }) => WakeHook<WakeSignal>;
  /**
   * A `"use step"` function that calls `deliverWake()` from `@buildanagent/harness/vercel` and returns its result. It
   * runs as one workflow step, so a replay reads its recorded result and never runs the harness's turn twice.
   */
  readonly deliver: (request: WakeRequest) => Promise<"delivered" | "cancelled">;
  /**
   * The clock, in milliseconds since the epoch. Default `Date.now`, which the Workflow SDK fixes to the run's recorded
   * time inside a workflow, so a replay takes the same branch.
   */
  readonly now?: () => number;
}

/** How one wake run ended: it delivered the wake, a cancel ended it, or another run already held its token. */
export type WakeOutcome = "delivered" | "cancelled" | "duplicate";

/**
 * Waits until `request.at`, unless `cancel()` resumes the run's hook first, and then calls `runtime.deliver` once. A
 * second run for the same id and time finds the token taken and ends at once, as `"duplicate"`. The run holds the
 * wait and the wake only, never the agent's turn: the turn runs inside the one `deliver` step, so the replaying engine
 * never re-runs a model call (the one-step-per-`continueRun` rule).
 */
export async function runWakeWorkflow(request: WakeRequest, runtime: WakeWorkflowRuntime): Promise<WakeOutcome> {
  const hook = runtime.createHook({ token: request.token });
  if ((await hook.getConflict()) !== null) return "duplicate";
  try {
    const now = runtime.now ?? Date.now;
    // A wake already due skips the sleep, because the SDK's sleep() takes a future date.
    if (request.at > now()) {
      const due = Promise.resolve(runtime.sleep(new Date(request.at))).then(() => "due" as const);
      const cancelled = Promise.resolve(hook).then(() => "cancelled" as const);
      if ((await Promise.race([due, cancelled])) === "cancelled") return "cancelled";
    }
    // A cancel can land after the sleep and before the step reads the ledger, and the step then delivers nothing.
    return (await runtime.deliver(request)) === "cancelled" ? "cancelled" : "delivered";
  } finally {
    hook.dispose();
  }
}
