/**
 * `@buildanagent/harness/tools`: the tool registry, which names, defers and wraps the tools of every source, and the
 * tool search that activates deferred ones.
 */
export { DuplicateToolError } from "./errors.js";
export { createToolRegistry } from "./registry.js";
export { type ToolSearchOptions, toolSearchInterceptors, toolSearchTool } from "./tool-search.js";
export type {
  ApprovalReuse,
  HostPattern,
  OutputTrust,
  PreambleOptions,
  RegisteredTool,
  ToolExposure,
  ToolRegistration,
  ToolRegistry,
  ToolSource,
  ToolWrapper,
  TurnBoundary,
} from "./types.js";
