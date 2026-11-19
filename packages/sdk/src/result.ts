/**
 * What a run returns: a union discriminated by `stopReason`, in which only the `done` variant carries `output`, so
 * code that reads the output without checking the stop reason fails to compile (D10). Every variant carries the
 * usage, the cost and a context the run can continue from.
 */
import type { AssistantMessage, Cost, Message, Usage } from "@buildanagent/gateway";

/**
 * A run's conversation as plain JSON: the system prompt and every message so far. Store it anywhere and pass it to
 * `continueRun()` to go on from where the run stopped.
 */
export interface Context {
  readonly system: string;
  readonly messages: readonly Message[];
}

/** Why a model call failed, copied from the failed message's `error`. */
export interface RunError {
  /**
   * `overflow`: the request was larger than the model's context window. `quota`: the account is out of quota or
   * credit. `retryable`: a temporary failure that outlasted the model's retries. `fatal`: any other failure, such as a
   * rejected request. `hook`: an interceptor threw while the run fails closed, and `message` says which one.
   */
  readonly kind: NonNullable<AssistantMessage["error"]>["kind"] | "hook";
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

/** A run that a `shouldStop` hook ended with `{ stop: "no_progress" }`, which gave `reason`. */
export interface NoProgressResult extends ResultBase {
  readonly stopReason: "no_progress";
  readonly reason: string;
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

/** What a run returns. Check `stopReason` before you read the fields of one variant. */
export type RunResult<S = unknown> = DoneResult<S> | EndedResult | ErrorResult | NoProgressResult | StoppedResult;

/** Every run result except `done`, which `runOrThrow()` turns into a `RunStoppedError`. */
export type UnfinishedResult = Exclude<RunResult, DoneResult<unknown>>;
