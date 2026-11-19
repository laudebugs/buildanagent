/**
 * `@buildanagent/sdk`: the agent loop over `@buildanagent/gateway`. This entry holds the tools: their definitions,
 * schemas, results and write outcomes. The loop, hooks, signed pauses and budgets are planned in the SDK plan §3.3.
 */
export { isSdkError, SdkError, type SdkErrorCode } from "./errors.js";
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
  ToolContext,
  ToolDefinition,
  ToolEffect,
  ToolFailure,
  ToolResult,
  ToolSchema,
} from "./tools/types.js";
export type { WriteOutcome } from "./vendor/agent-safety/outcome.js";

/** The package's name, `@buildanagent/sdk`. */
export const SDK_PACKAGE = "@buildanagent/sdk";
