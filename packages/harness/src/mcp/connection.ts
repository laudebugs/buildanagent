/**
 * `connectMcpServer()`: one server behind `McpConnection`, over `@modelcontextprotocol/client` 2.4.0 (ADR 0021). The
 * client negotiates the era per connection: it probes with `server/discover` and falls back to `initialize` when the
 * server gives no sign of the 2026-07-28 revision. This module reads the result through the client's
 * `getProtocolEra()`, and only it imports the client, so the base can change without touching the registry.
 */
import { Client, type Transport } from "@modelcontextprotocol/client";
import { HarnessError } from "../errors.js";
import { checkToolList, resultOf, shortText } from "./content.js";
import { type McpCallFailure, McpError } from "./errors.js";
import { checkStdioTransport, StdioChannel } from "./stdio.js";
import type { McpCallResult, McpChannel, McpConnection, McpEra, McpServerConfig, McpTool } from "./types.js";

const MODERN_VERSION = "2026-07-28";
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOOLS = 256;
// The pages a tool list may take. A server whose cursor never ends can't keep the connect busy.
const MAX_LIST_PAGES = 8;
// The longest delay a timer takes: a larger one fires at once.
const MAX_TIMER_MS = 2 ** 31 - 1;
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/;
const CLIENT_INFO = { name: "buildanagent-harness", version: "0.0.0" };

const describe = (error: unknown): string => shortText(error instanceof Error ? error.message : String(error));

function timeout(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!(Number.isInteger(value) && value >= 1 && value <= MAX_TIMER_MS)) {
    throw new HarnessError(
      "invalid_mcp_config",
      `${name} must be a whole number of milliseconds from 1 to ${MAX_TIMER_MS}`,
    );
  }
  return value;
}

/** A server's settings with their defaults, checked. Throws a `HarnessError`, code `invalid_mcp_config`. */
export function checkServerConfig(config: McpServerConfig) {
  if (typeof config?.name !== "string" || !SERVER_NAME.test(config.name)) {
    throw new HarnessError(
      "invalid_mcp_config",
      `an MCP server name must be 1 to 32 characters from A-Z, a-z, 0-9 and -, starting with a letter or digit, got ${JSON.stringify(config?.name)}`,
    );
  }
  const transport = config.transport;
  if (transport?.kind === "stdio") checkStdioTransport(transport);
  else if (transport?.kind !== "in_process" || typeof transport.channel?.send !== "function") {
    throw new HarnessError(
      "invalid_mcp_config",
      `the MCP server "${config.name}" needs a stdio or in_process transport`,
    );
  }
  const maxTools = config.maxTools ?? DEFAULT_MAX_TOOLS;
  if (!Number.isInteger(maxTools) || maxTools < 1) {
    throw new HarnessError("invalid_mcp_config", "maxTools must be a whole number, 1 or more");
  }
  const connectMs = timeout("connectTimeoutMs", config.connectTimeoutMs, DEFAULT_CONNECT_TIMEOUT_MS);
  // A probe that outlasts the handshake would never let a silent server fall back to legacy, so a probe timeout the
  // config names must be shorter, and the default shrinks to half the handshake when it would not be.
  if (config.probeTimeoutMs !== undefined && config.probeTimeoutMs >= connectMs) {
    throw new HarnessError("invalid_mcp_config", "probeTimeoutMs must be shorter than connectTimeoutMs");
  }
  return {
    connectMs,
    probeMs: timeout(
      "probeTimeoutMs",
      config.probeTimeoutMs,
      Math.min(DEFAULT_PROBE_TIMEOUT_MS, Math.ceil(connectMs / 2)),
    ),
    requestMs: timeout("requestTimeoutMs", config.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
    maxTools,
  };
}

type Settings = ReturnType<typeof checkServerConfig>;

/** Why a call failed, read from what the client library threw. */
function failureOf(error: unknown, signal: AbortSignal, closed: boolean): McpCallFailure {
  if (signal.aborted) return "aborted";
  if (closed) return "closed";
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "REQUEST_TIMEOUT") return "timeout";
  if (code === "CONNECTION_CLOSED" || code === "NOT_CONNECTED" || code === "SEND_FAILED") return "closed";
  if (code === "UNSUPPORTED_RESULT_TYPE" || code === "INPUT_REQUIRED_ROUNDS_EXCEEDED") return "input_required";
  return "server_error";
}

const FAILURE_TEXT: Record<McpCallFailure, string> = {
  closed: "the connection closed before the call finished",
  timeout: "the call timed out",
  aborted: "the call was aborted",
  input_required: "the server asked for input from the user, which this harness does not supply yet",
  server_error: "the server answered with an error",
};

class Connection implements McpConnection {
  readonly server: string;
  readonly era: McpEra;
  readonly protocolVersion: string;
  readonly #client: Client;
  readonly #channel: McpChannel;
  readonly #settings: Settings;
  #closed = false;
  #closing: Promise<void> | undefined;

  constructor(server: string, client: Client, channel: McpChannel, settings: Settings, era: McpEra, version: string) {
    this.server = server;
    this.#client = client;
    this.#channel = channel;
    this.#settings = settings;
    this.era = era;
    this.protocolVersion = version;
    const previous = channel.onclose;
    channel.onclose = () => {
      this.#closed = true;
      previous?.();
    };
  }

  get closed(): boolean {
    return this.#closed;
  }

  async listTools(): Promise<readonly McpTool[]> {
    let listed: unknown;
    try {
      listed = (await this.#client.listTools(undefined, { timeout: this.#settings.requestMs })).tools;
    } catch (error) {
      throw new McpError("mcp_tool_list_refused", this.server, `its tool list could not be read: ${describe(error)}`, {
        cause: error,
      });
    }
    return checkToolList(this.server, listed, this.#settings.maxTools);
  }

  async callTool(name: string, args: unknown, signal: AbortSignal): Promise<McpCallResult> {
    if (this.#closed) {
      throw new McpError("mcp_call_failed", this.server, FAILURE_TEXT.closed, { failure: "closed" });
    }
    const input = typeof args === "object" && args !== null && !Array.isArray(args) ? args : {};
    try {
      const result = await this.#client.callTool(
        { name, arguments: input as Record<string, unknown> },
        { signal, timeout: this.#settings.requestMs },
      );
      return resultOf(result);
    } catch (error) {
      const failure = failureOf(error, signal, this.#closed);
      const detail = failure === "server_error" ? `: ${describe(error)}` : "";
      throw new McpError("mcp_call_failed", this.server, `${FAILURE_TEXT[failure]}${detail}`, {
        cause: error,
        failure,
      });
    }
  }

  stderr(): string {
    return this.#channel instanceof StdioChannel ? this.#channel.stderr : "";
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      this.#closed = true;
      await this.#client.close().catch(() => {});
      await this.#channel.close().catch(() => {});
    })();
    return this.#closing;
  }
}

function channelOf(config: McpServerConfig, log: (line: string) => void): McpChannel {
  return config.transport.kind === "stdio" ? new StdioChannel(config.transport, log) : config.transport.channel;
}

/** Connects through `channel`, bounded by `connectMs`, and closes everything when it fails. */
async function handshake(
  config: McpServerConfig,
  settings: Settings,
  channel: McpChannel,
  prior: "legacy" | undefined,
  log: (line: string) => void,
  deadline: { readonly ms: number; readonly signal: AbortSignal | undefined },
): Promise<Connection> {
  const client = new Client(CLIENT_INFO, {
    capabilities: {},
    versionNegotiation: { mode: "auto", probe: { timeoutMs: settings.probeMs } },
    // A server's request for user input fails the call: whether it may pause a turn waits on the owner.
    inputRequired: { autoFulfill: false },
    listMaxPages: MAX_LIST_PAGES,
    // The harness reads a result's content, not its structured content, so a server's output schema is never compiled:
    // a hostile pattern or reference in it can cost nothing.
    jsonSchemaValidator: {
      getValidator: () => (input: unknown) => ({ valid: true, data: input as never, errorMessage: undefined }),
    },
  });
  // The tool list stays as registered at connect. A changed list is announced, and a later todo diffs it against a pin.
  client.setNotificationHandler("notifications/tools/list_changed", () => {
    log(`the server "${config.name}" says its tool list changed; its tools stay as they were registered`);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the handshake did not finish in ${settings.connectMs} ms`)),
      Math.max(1, deadline.ms),
    );
    onAbort = () => reject(new Error("the connect was aborted"));
    if (deadline.signal?.aborted) onAbort();
    else deadline.signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const connecting = client.connect(channel as unknown as Transport, {
      timeout: Math.max(1, deadline.ms),
      ...(prior === undefined ? {} : { prior: { kind: prior } }),
    });
    connecting.catch(() => {});
    await Promise.race([connecting, expired]);
    const era = client.getProtocolEra();
    const version = client.getNegotiatedProtocolVersion() ?? "";
    if (era === "modern" && version !== MODERN_VERSION) {
      throw new Error(`the server negotiated the revision ${shortText(version, 32)}, which this harness does not know`);
    }
    return new Connection(
      config.name,
      client,
      channel,
      settings,
      era === "modern" ? MODERN_VERSION : "legacy",
      version,
    );
  } catch (error) {
    await client.close().catch(() => {});
    await channel.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) deadline.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Connects one server and negotiates its era. A stdio server that exits cleanly after the `server/discover` probe, as
 * servers on some older SDKs do on any request before `initialize`, is started once more and spoken to as a legacy
 * server; a server that crashes runs once. The whole connect, a restart included, takes at most `connectTimeoutMs`.
 * `signal` aborts it, and the server is closed.
 *
 * Throws a `HarnessError`, code `invalid_mcp_config`, for a config that can't be used, and an `McpError`, code
 * `mcp_connect_failed`, when the server does not start, does not finish the handshake within `connectTimeoutMs`, is
 * aborted, or negotiates a revision this harness does not know.
 */
export async function connectMcpServer(
  config: McpServerConfig,
  options: { readonly log?: (line: string) => void; readonly signal?: AbortSignal } = {},
): Promise<McpConnection> {
  const settings = checkServerConfig(config);
  const log = options.log ?? (() => {});
  const ends = Date.now() + settings.connectMs;
  const left = () => ({ ms: ends - Date.now(), signal: options.signal });
  const failed = (error: unknown) =>
    new McpError("mcp_connect_failed", config.name, `it did not connect: ${describe(error)}`, { cause: error });
  const channel = channelOf(config, log);
  try {
    return await handshake(config, settings, channel, undefined, log, left());
  } catch (first) {
    const exitedOnProbe = channel instanceof StdioChannel && channel.exitedOnProbe;
    if (!exitedOnProbe || options.signal?.aborted === true || left().ms <= 0) throw failed(first);
    log(`the server "${config.name}" closed after the probe, so it is started again as a legacy server`);
    try {
      return await handshake(config, settings, channelOf(config, log), "legacy", log, left());
    } catch (second) {
      throw failed(second);
    }
  }
}
