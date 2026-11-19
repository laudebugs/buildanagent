/**
 * The events a run streams: one closed union in two layers (agent-SDK guide §5). The delta layer streams each content
 * block by its index; the item layer's end events (`model_call_end`, `tool_call_end`, `run_end`) carry the
 * authoritative item, which a session log stores. `AGENT_EVENT_TYPES` lists the union at run time, so a test can
 * check that the loop emits no type the union does not declare.
 */
import type { AssistantMessage, ContentBlock, DumpedOptions, ModelContext, ModelRef } from "@buildanagent/gateway";
import type { RunError, RunResult } from "./result.js";
import type { ToolResult } from "./tools/types.js";

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
  /** `result` is what the model reads for the call. */
  | { readonly type: "tool_call_end"; readonly callId: string; readonly result: ToolResult }
  /** The model is retrying a failed request; `attempt` is 1 for the first retry. */
  | { readonly type: "retry"; readonly attempt: number; readonly delayMs: number; readonly error: string }
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
  "tool_call_start",
  "tool_call_update",
  "tool_call_end",
  "step_end",
  "error",
  "abort",
  "agent_settled",
  "run_end",
] as const satisfies readonly AgentEvent["type"][]);
