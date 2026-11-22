/**
 * The types of `@buildanagent/harness/mcp`. The registry and the rest of the harness see these and never the MCP client
 * library, so the library can change without touching them (ADR 0021).
 */
import type { ModelContent } from "@buildanagent/gateway";
import type { ExtensionLoadedRecord } from "../extensions/types.js";
import type { PermissionHook } from "../permissions/types.js";
import type { ToolExposure, ToolRegistry, TurnBoundary } from "../tools/types.js";

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
  /** Opens the channel. The client calls it once, after it has set the three handlers. */
  start(): Promise<void>;
  /** Sends one message to the server. */
  send(message: object): Promise<void>;
  /** Closes the channel, and calls `onclose`. */
  close(): Promise<void>;
  /** Set by the client: called with each message the server sends. */
  onmessage?: ((message: object) => void) | undefined;
  /** Set by the client: called once when the channel closes, whoever closed it. */
  onclose?: (() => void) | undefined;
  /** Set by the client: called with a problem that does not close the channel. */
  onerror?: ((error: Error) => void) | undefined;
}

/** A server in this process, reached through a channel the host built. */
export interface McpInProcessTransport {
  readonly kind: "in_process";
  readonly channel: McpChannel;
}

/** The part of an egress proxy a remote server's requests go through: `startEgressProxy()` returns one. */
export interface McpEgressFetch {
  /** Sends one request under the proxy's allowlist and resolves with its response. */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

/**
 * The settings a remote server shares, over streamable HTTP or legacy SSE. A remote server is untrusted code on
 * another machine, and the harness reaches it with its own network identity, so the URL, every address it resolves to
 * and every byte that comes back are checked.
 */
export interface McpRemoteSettings {
  /**
   * The server's endpoint. It must be `https:`, hold no user name or password and no fragment, and have no query
   * parameter whose name looks like a credential, such as `token` or `api_key`: a credential goes in `headers`. Plain
   * `http:` is accepted only with `unsafeAllowLoopback`, for a test server on this machine.
   */
  readonly url: string;
  /**
   * Headers sent with every request, such as `Authorization` with a token the host read from its own secret store.
   * Nothing is read from the environment. The values never reach a log line, an error message, the session log or
   * the model. A name the transport sets itself, such as `Host`, `Content-Type` or `Mcp-Session-Id`, is refused.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * The egress proxy to send every request through, so its allowlist, address checks and log apply. The URL
   * must then be `https:` and its host on the proxy's allowlist. Left out, the harness connects itself, with the
   * address checks below.
   */
  readonly proxy?: McpEgressFetch;
  /**
   * Address ranges this server may resolve to although they are not public, such as `10.20.0.0/16` for a server on the
   * host's own network. Every other loopback, private, carrier-grade NAT, link-local (with the cloud metadata address
   * `169.254.169.254`), unspecified, multicast or reserved address is refused, and so is an IPv6 address that wraps one.
   * A loopback address is never allowed here; see `unsafeAllowLoopback`. Default none.
   */
  readonly allowAddresses?: readonly string[];
  /**
   * Lets the server be on a loopback address, and over plain `http:` when every address it resolves to is loopback.
   * It exists so a test can serve MCP on `127.0.0.1`; never set it for a real run. Default false.
   */
  readonly unsafeAllowLoopback?: boolean;
  /**
   * Resolves a name to its addresses, in place of the system resolver, such as a test's table. Every address it
   * returns is checked, and the request connects to the first. Ignored with `proxy`, which resolves names itself.
   */
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  /**
   * The certificate authorities to trust for this server instead of the system's, such as a test's own. Certificates
   * are always verified. Ignored with `proxy`, which has its own.
   */
  readonly ca?: string | readonly string[];
  /** The largest JSON body, and the largest server-sent event or line, in bytes. Default 8 MiB. */
  readonly maxMessageBytes?: number;
  /**
   * The most bytes one response stream may carry in all. Default 64 MiB. A long-lived stream past it is cut and opened
   * again; a legacy SSE server's one stream has no such bound.
   */
  readonly maxStreamBytes?: number;
  /** How long a response may take to start: its status line and headers. Default 30,000 ms. */
  readonly headersTimeoutMs?: number;
  /**
   * How long a response stream may go without a byte before it is cut. Default 120,000 ms. A streamable HTTP GET or
   * listen stream that is cut is opened again; a legacy SSE server's one stream is never cut for time.
   */
  readonly streamIdleMs?: number;
  /** How long one response stream may stay open in all before it is cut. Default 3,600,000 ms, an hour; as above. */
  readonly maxStreamMs?: number;
  /** How many responses may be open at once on one connection. A request past it fails. Default 8. */
  readonly maxStreams?: number;
}

/**
 * A server reached over MCP's streamable HTTP transport: each message is a `POST`, and the answer is JSON or a
 * server-sent event stream. The era is negotiated as for any other server.
 */
export interface McpHttpTransport extends McpRemoteSettings {
  readonly kind: "http";
}

/**
 * A server reached over the HTTP+SSE transport of the 2024-11-05 revision, which MCP has deprecated since 2025-03-26.
 * It is for legacy servers only: the harness connects in the legacy era without a probe. Its event stream carries every
 * answer and has only the event and line bounds, never a time or total-byte one. When it ends, the connection closes,
 * and nothing reconnects it.
 */
export interface McpSseTransport extends McpRemoteSettings {
  readonly kind: "sse";
}

/** One MCP server the harness connects to. */
export interface McpServerConfig {
  /**
   * The server's name in its tools' canonical names, `mcp__<name>__<tool>`: 1 to 32 characters from `A-Z`, `a-z`, `0-9`
   * and `-`, starting with a letter or digit. Two servers of one harness can't share a name, in any letter case.
   */
  readonly name: string;
  readonly transport: McpStdioTransport | McpInProcessTransport | McpHttpTransport | McpSseTransport;
  /**
   * How the model reaches the server's tools. Default `deferred`, so a tool is sent only once tool search names it.
   * The first turn waits for a `direct` server, up to the manager's `directWaitMs`; a `direct` server that connects
   * after that wait is registered as `deferred`, so the tools a request sends never change because a server was slow.
   */
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
  /**
   * The tool's input schema as the server sent it. The registered tool's schema leaves out `pattern`,
   * `patternProperties` and `format`, so the harness never runs a server's regular expression.
   */
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
  /** The newest bytes the server wrote to standard error, for the host's diagnostics. Empty for other transports. */
  stderr(): string;
  /**
   * Calls `listener` each time the server says its tool list changed: by `notifications/tools/list_changed` from a
   * legacy server, or on the `subscriptions/listen` stream that a 2026-07-28 server with `tools.listChanged` opens.
   * The listener is told nothing else, so it reads the list again itself. Returns a function that removes it.
   */
  watchTools(listener: () => void): () => void;
  /** Ends the connection and, for a stdio server, its process group. Calling it again does nothing. */
  close(): Promise<void>;
}

/** The timers the MCP client waits with, so a test can run its waits on a clock of its own. */
export interface McpTimers {
  /** Calls `run` once after `ms` milliseconds, and returns a handle for `clearTimeout`. */
  setTimeout(run: () => void, ms: number): unknown;
  /** Cancels a timer `setTimeout` returned, if it has not run yet. */
  clearTimeout(handle: unknown): void;
  /** The time now, in milliseconds. */
  now(): number;
}

/**
 * Where the approved definitions of each server's tools are kept: for each server, its tool names and the hash of each
 * one's definition. `fileMcpPinStore()` from `@buildanagent/harness/extensions/node` keeps them in a project's
 * `extensions.lock.json`.
 */
export interface McpPinStore {
  /** The pins of one server, by tool name, or `undefined` when it has none yet. */
  read(server: string): Promise<Readonly<Record<string, string>> | undefined>;
  /** Replaces the pins of one server. */
  write(server: string, pins: Readonly<Record<string, string>>): Promise<void>;
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
  /**
   * The approved tool definitions. With a store, a tool whose definition has no pin, or a different one, starts
   * disabled until `approve()`, and a server the store holds nothing for has every tool disabled. Without one, each
   * server's tools as listed at connect are its pins for the life of the manager.
   */
  readonly pins?: McpPinStore;
  /** How long the first turn waits for the `direct` servers to connect. Default 10,000 ms. */
  readonly directWaitMs?: number;
  /** The shortest time between two reads of one server's tool list after it says the list changed. Default 2,000 ms. */
  readonly relistIntervalMs?: number;
  /** The timers of the first turn's wait, the re-reads and the stream re-opens. Default the platform's own. */
  readonly timers?: McpTimers;
}

/** How a server's current definition of a tool compares with its pin. */
export type McpToolState = "unchanged" | "new" | "changed" | "removed";

/** A tool whose current definition has no matching pin, so it waits for a person's approval. */
export interface McpPendingTool {
  readonly server: string;
  /** The tool's name on its server, which is the server's text: show it as data. */
  readonly tool: string;
  /** Its canonical name, when it is registered in this session. A tool a server added mid-session is not. */
  readonly canonicalName?: string;
  readonly state: "new" | "changed";
  /** The hash of the definition a person would approve, for `approve()`. */
  readonly hash: string;
  /** The definition as the server sent it, for a person to read before approving. None of it is trusted. */
  readonly definition: McpTool;
}

/** How one server's connection went. */
export type McpServerStatus =
  | {
      readonly server: string;
      readonly status: "connected";
      readonly era: McpEra;
      /** The canonical names of the tools registered for it, in its order. */
      readonly tools: readonly string[];
      /** The canonical names of those tools that start disabled, because no pin matches their definition. */
      readonly disabled: readonly string[];
    }
  | { readonly server: string; readonly status: "failed"; readonly error: Error };

/** The MCP client as one removable component: it connects the servers and registers their tools. */
export interface McpManager extends TurnBoundary {
  /**
   * Connects every server at once, registers each one's tools as soon as it connects, and resolves with a status per
   * server, in config order, once all have connected or failed. Call it before a session's first turn and not while a
   * turn runs, or use `start()` to connect in the background. A server that fails is reported and closed, and the others still connect. Calling it again returns the
   * same result. With `mcp: false` it resolves with an empty list.
   */
  connect(): Promise<readonly McpServerStatus[]>;
  /**
   * Starts connecting every server in the background and returns at once. A server's tools are registered at the start
   * of the first turn after it connects, through `beginTurn()`, which the runner calls when the manager is in
   * `HarnessOptions.turnBoundaries`. Each server connects once; one that fails stays failed.
   */
  start(): void;
  /**
   * The status of every server now, in config order: `connecting` until its tools are registered or it has failed.
   */
  statuses(): readonly (McpServerStatus | { readonly server: string; readonly status: "connecting" })[];
  /**
   * Waits for the `direct` servers, once, up to `directWaitMs`, then registers every server that has connected, sets
   * which tools may run this turn and returns a notice for what changed since the last turn. A tool may run when its
   * server's current definition matches its pin; a new, changed or removed one is disabled. The `tools` a request sends
   * stay as they were built: a tool a server adds mid-session is announced by count and joins a later session.
   */
  beginTurn(signal?: AbortSignal): Promise<readonly string[]>;
  /** The tools that wait for a person: those whose current definition has no matching pin. */
  pending(): readonly McpPendingTool[];
  /**
   * Records a person's approval of one tool's definition, by the hash `pending()` gave, and writes it to the pin store.
   * The tool may run from the next turn on. Throws a `HarnessError`, code `invalid_mcp_config`, when the server's
   * current definition has another hash, so an approval never covers a definition the person did not see.
   */
  approve(server: string, tool: string, hash: string): Promise<void>;
  /**
   * A permission hook that denies a call to a disabled tool of these servers before anything else decides, so a sticky
   * allowance, an allow rule or `bypass` can't run it. Put it in the pipeline's `hooks`. A tool's own `execute` refuses
   * a disabled call too, so the server is never reached without the hook either.
   */
  permissionHook(): PermissionHook;
  /**
   * One `extension_loaded` record of tier `mcp` per connected server, in config order, for
   * `HarnessOptions.extensionRecords`. A turn then writes an entry for each record its session's log does not hold yet. A server that failed to connect
   * has no record: its status says why, and nothing of it ran in a turn.
   */
  records(): readonly ExtensionLoadedRecord[];
  /** The connection of a connected server, by name. */
  connection(server: string): McpConnection | undefined;
  /** Closes every connection and ends every server process. A tool of a closed server fails when called. */
  close(): Promise<void>;
}
