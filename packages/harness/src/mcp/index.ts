/**
 * `@buildanagent/harness/mcp`: the MCP client. `createMcpManager()` connects each configured server, negotiates its
 * protocol era, and registers its tools as `mcp__<server>__<tool>`, deferred by default. `connectMcpServer()` connects
 * one server without registering anything. The stdio transport is Node-only; an in-process server works on any runtime.
 */
export { connectMcpServer } from "./connection.js";
export { type McpCallFailure, McpError } from "./errors.js";
export { createMcpManager } from "./manager.js";
export { killMcpServersOnSignal } from "./stdio.js";
export type {
  McpCallResult,
  McpChannel,
  McpConnection,
  McpEra,
  McpInProcessTransport,
  McpManager,
  McpManagerOptions,
  McpServerConfig,
  McpServerStatus,
  McpStdioTransport,
  McpTool,
} from "./types.js";
