/**
 * The `extension_loaded` record of a connected MCP server. It holds hashes and never a raw argument or an environment
 * value, because a server's command line or variables can carry a token. Every hash is `sha256:` and the hex SHA-256 of
 * canonical JSON (RFC 8785), the hash the permission pipeline uses for tool inputs, so the record is the same on every
 * runtime and across reconnects of an unchanged server.
 */
import type { McpServerRecord } from "@buildanagent/protocol";
import { canonicalInputHash } from "@buildanagent/sdk";
import type { ExtensionLoadedRecord } from "../extensions/types.js";
import type { McpConnection, McpServerConfig, McpTool } from "./types.js";

const hash = async (value: unknown): Promise<string> => `sha256:${await canonicalInputHash(value)}`;

/**
 * The record for a server whose tools were registered. The tools hash covers each tool's name, description and input
 * schema, sorted by name, and leaves out the annotations, which change nothing the harness does.
 */
export async function mcpRecordOf(
  config: McpServerConfig,
  connection: McpConnection,
  tools: readonly McpTool[],
): Promise<ExtensionLoadedRecord> {
  const listed = [...tools]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const transport = config.transport;
  const mcp: McpServerRecord = {
    transport: transport.kind,
    ...(transport.kind === "stdio" ? { commandHash: await hash([transport.command, ...(transport.args ?? [])]) } : {}),
    era: connection.era,
    toolsHash: await hash(listed),
  };
  return { name: config.name, tier: "mcp", contentHash: await hash(mcp), mcp };
}
