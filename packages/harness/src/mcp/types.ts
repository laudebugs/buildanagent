/**
 * The types of `@buildanagent/harness/mcp`. The registry and the rest of the harness see these and never the MCP client
 * library, so the library can change without touching them (ADR 0021).
 */
import type { ModelContent } from "@buildanagent/gateway";
import type { ToolExposure, ToolRegistry } from "../tools/types.js";

/** The protocol era a server speaks: the 2026-07-28 revision, or `legacy` for the 2025 revisions and their `initialize`. */
export type McpEra = "2026-07-28" | "legacy";

/**
 * A server the harness starts as a child process and speaks to over its standard input and output, one JSON message
 * per line. The child gets `spawnEnv()`'s environment (`PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`) plus what
 * `env` and `setEnv` declare, and nothing else from the parent.
 */
export interface McpStdioTransport {
  readonly kind: "stdio";
  /** The program to run, found on the child's `PATH` unless it is a path. It runs without a shell. */
  readonly command: string;
  readonly args?: readonly string[];
  /** The folder the server starts in. Default the harness's own working folder. */
  readonly cwd?: string;
  /**
   * Parent variables the server may read, by name, such as `DOCKER_HOST`. `spawnEnv()`'s rules apply: a name that looks
   * like a credential, such as `GITHUB_TOKEN`, is refused here and goes in `setEnv` with a value the host supplies.
   */
  readonly env?: readonly string[];
  /** Variables set to these values, such as a token the host read from its own secret store. */
  readonly setEnv?: Readonly<Record<string, string>>;
  /** The longest line the server may write, in bytes. A longer one closes the connection. Default 8 MiB. */
  readonly maxLineBytes?: number;
  /** How much of the server's standard error is kept, the newest bytes. It never reaches the model. Default 64 KiB. */
  readonly maxStderrBytes?: number;
  /**
   * How long a closing server has to exit after its input ends, and again after a `SIGTERM`, before its process group
   * is killed. Default 2,000 ms.
   */
  readonly closeGraceMs?: number;
}

/**
 * A message channel to a server in this process, such as an `InMemoryTransport` from `@modelcontextprotocol/server`.
 * Its shape is the MCP SDK's transport, so that SDK's own transports fit it. Messages are JSON-RPC objects.
 */
export interface McpChannel {
  start(): Promise<void>;
  send(message: object): Promise<void>;
  close(): Promise<void>;
  onmessage?: ((message: object) => void) | undefined;
  onclose?: (() => void) | undefined;
  onerror?: ((error: Error) => void) | undefined;
}

/** A server in this process, reached through a channel the host built. */
export interface McpInProcessTransport {
  readonly kind: "in_process";
  readonly channel: McpChannel;
}

/** One MCP server the harness connects to. */
export interface McpServerConfig {
  /**
   * The server's name in its tools' canonical names, `mcp__<name>__<tool>`: 1 to 32 characters from `A-Z`, `a-z`, `0-9`
   * and `-`, starting with a letter or digit. Two servers of one harness can't share a name, in any letter case.
   */
  readonly name: string;
  readonly transport: McpStdioTransport | McpInProcessTransport;
  /** How the model reaches the server's tools. Default `deferred`, so a tool is sent only once tool search names it. */
  readonly exposure?: ToolExposure;
  /** How long the start and the handshake may take, the probe included. Default 30,000 ms. */
  readonly connectTimeoutMs?: number;
  /**
   * How long the `server/discover` probe waits before it treats the server as legacy and sends `initialize`. Default
   * 5,000 ms.
   */
  readonly probeTimeoutMs?: number;
  /** How long one request, such as a tool call, may wait for its answer. Default 60,000 ms. */
  readonly requestTimeoutMs?: number;
  /** The most tools the server may list. A longer list is refused, and none of its tools is registered. Default 256. */
  readonly maxTools?: number;
}

/**
 * A tool as a server lists it. Every field is what the server says, so none of it is trusted: the name and
 * description reach the model only as data, and `annotations` change nothing the harness does.
 */
export interface McpTool {
  /** The tool's name on its server. */
  readonly name: string;
  /** The server's description, cut to 4,096 characters. */
  readonly description: string;
  /** The tool's input schema, a JSON Schema object. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** The server's hints, such as `readOnlyHint`, kept for display only. */
  readonly annotations?: Readonly<Record<string, unknown>>;
}

/** What one tool call returned. `content` is what the model reads; `isError` is the server's own failure flag. */
export interface McpCallResult {
  readonly content: readonly ModelContent[];
  readonly isError: boolean;
}

/** One connected server. */
export interface McpConnection {
  /** The server's name from its config. */
  readonly server: string;
  /** The era the server negotiated: `2026-07-28` when it answered the `server/discover` probe, `legacy` otherwise. */
  readonly era: McpEra;
  /** The protocol revision negotiated, such as `2026-07-28` or `2025-11-25`. */
  readonly protocolVersion: string;
  /** True once the connection has closed, by `close()` or because the server ended it. */
  readonly closed: boolean;
  /**
   * The server's tools, checked: at most `maxTools`, each with a usable name and schema, and no two whose names match
   * once normalised. Throws an `McpError`, code `mcp_tool_list_refused`, for a list that fails a check.
   */
  listTools(): Promise<readonly McpTool[]>;
  /**
   * Calls one tool by its name on the server. Throws an `McpError`, code `mcp_call_failed`, when the call ends with no
   * result: the server closed or answered with an error, the request timed out or `signal` aborted it, or the server
   * asked for input, which this harness does not supply.
   */
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult>;
  /** The newest bytes the server wrote to standard error, for the host's diagnostics. Empty for an in-process server. */
  stderr(): string;
  /** Ends the connection and, for a stdio server, its process group. Calling it again does nothing. */
  close(): Promise<void>;
}

/** What `createMcpManager()` takes. */
export interface McpManagerOptions {
  readonly servers: readonly McpServerConfig[];
  /** Where the servers' tools are registered, under the source `mcp:<name>`. */
  readonly registry: ToolRegistry;
  /** `false` switches MCP off: `connect()` starts no server and registers nothing. Default true. */
  readonly mcp?: boolean;
  /** Told of events a host may want to see, such as a server's notice that its tool list changed. */
  readonly log?: (line: string) => void;
}

/** How one server's connection went. */
export type McpServerStatus =
  | {
      readonly server: string;
      readonly status: "connected";
      readonly era: McpEra;
      /** The canonical names of the tools registered for it, in its order. */
      readonly tools: readonly string[];
    }
  | { readonly server: string; readonly status: "failed"; readonly error: Error };

/** The MCP client as one removable component: it connects the servers and registers their tools. */
export interface McpManager {
  /**
   * Connects every server at once and registers each one's tools, and resolves with a status per server, in config
   * order. A server that fails is reported and closed, and the others still connect. Calling it again returns the same
   * result. With `mcp: false` it resolves with an empty list.
   */
  connect(): Promise<readonly McpServerStatus[]>;
  /** The connection of a connected server, by name. */
  connection(server: string): McpConnection | undefined;
  /** Closes every connection and ends every server process. A tool of a closed server fails when called. */
  close(): Promise<void>;
}
