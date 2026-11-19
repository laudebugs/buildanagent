/**
 * `@buildanagent/sdk`: the agent loop over `@buildanagent/gateway`. This entry holds the loop (`run()`,
 * `continueRun()`, `runOrThrow()`), its events and results, and the tools: their definitions, schemas, results and
 * write outcomes. Hooks, signed pauses and budgets are planned in the SDK plan §3.3.
 */
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
  Context,
  DoneResult,
  EndedResult,
  ErrorResult,
  ResultBase,
  RunError,
  RunResult,
  StoppedResult,
  UnfinishedResult,
} from "./result.js";
export { continueRun, type Run, type RunInput, type RunOptions, run, runOrThrow } from "./run.js";
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
