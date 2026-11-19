/**
 * The hook types: six interceptors that can change a run, and the observer that only watches it. Each interceptor
 * takes one event object and returns a replacement, never mutating its input, because the event's data is frozen.
 */
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  Model,
  ModelCallOptions,
  ModelContext,
  ModelRef,
  Usage,
} from "@buildanagent/gateway";
import type { AgentEvent } from "./events.js";
import type { ToolResult } from "./tools/types.js";

/** A value or a promise of one: a hook may be a plain function or an `async` one. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * A value, or nothing: what a hook that may change something returns. `void` lets an `async` hook that has nothing
 * to change simply end, where `undefined` would force it to return explicitly.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: a hook's return type, where void lets a function return nothing
export type OrNothing<T> = T | void;

/** The options of one model call, without the abort signal, which the run supplies. */
export type CallOptions = Omit<ModelCallOptions, "signal">;

/** The fields every hook event carries. */
export interface HookEventBase {
  /** The run's id. */
  readonly runId: string;
  /** The index of the model call the hook belongs to, counted from 0. */
  readonly stepIndex: number;
  /** The tool call's id, for the two tool hooks; absent for the others. */
  readonly callId?: string;
  /** The run's abort signal. Pass it on to any I/O the hook does. */
  readonly signal: AbortSignal;
  /** When the hook was called, from the run's clock, in ISO 8601. */
  readonly timestamp: string;
}

/** What `transformContext` receives: the conversation as it stands before the model call. */
export interface ContextEvent extends HookEventBase {
  /** The system prompt. */
  readonly system: string;
  /** The whole conversation so far, never a view an earlier call's transform returned. */
  readonly messages: readonly Message[];
  /** The model the run was started with. */
  readonly model: ModelRef;
  /** The previous model call's usage. Absent on the first call. */
  readonly lastUsage?: Usage;
}

/** What `beforeModelCall` receives: the request about to be sent. */
export interface ModelCallEvent extends HookEventBase {
  /** The request: the system prompt, the messages `transformContext` returned and the tools this call sends. */
  readonly context: ModelContext;
  /** The options of this call, without the abort signal. */
  readonly options: CallOptions;
}

/** What `afterModelCall` receives: the model's finished response. */
export interface ModelResultEvent extends HookEventBase {
  /** The response, including a failed one, whose `stopReason` is `"error"`. */
  readonly message: AssistantMessage;
}

/** What `beforeToolCall` receives: a call whose input has passed the tool's schema. */
export interface ToolCallEvent extends HookEventBase {
  readonly callId: string;
  /** The tool's name. */
  readonly tool: string;
  /** The validated input. */
  readonly input: unknown;
}

/** What `afterToolCall` receives: the result of a call that executed, before the model reads it. */
export interface ToolResultEvent extends ToolCallEvent {
  readonly result: ToolResult;
}

/** What `shouldStop` receives, after a step's tool calls have their results. */
export interface StepEvent extends HookEventBase {
  /** The whole conversation so far, including this step's response and tool results. */
  readonly messages: readonly Message[];
  /** This step's model response. */
  readonly lastMessage: AssistantMessage;
}

/**
 * Changes to one model call's request. Every field is optional, and a change applies to that call only; the next
 * call starts again from the run's own settings.
 */
export interface ModelCallPatch {
  /** Replaces the system prompt for this call. */
  readonly system?: string;
  /** Replaces the messages sent for this call. The run's own transcript keeps its messages. */
  readonly messages?: readonly Message[];
  /**
   * The names of the tools to send, as the complete list: a tool left out is not sent, and a tool whose `exposure`
   * is `deferred` or `hidden` is sent when named. Tools always go out in definition order, whatever order this list
   * is in. A name that matches no tool throws an `SdkError` with code `invalid_hook_result`. A call to a tool that
   * was not sent gets the unknown-tool error.
   */
  readonly activeTools?: readonly string[];
  /** Makes this call with another model. */
  readonly model?: Model;
  /** Replaces the options of this call. */
  readonly options?: CallOptions;
}

/**
 * What `beforeToolCall` decides. `allow` runs the call, with `input` in place of the model's when given; the
 * replacement must pass the tool's schema. `deny` blocks the call, and the model reads the `reason`. `ask` pauses
 * the call for a person: the run signs a pending request for it with the run's `signer`, and ends
 * `awaiting_approval` once the step's other calls have their results, or, under `blockingApprovals()`, waits for the
 * handler's answer. `reason` is shown to the approver and isn't
 * signed; `policyVersion` is signed. An `ask` may carry an `input`, which must pass the tool's schema like an
 * `allow`'s: the request is then signed over it, because it is the input the call would run with once approved.
 * `composeInterceptors()` passes an earlier gate's replacement on this way when a later gate asks.
 */
export type GateDecision =
  | { readonly decision: "allow"; readonly input?: unknown; readonly reason?: string }
  | { readonly decision: "deny"; readonly reason: string }
  | { readonly decision: "ask"; readonly input?: unknown; readonly reason?: string; readonly policyVersion?: string };

/**
 * Changes to a tool's result. Each field present replaces the result's own. A replaced `outcome` is not available
 * here: a write's outcome is rendered into `content` once, so replace `content` instead.
 */
export type ToolResultPatch = Partial<Omit<ToolResult, "outcome">>;

/**
 * What `shouldStop` decides. `true` or `{ stop: "hook" }` ends the run `stopped`, with the reason as `stoppedBy`
 * (`"hook"` for `true`). `{ stop: "no_progress" }` ends it `no_progress`. `{ continue }` keeps a run going that the
 * model ended by answering in text, adding the content as a user message. When the model's step called tools, the run goes on anyway and the content is
 * not added, so a hook that must reach the model should return it after a text answer. `false` leaves the decision to the run.
 */
export type StopDecision =
  | boolean
  | { readonly continue: string | readonly ContentBlock[] }
  | { readonly stop: "no_progress" | "hook"; readonly reason: string };

/**
 * The six interceptors, in the order a step calls them: `transformContext`, `beforeModelCall`, the model call,
 * `afterModelCall`, then for each tool call `beforeToolCall` and `afterToolCall`, and last `shouldStop`. A run takes
 * one object; `composeInterceptors()` joins several. Each hook may be `async`.
 */
export interface Interceptors {
  /**
   * Returns the messages to send for this model call, such as a masked or summarised view of a long conversation.
   * The view reaches that call's request only: the next call's event, `result.messages` and `result.context` hold
   * the full history. Each call emits a `context_transformed` event with the message counts.
   */
  readonly transformContext?: (e: ContextEvent) => MaybePromise<readonly Message[]>;
  /** Changes the request about to be sent. Return nothing to leave it as it is. */
  readonly beforeModelCall?: (e: ModelCallEvent) => MaybePromise<OrNothing<ModelCallPatch>>;
  /**
   * Replaces the model's response. The transcript and the `model_call_end` event hold the replacement, and its tool
   * calls are the ones that run. The call's usage and cost stay those of the model's own response. If it throws
   * while the run fails closed, both hold an empty stand-in with `stopReason: "error"` and that usage and cost.
   */
  readonly afterModelCall?: (e: ModelResultEvent) => MaybePromise<OrNothing<{ readonly message?: AssistantMessage }>>;
  /**
   * The gate: decides whether a tool call runs, once for each call that passed validation, one call at a time in
   * model order, and before any call of the step executes. With no `beforeToolCall`, no gate stands in the way and
   * every registered tool is allowed. A gate that returns `ask` pauses the call, and the run ends `awaiting_approval`
   * with a signed pending request for it. A gate that throws denies the call unless `onFailure` is `"continue"`. A gate must return a
   * decision: returning nothing throws an `SdkError` with code `invalid_hook_result`.
   */
  readonly beforeToolCall?: (e: ToolCallEvent) => MaybePromise<GateDecision>;
  /**
   * Replaces fields of a result before the model reads it, and before `tool_call_end` reports it. It runs for calls
   * that executed, including ones whose `execute` threw, and not for calls that never ran, such as an unknown tool,
   * invalid input or a denied call. Return nothing to keep the result.
   */
  readonly afterToolCall?: (e: ToolResultEvent) => MaybePromise<OrNothing<ToolResultPatch>>;
  /** Ends the run, or keeps it going, after a step. It is not asked once the run has a stop reason of its own. */
  readonly shouldStop?: (e: StepEvent) => MaybePromise<StopDecision>;
  /**
   * What a hook that throws does. `"fail_closed"` (the default) stops the unsafe thing: a failed `beforeToolCall`
   * denies the call, a failed `afterToolCall` withholds the result, and a failed model-moment hook or `shouldStop`
   * ends the run with `stopReason: "error"` and `error.kind: "hook"`. `"continue"` skips the failed hook and goes on
   * as if it had returned nothing. Either way the run emits a `hook_error` event.
   */
  readonly onFailure?: "fail_closed" | "continue";
}

/**
 * Watches a run: called with each event, in order, and never able to change the run. A promise it returns is waited
 * for before the next event is delivered to it. A throw or a rejection becomes a `hook_error` event.
 */
export type Observer = (event: AgentEvent) => MaybePromise<void>;
