/**
 * `@buildanagent/harness/tools`: the tool registry, which names, defers and wraps the tools of every source, the
 * tool search that activates deferred ones, and the built-in tools, which reach files, commands and the web only
 * through a sandbox and an egress proxy.
 *
 * @module @buildanagent/harness/tools
 */
export { type BuiltinToolsOptions, builtinTools } from "./builtins/builtins.js";
export { BUILTIN_TOOL_DEFAULTS, BUILTIN_TOOLS_HASH } from "./builtins/descriptions.js";
export type { FetchProxy } from "./builtins/fetch.js";
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
