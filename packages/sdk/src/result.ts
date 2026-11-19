/**
 * What a run returns: a union discriminated by `stopReason`, in which only the `done` variant carries `output`, so
 * code that reads the output without checking the stop reason fails to compile (D10). Every variant carries the
 * usage, the cost and a context the run can continue from.
 */
import type { AssistantMessage, Cost, Message, Usage } from "@buildanagent/gateway";
import type { SignedPendingRequest } from "./vendor/agent-safety/pending.js";

/**
 * A run's conversation as plain JSON: the system prompt, every message so far and, for a run that paused, the signed
 * requests it waits on. Store it anywhere and pass it to `continueRun()` to go on from where the run stopped.
 */
export interface Context {
  readonly system: string;
  readonly messages: readonly Message[];
  /**
   * The signed requests of a run that ended `awaiting_approval`, the same ones as `result.pending`. Each one's tool
   * call is in `messages` without a result. Absent for every other stop reason.
   */
  readonly pending?: readonly SignedPendingRequest[];
  /**
   * The input each pending request signs, by request id: the input its call would run with once approved, after
   * coercion, `repair` and any gate's replacement, which can differ from the call's arguments in `messages`. Show
   * the approver this input, and check an answer against it. Absent when `pending` is.
   */
  readonly pendingInputs?: Readonly<Record<string, unknown>>;
}

/** Why a model call failed, copied from the failed message's `error`. */
export interface RunError {
  /**
   * `overflow`: the request was larger than the model's context window. `quota`: the account is out of quota or
   * credit. `retryable`: a temporary failure that outlasted the model's retries. `fatal`: any other failure, such as a
   * rejected request. `hook`: an interceptor threw while the run fails closed, and `message` says which one.
   * `unknown_price`: the run has a `budgetUsd`, but a price it needs is unknown, so it can't check the spend.
   */
  readonly kind: NonNullable<AssistantMessage["error"]>["kind"] | "hook" | "unknown_price";
  readonly message: string;
  /** The provider's HTTP status, when the failure came with one. */
  readonly status?: number;
}

/** The fields every run result carries. */
export interface ResultBase {
  /** The messages this run added: the input, if any, then every response and tool result, in order. */
  readonly messages: readonly Message[];
  /** The whole conversation, earlier history included, ready for `continueRun()`. */
  readonly context: Context;
  /** The tokens of every model call, summed. */
  readonly usage: Usage;
  /**
   * The cost of every model call, summed. It is unknown if any call's cost is. A run that made no call costs an exact
   * 0 with basis `provider`, so adding it to another cost keeps that cost's basis.
   */
  readonly cost: Cost;
  /** How many model calls the run made. */
  readonly steps: number;
}

/**
 * A run that finished: the model answered without calling a tool, or an output tool accepted its answer. `output` is
 * the accepted answer, and `undefined` when the run has no output tool, the model answered in text, or another tool
 * ended the run with `terminate: true`. A text
 * answer cut off at the output limit also ends `done`; its message's `stopReason` is then `"length"`.
 */
export interface DoneResult<S> extends ResultBase {
  readonly stopReason: "done";
  readonly output: S | undefined;
}

/**
 * A run that ended before it finished. `max_steps`: it made `maxSteps` model calls and the model still wanted to
 * continue. `aborted`: it was aborted.
 */
export interface EndedResult extends ResultBase {
  readonly stopReason: "max_steps" | "aborted";
}

/**
 * A run that stopped making progress. The default progress policy ends a run this way after 3 identical failing tool
 * calls in a row, or after 5 failing calls to a tool with one `progressKey`; pass `progress` to `run()` to change the
 * thresholds, or `progress: false` to turn the policy off. A `shouldStop` hook that returns `{ stop: "no_progress" }`
 * ends a run this way too. `reason` says which rule or hook fired.
 */
export interface NoProgressResult extends ResultBase {
  readonly stopReason: "no_progress";
  readonly reason: string;
}

/**
 * A run that ended before a model call because that call could have taken the spend past `budgetUsd`. `spentUsd` is
 * what the run's earlier calls cost, and `projectedUsd` the most the refused call could have cost.
 */
export interface BudgetResult extends ResultBase {
  readonly stopReason: "budget";
  readonly reason: string;
  readonly budgetUsd: number;
  readonly spentUsd: number;
  readonly projectedUsd: number;
}

/** A run that ended because a model call failed, or because an interceptor failed while the run fails closed. */
export interface ErrorResult extends ResultBase {
  readonly stopReason: "error";
  readonly error: RunError;
}

/**
 * A run that stopped before it finished, for a reason `stoppedBy` names. `clarification`: a tool from
 * `clarificationTool()` asked the user a question. Any other value is the `reason` a `shouldStop` hook gave, or
 * `"hook"` when it returned `true`. To go on, add the answer to `context` as a user message and pass the
 * context to `continueRun()`.
 */
export interface StoppedResult extends ResultBase {
  readonly stopReason: "stopped";
  readonly stoppedBy: string;
}

/**
 * A run that paused because a `beforeToolCall` gate returned `ask`. `pending` holds one signed request for each call
 * that waits, in model order; `context.pending` holds the same requests and `context.pendingInputs` the input each
 * one signs. Those calls did not run and have no result in the transcript; the step's other calls ran or were denied
 * as usual. Each request's signature covers its id, kind, call id, tool, input hash and policy version, so store the
 * requests and their inputs with the context, show them to a person, and check each answer against its request and
 * input before the call runs.
 */
export interface AwaitingApprovalResult extends ResultBase {
  readonly stopReason: "awaiting_approval";
  readonly pending: readonly SignedPendingRequest[];
}

/** What a run returns. Check `stopReason` before you read the fields of one variant. */
export type RunResult<S = unknown> =
  | DoneResult<S>
  | AwaitingApprovalResult
  | BudgetResult
  | EndedResult
  | ErrorResult
  | NoProgressResult
  | StoppedResult;

/** Every run result except `done`, which `runOrThrow()` turns into a `RunStoppedError`. */
export type UnfinishedResult = Exclude<RunResult, DoneResult<unknown>>;
