/**
 * The events a run streams: one closed union in two layers (agent-SDK guide §5). The delta layer streams each content
 * block by its index; the item layer's end events (`model_call_end`, `tool_call_end`, `run_end`) carry the
 * authoritative item, which a session log stores. `AGENT_EVENT_TYPES` lists the union at run time, so a test can
 * check that the loop emits no type the union does not declare.
 */
import type { AssistantMessage, ContentBlock, DumpedOptions, ModelContext, ModelRef } from "@buildanagent/gateway";
import type { RunError, RunResult } from "./result.js";
import type { DeliveryReceipt } from "./steering.js";
import type { ToolResult } from "./tools/types.js";
import type { RejectionCause, SignedPendingRequest } from "./vendor/agent-safety/pending.js";

/** The fields every event carries. `seq` counts the run's events from 0; `stepIndex` counts its model calls from 0. */
export interface EventBase {
  readonly runId: string;
  readonly seq: number;
  readonly stepIndex: number;
  /** When the event was emitted, from the run's clock, in ISO 8601. */
  readonly timestamp: string;
}

/** One model call's request as the loop sends it: the model, the context and the options. */
export interface ModelCallRequest {
  readonly model: ModelRef;
  readonly context: ModelContext;
  readonly options: DumpedOptions;
}

/**
 * Why a `warning` event fired. `max_steps`: the run reached `maxSteps` and stopped. `model_warning`: the model call
 * reported something that did not stop it, such as an option the provider would reject and the adapter dropped.
 */
export type WarningCode = "max_steps" | "model_warning";

/**
 * Why `continueRun()` refused a resolution or a stored request: one of `verifyResolution()`'s causes, `replayed` when
 * two resolutions name one request, or `error` when the check itself threw, such as a signer whose `verify()` threw.
 * `unknown_request` also covers a resolution that names no request in the context.
 */
export type ResolutionRejectionCause = RejectionCause | "replayed" | "error";

/** The body of each event, without the fields of `EventBase`. */
export type AgentEventBody =
  | {
      readonly type: "run_start";
      readonly sdkVersion: string;
      readonly specVersion: "v1";
      /** Reserved for a hash of the run's defaults; empty for now. */
      readonly defaultsHash: string;
      /** Reserved for the SDK's capability names; empty for now. */
      readonly capabilities: readonly string[];
      readonly model: ModelRef;
    }
  | { readonly type: "run_end"; readonly result: RunResult }
  /** Fires once nothing is running any more, retries and tools included; `run_end` follows it. */
  | { readonly type: "agent_settled" }
  | { readonly type: "step_start" }
  | { readonly type: "step_end"; readonly stopCheck: "continue" | "stop" }
  | { readonly type: "model_call_start"; readonly request: ModelCallRequest }
  | { readonly type: "model_call_end"; readonly message: AssistantMessage }
  | { readonly type: "text_start" | "reasoning_start" | "tool_input_start"; readonly index: number }
  | {
      readonly type: "text_delta" | "reasoning_delta" | "tool_input_delta";
      readonly index: number;
      readonly delta: string;
    }
  | {
      readonly type: "text_end" | "reasoning_end" | "tool_input_end";
      readonly index: number;
      readonly block: ContentBlock;
    }
  | { readonly type: "tool_call_start"; readonly callId: string; readonly tool: string; readonly input: unknown }
  | { readonly type: "tool_call_update"; readonly callId: string; readonly details: unknown }
  /**
   * `result` is what the model reads for the call, after `afterToolCall` has had its say. `input` is present only
   * when a `beforeToolCall` gate replaced the model's input, and holds the input the gate gave the call instead.
   */
  | {
      readonly type: "tool_call_end";
      readonly callId: string;
      readonly result: ToolResult;
      readonly input?: unknown;
    }
  /** `transformContext` returned the messages for one model call: `before` messages in, `after` messages out. */
  | { readonly type: "context_transformed"; readonly before: number; readonly after: number }
  /**
   * A failed model call is being retried; `attempt` is 1 for the first retry. `layer` says which retry it is.
   * `gateway`: the model retries an HTTP request that failed before any output. Its events follow `model_call_start`,
   * and the failed attempt streamed no output, only any `raw` events, which this event supersedes. `turn`: the loop
   * re-issues a call that ended with a `retryable` error, which `turnRetries` turns on. This event comes right after
   * that call's `model_call_end`, whose message is superseded: it is not in the transcript. A UI that rendered the
   * call's streamed deltas or kept its `raw` events should discard them, because the retry streams its own. Once the
   * wait ends, the failed call's `step_end` follows, then the retry's own `step_start` and `model_call_start` at the
   * next `stepIndex`.
   */
  | {
      readonly type: "retry";
      readonly layer: "gateway" | "turn";
      readonly attempt: number;
      readonly delayMs: number;
      readonly error: string;
    }
  /**
   * One event of the provider's own stream, emitted only when the run set `includeRaw`. `event` is the gateway's
   * `raw` payload, unchanged: for the Anthropic and OpenAI Chat adapters, `{ event, data }`, one server-sent event
   * with its data unparsed. Its shape is the provider's and outside the SDK's versioning. Raw events come between a
   * call's `model_call_start` and its `model_call_end`, each before the delta events it produced; those of an
   * attempt the gateway retried come before that `retry` event and are superseded by it. They hold the model's
   * output and provider metadata, so keep them out of logs you would keep content out of.
   */
  | { readonly type: "raw"; readonly event: unknown }
  /**
   * A queued steer or follow-up entered the transcript as a user message, at the start of the step named by
   * `receipt.stepIndex`, before its model call. `receipt.kind` tells the two apart.
   */
  | { readonly type: "steer_applied"; readonly receipt: DeliveryReceipt }
  /**
   * The run signed a pending request for a call that waits for a person; `request.kind` tells the two kinds apart.
   * An `approval`: a gate returned `ask`. `input` is the input the request signs and the call would run with once
   * approved: the model's input after coercion, `repair` and any gate's replacement, so show the approver this, not
   * the model's raw arguments. It comes once every call of the step has been gated, after the call's
   * `tool_call_start` and before any call of the step runs; under `blockingApprovals()` it comes before the run waits
   * for the answer. A `clarification`: a tool asked the user `request.question`, and `input` is the input it ran
   * with; it comes once every call of the step has its result. A waiting call gets no `tool_call_end`, and the run
   * ends `awaiting_approval` or `clarification_requested` after the step.
   */
  | { readonly type: "approval_request"; readonly request: SignedPendingRequest; readonly input: unknown }
  /**
   * `continueRun()` refused a resolution, or a stored request it had to check: the call did not run, and unless the
   * resolution named no request in the context, the call asks again with a new request, which an `approval_request`
   * event follows. `requestId` is the id the resolution or the stored request gave, and `callId` the waiting call's,
   * when there is one. It holds no signature and no key.
   */
  | {
      readonly type: "resolution_rejected";
      readonly requestId: string;
      readonly callId?: string;
      readonly cause: ResolutionRejectionCause;
    }
  /**
   * An interceptor or an observer threw, a pause could not be signed, or a `sleep` passed to `run()` rejected. `hook`
   * names it (`beforeToolCall`, `observer`, `signer`, `sleep` and so on) and `error` is the thrown message; for
   * `signer` it is a fixed text with the safety package's error code, never the signer's own message. The run goes on
   * or fails by the interceptors' `onFailure` setting; a failed observer never affects it, a call whose pause could
   * not be signed is blocked, and a rejected `sleep` ends the wait before a turn retry early.
   */
  | { readonly type: "hook_error"; readonly hook: string; readonly error: string }
  | { readonly type: "warning"; readonly code: WarningCode; readonly detail: string }
  | { readonly type: "error"; readonly error: RunError }
  | { readonly type: "abort"; readonly reason?: string };

/** One event of a run. Switch on `type`: the union is closed, so a `switch` over it can be exhaustive. */
export type AgentEvent = EventBase & AgentEventBody;

/** Every `AgentEvent` type. A run emits no type this list lacks. */
export const AGENT_EVENT_TYPES = Object.freeze([
  "run_start",
  "step_start",
  "model_call_start",
  "retry",
  "raw",
  "text_start",
  "text_delta",
  "text_end",
  "reasoning_start",
  "reasoning_delta",
  "reasoning_end",
  "tool_input_start",
  "tool_input_delta",
  "tool_input_end",
  "warning",
  "model_call_end",
  "context_transformed",
  "hook_error",
  "steer_applied",
  "tool_call_start",
  "approval_request",
  "resolution_rejected",
  "tool_call_update",
  "tool_call_end",
  "step_end",
  "error",
  "abort",
  "agent_settled",
  "run_end",
] as const satisfies readonly AgentEvent["type"][]);
