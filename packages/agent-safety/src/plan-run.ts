/**
 * `runPlan()`: runs an approved plan in order and tells the model what is true afterwards. Each step is a guarded
 * write, so a crash never repeats one. A failure before the pivot compensates the steps that ran, in reverse order,
 * and each compensation is a guarded write under a key of its own. Once the pivot has run, nothing is undone: the
 * remaining steps run forward, and a step that can't finish is handed to a person.
 *
 * The compensation log is the step records themselves. A step's key is fixed by the plan id and the step id, or by its
 * business key alone when it has one, and each record names the plan and step of the call that wrote it. So the
 * records of an interrupted plan, read in plan order, say which steps this plan ran, and a resumed plan compensates
 * exactly those, in reverse, once each. A step that another plan applied under the same business key is not undone. The one extra record is the plan's decision to compensate, which a resume reads first,
 * so a step that failed is never retried while its plan is half undone.
 *
 * The rules are our synthesis of the sagas report in docs/research/reversible-actions, not a vendor design.
 */
import { checkEffectScope, type EffectScope, effectKey } from "./effect-key.js";
import type { EffectRecord, EffectStore } from "./effect-store.js";
import { SafetyError } from "./errors.js";
import { guardedWrite, type WriteDedupe } from "./guarded-write.js";
import { canonicalInputHash } from "./hash.js";
import { type WriteOutcome, writeOutcome } from "./outcome.js";
import {
  checkedPlanApproval,
  type PlanApproval,
  type PlanLedger,
  type PlanStep,
  type PlanStepCheck,
  type StateRead,
  verifyPlanBeforeStep,
} from "./plan-approval.js";
import { type RenderedOutcome, renderOutcome } from "./render.js";
import type { ApprovalSigner } from "./signer.js";

/** One signed step as the host runs it: the step, its exact input and the calls that perform and undo it. */
export interface PlanStepImpl {
  /** The step as the approval signs it. Its id, tool, class and business key must match the signed step. */
  readonly step: PlanStep;
  /** The step's exact input. The approval signs its hash, and a different input is refused as not verified. */
  readonly input: unknown;
  /** How a retry of `run` finds out what an earlier attempt did, as for `guardedWrite()`. */
  readonly dedupe: WriteDedupe;
  /** Performs the step. Send `key` to the external API's idempotency header, or set it where `reconcile` can find it. */
  run(key: string): Promise<WriteOutcome>;
  /** Reads the external system's state for `run`'s key, as for `guardedWrite()`. */
  reconcile?(key: string): Promise<WriteOutcome | "not_found">;
  /**
   * Undoes the step, and returns an `applied` outcome once it has. Required for a `compensable` step and refused for
   * the others. It runs as a guarded write with its own key, so it must be idempotent under that key.
   */
  compensate?(key: string): Promise<WriteOutcome>;
  /** Reads the external system's state for `compensate`'s key, so a compensation that crashed can be checked. */
  reconcileCompensation?(key: string): Promise<WriteOutcome | "not_found">;
}

/** Where a plan runs: the tenant, session and branch its writes are keyed under. */
export type PlanScope = Omit<EffectScope, "toolCallId">;

/** The options of `runPlan()`. */
export interface RunPlanOptions {
  /** The signed plan approval, as `signPlan()` returned it. */
  readonly approval: unknown;
  /** The steps, in the order the approval signs them. */
  readonly steps: readonly PlanStepImpl[];
  /** Where the effect records live. Use a durable store wherever a plan must resume after a crash. */
  readonly store: EffectStore;
  /** The tenant, session and branch the plan's writes belong to. */
  readonly scope: PlanScope;
  /** A signer that holds the key the approval names. */
  readonly signer: ApprovalSigner;
  /** Where each step's claim is recorded. Use a durable ledger wherever a plan must resume after a crash. */
  readonly ledger: PlanLedger;
  /** Re-reads the approval's `stateReads` now, as for `verifyPlanBeforeStep()`. */
  readonly readState: (reads: readonly StateRead[]) => Promise<readonly unknown[]>;
  /**
   * A cancel. Checked before each step up to and including the pivot starts: a cancel then compensates the steps that
   * ran. Once the pivot has started it is ignored, and the plan runs forward.
   */
  readonly signal?: AbortSignal;
  /** How long a started write counts as live, in milliseconds, as for `guardedWrite()`. */
  readonly leaseMs?: number;
  /** Returns the current time. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

/** Why a plan that began could not finish. */
export type PlanFailureReason =
  | "STEP_FAILED"
  | "STEP_PARTIAL"
  | "STEP_UNKNOWN"
  | "CANCELLED"
  | "STALE_APPROVAL"
  | "EXPIRED"
  | "NOT_VERIFIED"
  | "COMPENSATION_FAILED"
  | "RETRY_REFUSED";

/**
 * What a plan did, computed by the harness and never by the model. `completed`: every step ran. `failed_compensated`:
 * a step failed and every step that had run was undone. `failed_needs_human`: something still holds that the harness
 * could not undo, listed in `outstanding`. `pending`: the plan has not finished; call `runPlan()` again, and tell the
 * user nothing final. The last three mean no step ran.
 */
export type PlanOutcome =
  | { readonly status: "completed"; readonly planId: string; readonly effects: readonly string[] }
  | {
      readonly status: "failed_compensated";
      readonly planId: string;
      readonly failedStep: string;
      readonly reason: PlanFailureReason;
      readonly undone: readonly string[];
      readonly next: string;
    }
  | {
      readonly status: "failed_needs_human";
      readonly planId: string;
      readonly failedStep: string;
      readonly reason: PlanFailureReason;
      readonly undone: readonly string[];
      /** The steps that took effect and still hold. */
      readonly held: readonly string[];
      /** What a person must finish or undo: the stopped step, the steps not run, and any step not undone. */
      readonly outstanding: readonly string[];
      readonly avoid: string;
    }
  | {
      readonly status: "pending";
      readonly planId: string;
      /** `running`: a step is in flight or waiting for a retry. `pivot_unknown`: the pivot's result is not known. */
      readonly phase: "running" | "pivot_unknown";
      readonly stepId: string;
    }
  | {
      readonly status: "stale_approval" | "expired" | "rejected";
      readonly planId: string;
      readonly reason: string;
    };

const FAILED_OPERATION = "plan_failed";

interface Run {
  readonly options: RunPlanOptions;
  readonly approval: PlanApproval;
  readonly now: () => Date;
}

function invalid(message: string): SafetyError {
  return new SafetyError("invalid_plan", message);
}

const label = (impl: PlanStepImpl): string => `${impl.step.id}: ${impl.step.summary}`;

/** Checks that the host's steps are the signed ones, in order, and that only compensable steps can be undone. */
function checkSteps(approval: PlanApproval, steps: readonly PlanStepImpl[]): void {
  if (steps.length !== approval.steps.length) {
    throw invalid(`runPlan got ${steps.length} steps for a plan that signs ${approval.steps.length}`);
  }
  for (const [index, impl] of steps.entries()) {
    const signed = approval.steps[index] as PlanStep;
    const step = impl.step;
    if (step.id !== signed.id || step.tool !== signed.tool || step.class !== signed.class) {
      throw invalid(`step ${index + 1} of runPlan is not the plan's signed step ${signed.id}`);
    }
    if (step.businessKey !== signed.businessKey)
      throw invalid(`step ${signed.id} has another business key than signed`);
    if (step.class === "compensable" && impl.compensate === undefined) {
      throw invalid(`step ${step.id} is compensable and needs a compensate function`);
    }
    if (step.class !== "compensable" && (impl.compensate !== undefined || impl.reconcileCompensation !== undefined)) {
      throw invalid(`step ${step.id} is ${step.class}, which can't be undone, so it takes no compensate function`);
    }
  }
}

function stepScope(run: Run, id: string, part: "run" | "compensate" | "failed"): EffectScope {
  const planId = run.approval.planId;
  const toolCallId = part === "run" ? `${planId}:${id}` : `${planId}:${id}:${part}`;
  return { ...run.options.scope, toolCallId };
}

const forwardKey = (run: Run, impl: PlanStepImpl) =>
  effectKey(stepScope(run, impl.step.id, "run"), impl.step.businessKey);

/** Runs one step, or its compensation, as a guarded write. */
function write(run: Run, impl: PlanStepImpl, part: "run" | "compensate"): Promise<WriteOutcome> {
  const { step } = impl;
  const forward = part === "run";
  const call = forward ? impl.run : (impl.compensate as PlanStepImpl["run"]);
  const reconcile = forward ? impl.reconcile : impl.reconcileCompensation;
  return guardedWrite<WriteOutcome>({
    store: run.options.store,
    scope: stepScope(run, step.id, part),
    ...(step.businessKey === undefined
      ? {}
      : { businessKey: forward ? step.businessKey : `${step.businessKey}:compensate` }),
    operation: forward ? step.tool : `${step.tool}:compensate`,
    input: impl.input,
    dedupe: forward ? impl.dedupe : "idempotency_key",
    run: (key) => call.call(impl, key),
    toOutcome: (outcome) => outcome,
    ...(reconcile === undefined ? {} : { reconcile: (key: string) => reconcile.call(impl, key) }),
    ...(run.options.leaseMs === undefined ? {} : { leaseMs: run.options.leaseMs }),
    now: () => run.now().getTime(),
  });
}

/** The state of one forward step, as a run or its records show it. */
type StepState =
  | { readonly kind: "applied" }
  | { readonly kind: "failed" }
  | { readonly kind: "partial" }
  | { readonly kind: "unknown"; readonly inProgress: boolean };

function stateOf(outcome: WriteOutcome): StepState {
  if (outcome.reason === "IN_PROGRESS") return { kind: "unknown", inProgress: true };
  switch (outcome.kind) {
    case "applied":
      return { kind: "applied" };
    case "partial":
      return { kind: "partial" };
    case "unknown":
      return { kind: "unknown", inProgress: false };
    default:
      // A write that was rejected, or that took effect and was undone by its own tool, left nothing behind.
      return { kind: "failed" };
  }
}

/** What stops a run: the step, why, and whether that step itself may have left effects that need a person. */
interface Stop {
  readonly index: number;
  readonly reason: PlanFailureReason;
  readonly leftEffects: boolean;
}

/** The plan's decision to compensate, kept as a settled record so a resume reads it before any step runs. */
async function writeDecision(run: Run, stop: Stop): Promise<Stop> {
  const impl = run.options.steps[stop.index] as PlanStepImpl;
  const outcome = writeOutcome({
    kind: stop.leftEffects ? "partial" : "not_applied",
    operation: FAILED_OPERATION,
    reason: stop.reason,
    retry: "never",
    next: "The plan stopped and is being undone.",
  });
  const scope = stepScope(run, "plan", "failed");
  const key = await effectKey(scope);
  const at = run.now().toISOString();
  const record: EffectRecord = {
    key,
    scope,
    businessKey: impl.step.id,
    operation: FAILED_OPERATION,
    inputHash: await canonicalInputHash({ plan: run.approval.planId }),
    attempt: 1,
    state: "settled",
    outcome,
    startedAt: at,
    leaseUntil: at,
    settledAt: at,
  };
  const claim = await run.options.store.begin(record);
  // The first decision wins, so two processes that disagree about a failed step both unwind for the same one.
  return claim === "started" ? stop : decisionOf(run, claim.existing);
}

function decisionOf(run: Run, record: EffectRecord): Stop {
  const index = run.options.steps.findIndex((impl) => impl.step.id === record.businessKey);
  const outcome = record.outcome as WriteOutcome;
  return {
    index: Math.max(index, 0),
    reason: outcome.reason as PlanFailureReason,
    leftEffects: outcome.kind === "partial",
  };
}

async function readDecision(run: Run): Promise<Stop | undefined> {
  const existing = await run.options.store.get(await effectKey(stepScope(run, "plan", "failed")));
  return existing === undefined || existing.outcome === undefined ? undefined : decisionOf(run, existing);
}

/** Undoes the steps that ran, last first, and stops at the first compensation that does not finish. */
async function unwind(run: Run, stop: Stop, undo: boolean): Promise<PlanOutcome> {
  const { steps } = run.options;
  const failed = steps[stop.index] as PlanStepImpl;
  const ran: PlanStepImpl[] = [];
  for (const impl of steps.slice(0, stop.index)) {
    const record = await run.options.store.get(await forwardKey(run, impl));
    // Only a step this plan ran is undone. With a business key, a step may have been applied by another plan, whose
    // record this plan reads, and undoing that effect is not this plan's to do.
    const own = record?.scope.toolCallId === stepScope(run, impl.step.id, "run").toolCallId;
    if (own && record?.state === "settled" && record.outcome?.kind === "applied" && impl.compensate !== undefined) {
      ran.push(impl);
    }
  }
  const undone: string[] = [];
  const left: string[] = [];
  let reason = stop.reason;
  for (const [position, impl] of ran.toReversed().entries()) {
    if (!undo) {
      left.push(label(impl));
      continue;
    }
    const outcome = await write(run, impl, "compensate");
    // Another process is undoing this step right now, so the unwind waits for it instead of failing.
    if (outcome.reason === "IN_PROGRESS") return pending(run, impl, "running");
    if (outcome.kind === "applied") {
      undone.push(label(impl));
      continue;
    }
    // The first compensation that fails stops the unwind: a step before it may depend on this one being undone.
    reason = "COMPENSATION_FAILED";
    left.push(...ran.toReversed().slice(position).map(label));
    break;
  }
  const outstanding = [...(stop.leftEffects ? [`${label(failed)} (may have taken effect)`] : []), ...left];
  if (outstanding.length === 0) {
    return {
      status: "failed_compensated",
      planId: run.approval.planId,
      failedStep: failed.step.id,
      reason,
      undone,
      next: `Tell the user the plan stopped at step ${failed.step.id} and everything that had run was undone.`,
    };
  }
  return {
    status: "failed_needs_human",
    planId: run.approval.planId,
    failedStep: failed.step.id,
    reason,
    undone,
    held: left,
    outstanding,
    avoid:
      "Do not say that the plan completed or failed cleanly, do not run any of its steps again, and do not undo anything yourself.",
  };
}

const VERDICT: Partial<Record<PlanStepCheck, PlanFailureReason>> = {
  stale_approval: "STALE_APPROVAL",
  expired: "EXPIRED",
};

/** Verifies a step that this plan has not started, and says how to stop when it fails. */
async function verify(
  run: Run,
  impl: PlanStepImpl,
): Promise<{ readonly stop?: PlanFailureReason; readonly check: PlanStepCheck }> {
  const { signer, ledger, readState, approval } = run.options;
  const call = { stepId: impl.step.id, tool: impl.step.tool, input: impl.input };
  const check = await verifyPlanBeforeStep(approval, call, { signer, ledger, readState, now: run.now });
  // A replay means this plan's earlier attempt passed every other check just now and claimed the step before it stopped.
  if (check === "ok" || check === "replayed") return { check };
  return { check, stop: VERDICT[check] ?? "NOT_VERIFIED" };
}

/** Says why nothing ran: a failed check before any step took effect. */
function notRun(run: Run, check: PlanStepCheck): PlanOutcome {
  const planId = run.approval.planId;
  if (check === "stale_approval")
    return {
      status: "stale_approval",
      planId,
      reason: "A value the plan was computed from has changed since it was approved.",
    };
  if (check === "expired")
    return { status: "expired", planId, reason: "The approval lapsed before the plan's first step ran." };
  return { status: "rejected", planId, reason: `The approval did not verify for this plan (${check}).` };
}

function pending(run: Run, impl: PlanStepImpl, phase: "running" | "pivot_unknown"): PlanOutcome {
  return { status: "pending", planId: run.approval.planId, phase, stepId: impl.step.id };
}

/** Hands a plan to a person from `index` on: the steps before it hold, and it and the steps after it are theirs. */
function handedOver(run: Run, index: number, reason: PlanFailureReason, maybeApplied: boolean): PlanOutcome {
  const { steps } = run.options;
  const outstanding = steps
    .slice(index)
    .map((later, offset) =>
      offset === 0 && maybeApplied ? `${label(later)} (may have taken effect)` : `${label(later)} (not run)`,
    );
  return {
    status: "failed_needs_human",
    planId: run.approval.planId,
    failedStep: (steps[index] as PlanStepImpl).step.id,
    reason,
    undone: [],
    held: steps.slice(0, index).map(label),
    outstanding,
    avoid:
      "Do not say that the plan completed, do not undo the steps that ran, and do not run these steps again as a new request.",
  };
}

/** The outcome of a failed or unfinished step after the pivot, where nothing can be undone. */
function afterPivot(run: Run, index: number, state: StepState, outcome: WriteOutcome): PlanOutcome {
  const impl = run.options.steps[index] as PlanStepImpl;
  // A step that may still succeed, or whose result a check can settle, is tried again by the next call.
  const retry = state.kind !== "partial" && (outcome.retry === "same_key" || outcome.retry === "reconcile_first");
  if (retry || (state.kind === "unknown" && state.inProgress)) return pending(run, impl, "running");
  const reason =
    state.kind === "partial" ? "STEP_PARTIAL" : state.kind === "unknown" ? "STEP_UNKNOWN" : "RETRY_REFUSED";
  return handedOver(run, index, reason, state.kind !== "failed");
}

/** What a step that ran or was already recorded came to. */
interface Done {
  readonly state: StepState;
  readonly outcome: WriteOutcome;
}

/** A step that did not run, and why; `check` is set when the approval's verification refused it. */
interface Halt {
  readonly stop: Stop;
  readonly check?: PlanStepCheck;
}

/**
 * The result a step's own settled record gives, or `undefined` when the step should run. A step this plan already
 * settled as failed is not run again before the pivot, because the plan is unwinding; after the pivot it runs again.
 * A step settled as unknown is never final: running it checks the earlier attempt with its `reconcile` hook.
 */
function settledResult(existing: EffectRecord, afterThePivot: boolean): Done | undefined {
  if (existing.state !== "settled" || existing.outcome === undefined) return undefined;
  const state = stateOf(existing.outcome);
  // An unknown record goes back through the guarded write, which reconciles it, whatever step it belongs to.
  if (state.kind === "unknown") return undefined;
  return state.kind === "applied" || !afterThePivot ? { state, outcome: existing.outcome } : undefined;
}

/** Applies a cancel and the approval's checks to a step this plan has not started. */
async function admit(run: Run, impl: PlanStepImpl, index: number, afterThePivot: boolean): Promise<Halt | undefined> {
  if (!afterThePivot && run.options.signal?.aborted === true) {
    return { stop: { index, reason: "CANCELLED", leftEffects: false } };
  }
  const verdict = await verify(run, impl);
  return verdict.stop === undefined
    ? undefined
    : { stop: { index, reason: verdict.stop, leftEffects: false }, check: verdict.check };
}

/** Runs one step: its own record if it has one, else the approval's checks and then the guarded write. */
async function forward(run: Run, index: number, pivotIndex: number): Promise<Done | Halt> {
  const impl = run.options.steps[index] as PlanStepImpl;
  const afterThePivot = pivotIndex >= 0 && index > pivotIndex;
  const existing = await run.options.store.get(await forwardKey(run, impl));
  if (existing?.scope.toolCallId === stepScope(run, impl.step.id, "run").toolCallId) {
    const settled = settledResult(existing, afterThePivot);
    if (settled !== undefined) return settled;
  } else {
    const halt = await admit(run, impl, index, afterThePivot);
    if (halt !== undefined) return halt;
  }
  const outcome = await write(run, impl, "run");
  return { state: stateOf(outcome), outcome };
}

/** Whether a stopped plan may undo the steps that ran: not when the pivot itself left effects behind. */
const canUndo = (run: Run, stop: Stop): boolean =>
  !(stop.leftEffects && run.options.steps[stop.index]?.step.class === "pivot");

/** A step the approval's checks or a cancel refused: nothing ran if it is the first, else the plan unwinds. */
async function halted(run: Run, halt: Halt, ranAny: boolean, pivotIndex: number): Promise<PlanOutcome> {
  if (!ranAny && halt.check !== undefined) return notRun(run, halt.check);
  // After the pivot nothing is undone, so a step the approval refuses there goes to a person with the rest.
  if (pivotIndex >= 0 && halt.stop.index > pivotIndex) return handedOver(run, halt.stop.index, halt.stop.reason, false);
  return unwind(run, await writeDecision(run, halt.stop), true);
}

/** A step that ran and did not apply: the plan waits, hands over, or unwinds, as the pivot decides. */
async function notApplied(run: Run, index: number, pivotIndex: number, result: Done): Promise<PlanOutcome> {
  const { state, outcome } = result;
  const impl = run.options.steps[index] as PlanStepImpl;
  if (pivotIndex >= 0 && index > pivotIndex) return afterPivot(run, index, state, outcome);
  if (state.kind === "unknown" && (state.inProgress || index === pivotIndex)) {
    return pending(run, impl, state.inProgress ? "running" : "pivot_unknown");
  }
  const reason: PlanFailureReason =
    state.kind === "failed" ? "STEP_FAILED" : state.kind === "partial" ? "STEP_PARTIAL" : "STEP_UNKNOWN";
  const stop = await writeDecision(run, { index, reason, leftEffects: state.kind !== "failed" });
  return unwind(run, stop, canUndo(run, stop));
}

async function runForward(run: Run): Promise<PlanOutcome> {
  const { steps } = run.options;
  const pivotIndex = run.approval.steps.findIndex((step) => step.class === "pivot");
  let ranAny = false;
  for (const index of steps.keys()) {
    const result = await forward(run, index, pivotIndex);
    if ("stop" in result) return halted(run, result, ranAny, pivotIndex);
    if (result.state.kind !== "applied") return notApplied(run, index, pivotIndex, result);
    ranAny = true;
  }
  return { status: "completed", planId: run.approval.planId, effects: steps.map(label) };
}

/**
 * Runs the approved plan, in order, and reports what is true afterwards. Call it again with the same approval to
 * resume a plan that stopped, crashed or came back `pending`: it reads the records, repeats no step, and carries on.
 *
 * - Before each step up to and including the pivot, the approval is verified, and a cancel stops the plan.
 * - A step that fails before the pivot unwinds the steps that ran, in reverse, and the pivot never runs.
 * - A pivot whose result is not known returns `pending` with `pivot_unknown`: nothing is undone, and nothing runs
 *   again under a fresh key. A later call reconciles it and, if it took effect, runs forward.
 * - After the pivot nothing is undone: a step that can't finish is retried, or handed to a person.
 *
 * It throws a `SafetyError`, code `invalid_plan`, when the steps are not the signed ones or a compensable step has no
 * `compensate`, and code `invalid_effect` for an empty scope field. A malformed or forged approval returns `rejected`.
 */
export async function runPlan(options: RunPlanOptions): Promise<PlanOutcome> {
  checkEffectScope({ ...options.scope, toolCallId: "plan" });
  const approval = await checkedPlanApproval(options.approval, options.signer);
  if (approval === undefined) {
    return {
      status: "rejected",
      planId: "unknown",
      reason: "The approval is malformed, or its signature does not verify.",
    };
  }
  checkSteps(approval, options.steps);
  const run: Run = { options, approval, now: options.now ?? (() => new Date()) };
  const decided = await readDecision(run);
  return decided === undefined ? runForward(run) : unwind(run, decided, canUndo(run, decided));
}

/**
 * The write outcome a plan outcome stands for, in the five kinds the model already reads: `completed` is `applied`,
 * `failed_compensated` is `compensated`, `failed_needs_human` is `partial`, `pending` is `unknown`, and the three
 * statuses that mean no step ran are `not_applied`.
 */
export function planWriteOutcome(outcome: PlanOutcome): WriteOutcome {
  const operation = "run_plan";
  switch (outcome.status) {
    case "completed":
      return writeOutcome({
        kind: "applied",
        operation,
        applied: outcome.effects,
        next: "Tell the user the plan completed.",
      });
    case "failed_compensated":
      return writeOutcome({
        kind: "compensated",
        operation,
        reverted: outcome.undone,
        reason: outcome.reason,
        currentState: `The plan stopped at step ${outcome.failedStep}, and every step that had run was undone.`,
        next: outcome.next,
      });
    case "failed_needs_human":
      return writeOutcome({
        kind: "partial",
        operation,
        applied: outcome.held,
        reverted: outcome.undone,
        reason: outcome.reason,
        retry: "never",
        currentState: `The plan stopped at step ${outcome.failedStep}. A person must handle: ${outcome.outstanding.join("; ")}.`,
        next: "Tell the user a person must finish or undo the plan, and say which steps are still in effect.",
        avoid: outcome.avoid,
      });
    case "pending":
      return writeOutcome({
        kind: "unknown",
        operation,
        retry: outcome.phase === "pivot_unknown" ? "reconcile_first" : "never",
        reason: outcome.phase === "pivot_unknown" ? "PIVOT_UNKNOWN" : "PLAN_RUNNING",
        currentState:
          outcome.phase === "pivot_unknown"
            ? `It is not known whether step ${outcome.stepId}, the point of no return, took effect.`
            : `The plan is still running at step ${outcome.stepId}.`,
        next:
          outcome.phase === "pivot_unknown"
            ? "Tell the user the plan is waiting on a check, and do not say it failed."
            : "Tell the user the plan is still running, and wait for its result.",
      });
    default:
      return writeOutcome({
        kind: "not_applied",
        operation,
        retry: "new_operation_only",
        reason: outcome.status === "rejected" ? "NOT_VERIFIED" : outcome.status.toUpperCase(),
        currentState: outcome.reason,
        next: "Tell the user the plan did not run, and ask for a new approval if they still want it.",
      });
  }
}

/** Renders a plan outcome for the model: `planWriteOutcome()` through `renderOutcome()`. */
export function renderPlanOutcome(outcome: PlanOutcome): RenderedOutcome {
  return renderOutcome(planWriteOutcome(outcome));
}
