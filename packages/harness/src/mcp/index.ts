/**
 * `@buildanagent/harness/mcp`: the MCP client. `createMcpManager()` connects each configured server, negotiates its
 * protocol era, and registers its tools as `mcp__<server>__<tool>`, deferred by default. It connects in the background
 * and changes a session's tools only between turns, with each tool's definition checked against a pin.
 * `connectMcpServer()` connects one server without registering anything. The stdio transport is Node-only; the HTTP and
 * SSE transports run on any runtime with `fetch`, and resolve and pin each address themselves on Node.
 *
 * @module @buildanagent/harness/mcp
 */
export { connectMcpServer } from "./connection.js";
export { type McpCallFailure, McpError } from "./errors.js";
export { createMcpManager } from "./manager.js";
export { memoryMcpPinStore } from "./pins.js";
export { killMcpServersOnSignal } from "./stdio.js";
export type {
  McpCallResult,
  McpChannel,
  McpConnection,
  McpEgressFetch,
  McpEra,
  McpHttpTransport,
  McpInProcessTransport,
  McpManager,
  McpManagerOptions,
  McpPendingTool,
  McpPinStore,
  McpRemoteSettings,
  McpServerConfig,
  McpServerStatus,
  McpSseTransport,
  McpStdioTransport,
  McpTimers,
  McpTool,
  McpToolState,
} from "./types.js";
