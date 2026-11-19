/**
 * `@buildanagent/sdk`: the agent loop over `@buildanagent/gateway`. This entry holds the loop (`run()`,
 * `continueRun()`, `runOrThrow()`), its events and results, the tools (their definitions, schemas, results and write
 * outcomes) and the hooks: six interceptors that can change a run and observers that only watch it. The loop also
 * holds the run's guards: a USD budget checked before each call, progress detection and a depth cap. A caller can steer a running agent or queue a follow-up, both applied at step boundaries. Signed pauses are
 * planned in the SDK plan §3.3.
 */
// Re-exported so a caller that calls `Model.complete()` outside the loop projects a cost with the loop's own formula.
export { projectCallCost } from "@buildanagent/gateway";
export { composeInterceptors } from "./compose.js";
export { isSdkError, RunStoppedError, SdkError, type SdkErrorCode } from "./errors.js";
export {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventBody,
  type EventBase,
  type ModelCallRequest,
  type WarningCode,
} from "./events.js";
export type {
  CallOptions,
  ContextEvent,
  GateDecision,
  HookEventBase,
  Interceptors,
  MaybePromise,
  ModelCallEvent,
  ModelCallPatch,
  ModelResultEvent,
  Observer,
  OrNothing,
  StepEvent,
  StopDecision,
  ToolCallEvent,
  ToolResultEvent,
  ToolResultPatch,
} from "./hooks.js";
export { DEFAULT_PROGRESS, type ProgressPolicy } from "./progress.js";
export type {
  BudgetResult,
  Context,
  DoneResult,
  EndedResult,
  ErrorResult,
  NoProgressResult,
  ResultBase,
  RunError,
  RunResult,
  StoppedResult,
  UnfinishedResult,
} from "./result.js";
export { continueRun, nestedRunDepth, type Run, type RunInput, type RunOptions, run, runOrThrow } from "./run.js";
export type { DeliveryKind, DeliveryReceipt } from "./steering.js";
export {
  type ClarificationToolOptions,
  clarificationTool,
  defineTool,
  type OutputToolOptions,
  outputTool,
} from "./tools/define.js";
export type {
  JsonSchema,
  SchemaIssue,
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolEffect,
  ToolExecutionMode,
  ToolExposure,
  ToolFailure,
  ToolResult,
  ToolSchema,
} from "./tools/types.js";
export type { WriteOutcome } from "./vendor/agent-safety/outcome.js";

/** The package's name, `@buildanagent/sdk`. */
export const SDK_PACKAGE = "@buildanagent/sdk";
