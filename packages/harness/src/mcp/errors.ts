/** The MCP client's named error: a `HarnessError` that names the server it came from. */
import { HarnessError, type HarnessErrorCode } from "../errors.js";

/** Why an MCP tool call ended without a result. */
export type McpCallFailure = "closed" | "timeout" | "aborted" | "input_required" | "server_error";

/**
 * Thrown for a server that could not connect (`mcp_connect_failed`), a tool list the harness refuses
 * (`mcp_tool_list_refused`) and a tool call that ended with no result (`mcp_call_failed`, with `failure` saying why).
 * Its message names the server and never holds the server's standard error.
 */
export class McpError extends HarnessError {
  override readonly name = "McpError";
  /** The name of the server, from its config. */
  readonly server: string;
  /** Why a call failed, for `mcp_call_failed`. */
  readonly failure?: McpCallFailure;

  constructor(
    code: Extract<HarnessErrorCode, "mcp_connect_failed" | "mcp_tool_list_refused" | "mcp_call_failed">,
    server: string,
    message: string,
    options?: ErrorOptions & { readonly failure?: McpCallFailure },
  ) {
    super(code, `MCP server "${server}": ${message}`, options);
    this.server = server;
    if (options?.failure !== undefined) this.failure = options.failure;
  }
}
