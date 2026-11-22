/**
 * `@buildanagent/sdk`: the agent loop over `@buildanagent/gateway`. This entry holds the loop (`run()`,
 * `continueRun()`, `runOrThrow()`), its events and results, the tools (their definitions, schemas, results and write
 * outcomes) and the hooks: six interceptors that can change a run and observers that only watch it. The loop also
 * holds the run's guards: a USD budget checked before each call, progress detection and a depth cap. A caller can
 * steer a running agent or queue a follow-up, both applied at step boundaries. A gate that asks for a person, or a
 * tool that asks the user a question, ends the run with a signed pending request, which `continueRun()` resumes with
 * resolutions, in this process or another; `blockingApprovals()` answers approvals inside the run instead. The
 * signers, the input hash, the pending record and its check are the safety package's, re-exported unchanged.
 *
 * @module @buildanagent/sdk
 */
// Re-exported so a caller that calls `Model.complete()` outside the loop projects a cost with the loop's own formula.
export { projectCallCost } from "@buildanagent/gateway";
export { CAPABILITIES } from "./capabilities.js";
export { composeInterceptors } from "./compose.js";
export { DEFAULTS_HASH } from "./defaults.js";
export { isSdkError, RunStoppedError, SdkError, type SdkErrorCode } from "./errors.js";
export {
  AGENT_EVENT_TYPES,
  type AgentEvent,
  type AgentEventBody,
  type EventBase,
  type ModelCallRequest,
  type ResolutionRejectionCause,
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
  ModelCallStop,
  ModelResultEvent,
  Observer,
  OrNothing,
  StepEvent,
  StopDecision,
  ToolCallEvent,
  ToolResultEvent,
  ToolResultPatch,
} from "./hooks.js";
export {
  type ApprovalDetails,
  type ApprovalHandler,
  blockingApprovals,
  createPendingRequest,
  type PendingRequestFields,
} from "./pauses.js";
export { DEFAULT_PROGRESS, type ProgressPolicy } from "./progress.js";
export type {
  AwaitingApprovalResult,
  BudgetResult,
  ClarificationRequestedResult,
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
export {
  type AppFor,
  type ContinueOptions,
  continueRun,
  nestedRunDepth,
  type ParentRun,
  type Run,
  type RunInput,
  type RunOptions,
  run,
  runOrThrow,
} from "./run.js";
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
export { isSafetyError, SafetyError, type SafetyErrorCode } from "./vendor/agent-safety/errors.js";
export { canonicalInputHash } from "./vendor/agent-safety/hash.js";
export type { WriteOutcome } from "./vendor/agent-safety/outcome.js";
export {
  type PendingCall,
  type Recheck,
  type RejectionCause,
  type Resolution,
  type ResolutionCheck,
  type SignedPendingRequest,
  type SignPendingOptions,
  type VerifyResolutionOptions,
  verifyResolution,
} from "./vendor/agent-safety/pending.js";
export {
  type ApprovalSigner,
  ephemeralSigner,
  type HmacSignerOptions,
  hmacSigner,
} from "./vendor/agent-safety/signer.js";
export { SDK_VERSION } from "./version.js";

/** The package's name, `@buildanagent/sdk`. */
export const SDK_PACKAGE = "@buildanagent/sdk";
