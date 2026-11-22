/**
 * `createMcpManager()`: the MCP client as one removable component. It connects each server on its own, so one slow or
 * broken server never holds back the others, and registers each server's tools with the registry under the source
 * `mcp:<name>`, which names them `mcp__<name>__<tool>` and defers them by default.
 *
 * A server's tools are registered all or none: the list is checked, then registered through `registerAll()`, which
 * removes the tools it added when any one is refused, so a list the registry would refuse halfway leaves nothing
 * behind. Every tool is marked as not first-party and as a
 * write, whatever its annotations say, so a server's `readOnlyHint` can't make the loop run its calls together or run
 * one again after a crash. The calls reach the server only through the turn's tool pipeline, so the permission gate
 * and the write cap apply to them as to any tool.
 */
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { ExtensionLoadedRecord } from "../extensions/types.js";
import type { ToolRegistration } from "../tools/types.js";
import { checkServerConfig, connectMcpServer } from "./connection.js";
import { McpError } from "./errors.js";
import { mcpRecordOf } from "./record.js";
import type {
  McpConnection,
  McpManager,
  McpManagerOptions,
  McpServerConfig,
  McpServerStatus,
  McpTool,
} from "./types.js";

// A placeholder that passes defineTool()'s name check; the registry names every tool by its canonical name.
const PLACEHOLDER_NAME = "mcp_tool";

/** The definition of one server tool. Its `execute` calls the tool by the name the server listed at connect. */
function definitionOf(connection: McpConnection, tool: McpTool): ToolDefinition<unknown, unknown, unknown> {
  return defineTool<unknown, unknown, unknown>({
    name: PLACEHOLDER_NAME,
    description: tool.description,
    kind: "dynamic",
    inputSchema: tool.inputSchema,
    firstParty: false,
    // A server's hints are claims by code the harness does not control, so every call is treated as a write.
    effect: { kind: "write" },
    async execute(input, ctx) {
      const result = await connection.callTool(tool.name, input, ctx.signal);
      return { content: result.content, ...(result.isError ? { isError: true } : {}) };
    },
  });
}

function registrationOf(config: McpServerConfig, connection: McpConnection, tool: McpTool): ToolRegistration {
  return {
    name: tool.name,
    source: `mcp:${config.name}`,
    ...(config.exposure === undefined ? {} : { exposure: config.exposure }),
    definition: definitionOf(connection, tool),
  };
}

/** The server's registrations, built before any is registered, so a tool the SDK refuses fails the whole list. */
function registrationsOf(config: McpServerConfig, connection: McpConnection, tools: readonly McpTool[]) {
  return tools.map((tool) => {
    try {
      return registrationOf(config, connection, tool);
    } catch (error) {
      throw refused(config.name, error);
    }
  });
}

function refused(server: string, error: unknown): McpError {
  const why = error instanceof Error ? error.message : String(error);
  return new McpError(
    "mcp_tool_list_refused",
    server,
    `its tool list was refused, so none of its tools was registered: ${why}`,
    { cause: error },
  );
}

function checkServers(servers: readonly McpServerConfig[]): void {
  if (!Array.isArray(servers)) throw new HarnessError("invalid_mcp_config", "servers must be a list");
  const names = new Set<string>();
  for (const config of servers) {
    checkServerConfig(config);
    const key = config.name.toLowerCase();
    if (names.has(key)) {
      throw new HarnessError("invalid_mcp_config", `two MCP servers are named "${config.name}", in some letter case`);
    }
    names.add(key);
  }
}

class Manager implements McpManager {
  readonly #options: McpManagerOptions;
  readonly #connections = new Map<string, McpConnection>();
  readonly #records = new Map<string, ExtensionLoadedRecord>();
  // Every connection that exists, registered or not, so a close can end one whose tool list is still being read.
  readonly #open = new Set<McpConnection>();
  readonly #abort = new AbortController();
  #connecting: Promise<readonly McpServerStatus[]> | undefined;
  #closing: Promise<void> | undefined;

  constructor(options: McpManagerOptions) {
    this.#options = options;
  }

  connect(): Promise<readonly McpServerStatus[]> {
    if (this.#closing !== undefined) {
      return Promise.reject(new HarnessError("invalid_mcp_config", "the MCP manager was closed"));
    }
    this.#connecting ??=
      this.#options.mcp === false
        ? Promise.resolve([])
        : Promise.all(this.#options.servers.map((config) => this.#connectOne(config)));
    return this.#connecting;
  }

  async #connectOne(config: McpServerConfig): Promise<McpServerStatus> {
    const log = this.#options.log ?? (() => {});
    let connection: McpConnection | undefined;
    try {
      connection = await connectMcpServer(config, { log, signal: this.#abort.signal });
      this.#open.add(connection);
      // A close that began during the handshake must still end this server.
      if (this.#closing !== undefined) throw new McpError("mcp_connect_failed", config.name, "the manager was closed");
      const listed = await connection.listTools();
      const registrations = registrationsOf(config, connection, listed);
      let record: ExtensionLoadedRecord;
      try {
        record = await mcpRecordOf(config, connection, listed);
      } catch (error) {
        throw refused(config.name, error);
      }
      if (this.#closing !== undefined) throw new McpError("mcp_connect_failed", config.name, "the manager was closed");
      // Nothing awaits between this check and the registration, so another manager on the same registry can't
      // register the source in between, and registerAll() leaves nothing behind when any tool is refused.
      const source = `mcp:${config.name}`;
      if (this.#options.registry.list().some((tool) => tool.source === source)) {
        throw new McpError("mcp_tool_list_refused", config.name, `the registry already holds tools from ${source}`);
      }
      let tools: string[];
      try {
        tools = this.#options.registry.registerAll(registrations).map((tool) => tool.canonicalName);
      } catch (error) {
        throw refused(config.name, error);
      }
      this.#connections.set(config.name, connection);
      this.#records.set(config.name, record);
      return { server: config.name, status: "connected", era: connection.era, tools };
    } catch (error) {
      if (connection !== undefined) this.#open.delete(connection);
      await connection?.close();
      const failure = error instanceof Error ? error : new Error(String(error));
      log(`the MCP server "${config.name}" was not connected: ${failure.message}`);
      return { server: config.name, status: "failed", error: failure };
    }
  }

  records(): readonly ExtensionLoadedRecord[] {
    return this.#options.servers.flatMap((config) => this.#records.get(config.name) ?? []);
  }

  connection(server: string): McpConnection | undefined {
    return this.#connections.get(server);
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      // Aborting ends every handshake still running, and closing every open connection fails any tool list still being
      // read, so a server that hangs can't hold the others up.
      this.#abort.abort();
      await Promise.all([...this.#open].map((connection) => connection.close()));
      await this.#connecting?.catch(() => {});
    })();
    return this.#closing;
  }
}

/**
 * Creates the MCP client for a set of servers. It checks every config now and starts nothing until `connect()`.
 * Throws a `HarnessError`, code `invalid_mcp_config`, for a config that can't be used, two servers with one name, or a
 * registry without `register()`, `registerAll()` and `list()`.
 */
export function createMcpManager(options: McpManagerOptions): McpManager {
  const registry = options?.registry;
  for (const method of ["register", "registerAll", "list"] as const) {
    if (typeof registry?.[method] !== "function") {
      throw new HarnessError("invalid_mcp_config", `createMcpManager() needs a tool registry with ${method}()`);
    }
  }
  checkServers(options.servers);
  return new Manager(options);
}
