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
   * rejected request.
   */
  readonly kind: NonNullable<AssistantMessage["error"]>["kind"];
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
  /** The cost of every model call, summed. It is unknown if any call's cost is. */
  readonly cost: Cost;
  /** How many model calls the run made. */
  readonly steps: number;
}

/** A run that finished. `output` is the final answer's value when the run has an output tool. */
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

/** A run that ended because a model call failed. */
export interface ErrorResult extends ResultBase {
  readonly stopReason: "error";
  readonly error: RunError;
}

/** A run that your own stop check ended. `stoppedBy` is the reason it gave. */
export interface StoppedResult extends ResultBase {
  readonly stopReason: "stopped";
  readonly stoppedBy: string;
}

/** What a run returns. Check `stopReason` before you read the fields of one variant. */
export type RunResult<S = unknown> = DoneResult<S> | EndedResult | ErrorResult | StoppedResult;

/** Every run result except `done`, which `runOrThrow()` turns into a `RunStoppedError`. */
export type UnfinishedResult = Exclude<RunResult, DoneResult<unknown>>;
