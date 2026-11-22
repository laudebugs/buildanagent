/**
 * `connectMcpServer()`: one server behind `McpConnection`, over `@modelcontextprotocol/client` 2.4.0 (ADR 0021). The
 * client negotiates the era per connection: it probes with `server/discover` and falls back to `initialize` when the
 * server gives no sign of the 2026-07-28 revision. This module reads the result through the client's
 * `getProtocolEra()`, and only it imports the client, so the base can change without touching the registry.
 */
import { Client, type McpSubscription, type Transport } from "@modelcontextprotocol/client";
import { HarnessError } from "../errors.js";
import { checkToolList, resultOf, shortText } from "./content.js";
import { type McpCallFailure, McpError } from "./errors.js";
import { RemoteRefusal } from "./guarded-fetch.js";
import { remoteChannel } from "./remote.js";
import { checkRemoteTransport, redact } from "./remote-config.js";
import { checkStdioTransport, StdioChannel } from "./stdio.js";
import type { McpCallResult, McpChannel, McpConnection, McpEra, McpServerConfig, McpTimers, McpTool } from "./types.js";

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

// A `subscriptions/listen` stream that drops is opened again after one second, doubling to a minute. One that stayed
// open for five minutes counts as healthy and resets the count; after eight short-lived streams in a row the harness
// stops opening it, so a server that acknowledges and drops at once can't keep the client busy.
const LISTEN_BASE_MS = 1000;
const LISTEN_MAX_MS = 60_000;
const LISTEN_HEALTHY_MS = 5 * 60 * 1000;
const MAX_LISTEN_DROPS = 8;

/** The platform's timers, which never hold a Node process open on their own. */
export const systemTimers: McpTimers = {
  setTimeout(run, ms) {
    const handle = setTimeout(run, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
  now: () => Date.now(),
};

/** The message of an error, with a refusal from a remote server's fetch named first, so a 401 reads as one. */
function messageOf(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof RemoteRefusal) return current.message;
    current = current.cause;
  }
  return error instanceof Error ? error.message : String(error);
}

const describe = (error: unknown, secrets: readonly string[] = []): string =>
  shortText(redact(messageOf(error), secrets));

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
  let secrets: readonly string[] = [];
  if (transport?.kind === "stdio") checkStdioTransport(transport);
  else if (transport?.kind === "http" || transport?.kind === "sse") secrets = checkRemoteTransport(transport).secrets;
  else if (transport?.kind !== "in_process" || typeof transport.channel?.send !== "function") {
    throw new HarnessError(
      "invalid_mcp_config",
      `the MCP server "${config.name}" needs a stdio, in_process, http or sse transport`,
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
    secrets,
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
  disabled: "the tool is disabled until a person approves its definition",
};

/** Where a server's change notices go: the connection sets `fire` once it exists. */
interface ChangeHub {
  fire: () => void;
}

/** What a connection is built from, once its handshake is done. */
interface Parts {
  readonly server: string;
  readonly client: Client;
  readonly channel: McpChannel;
  readonly settings: Settings;
  readonly era: McpEra;
  readonly version: string;
  readonly hub: ChangeHub;
  readonly timers: McpTimers;
  readonly log: (line: string) => void;
  readonly refusal: () => Error | undefined;
  readonly plannedListenCut: () => boolean;
}

class Connection implements McpConnection {
  readonly server: string;
  readonly era: McpEra;
  readonly protocolVersion: string;
  readonly #client: Client;
  readonly #channel: McpChannel;
  readonly #settings: Settings;
  readonly #timers: McpTimers;
  readonly #log: (line: string) => void;
  readonly #refusal: () => Error | undefined;
  readonly #plannedListenCut: () => boolean;
  readonly #watchers = new Set<() => void>();
  #closed = false;
  #closing: Promise<void> | undefined;
  #subscription: McpSubscription | undefined;
  #listenTimer: unknown;
  #listenDrops = 0;

  constructor(parts: Parts) {
    this.server = parts.server;
    this.#client = parts.client;
    this.#channel = parts.channel;
    this.#settings = parts.settings;
    this.#timers = parts.timers;
    this.#log = parts.log;
    this.#refusal = parts.refusal;
    this.#plannedListenCut = parts.plannedListenCut;
    this.era = parts.era;
    this.protocolVersion = parts.version;
    parts.hub.fire = () => this.#changed();
    const previous = parts.channel.onclose;
    parts.channel.onclose = () => {
      this.#closed = true;
      previous?.();
    };
  }

  watchTools(listener: () => void): () => void {
    this.#watchers.add(listener);
    return () => this.#watchers.delete(listener);
  }

  #changed(): void {
    if (this.#closed) return;
    for (const watcher of this.#watchers) {
      try {
        watcher();
      } catch {
        // A watcher that throws must not stop the others.
      }
    }
  }

  /**
   * Opens the `subscriptions/listen` stream for tool-list changes, on a 2026-07-28 server that advertises them, and
   * opens it again when it drops, with a growing delay and a limit on short-lived streams.
   */
  listen(): void {
    if (this.era !== MODERN_VERSION || this.#client.getServerCapabilities()?.tools?.listChanged !== true) return;
    void this.#openListen(false);
  }

  async #openListen(reopened: boolean): Promise<void> {
    if (this.#closed) return;
    const opened = this.#timers.now();
    let subscription: McpSubscription;
    try {
      subscription = await this.#client.listen({ toolsListChanged: true }, { timeout: this.#settings.requestMs });
    } catch (error) {
      this.#dropped(opened, `it could not be opened: ${describe(error, this.#settings.secrets)}`);
      return;
    }
    if (this.#closed) {
      await subscription.close().catch(() => {});
      return;
    }
    this.#subscription = subscription;
    // Changes the server made while no stream was open were never announced, so the list is read again.
    if (reopened) this.#changed();
    const cause = await subscription.closed;
    if (cause === "local" || this.#closed) return;
    // A stream the harness cut itself, for going quiet or for its total bytes, is opened again at once and is not a drop.
    if (this.#plannedListenCut()) this.#reopenListen(LISTEN_BASE_MS, "the harness cut it");
    else this.#dropped(opened, cause === "graceful" ? "the server ended it" : "it dropped");
  }

  #dropped(opened: number, why: string): void {
    if (this.#closed) return;
    if (this.#timers.now() - opened >= LISTEN_HEALTHY_MS) this.#listenDrops = 0;
    this.#listenDrops += 1;
    if (this.#listenDrops > MAX_LISTEN_DROPS) {
      this.#log(
        `the change stream of "${this.server}" ended ${MAX_LISTEN_DROPS} times in a row, so it is not opened again`,
      );
      return;
    }
    this.#reopenListen(Math.min(LISTEN_MAX_MS, LISTEN_BASE_MS * 2 ** (this.#listenDrops - 1)), why);
  }

  #reopenListen(delay: number, why: string): void {
    this.#log(`the change stream of "${this.server}" closed (${why}); it is opened again in ${delay} ms`);
    this.#listenTimer = this.#timers.setTimeout(() => {
      this.#listenTimer = undefined;
      void this.#openListen(true);
    }, delay);
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * The server's tools, read one page at a time. The walk stops as soon as the list passes `maxTools` or runs past
   * eight pages, so a server can make the harness hold at most one page beyond the limit, each page bounded by the
   * line limit. The client's own walk would gather every page before anything counted them.
   */
  async listTools(): Promise<readonly McpTool[]> {
    const listed: unknown[] = [];
    let cursor: string | undefined;
    for (let page = 1; ; page += 1) {
      const result = await this.#page(cursor);
      const tools = (result as { tools?: unknown }).tools;
      if (!Array.isArray(tools)) return checkToolList(this.server, tools, this.#settings.maxTools);
      listed.push(...tools);
      // One past the limit is enough for checkToolList() to refuse, so no later page is asked for.
      if (listed.length > this.#settings.maxTools) break;
      const next = (result as { nextCursor?: unknown }).nextCursor;
      if (typeof next !== "string" || next === "") break;
      if (page >= MAX_LIST_PAGES) {
        throw new McpError(
          "mcp_tool_list_refused",
          this.server,
          `its tool list was refused, so none of its tools was registered: it runs past ${MAX_LIST_PAGES} pages`,
        );
      }
      cursor = next;
    }
    return checkToolList(this.server, listed, this.#settings.maxTools);
  }

  async #page(cursor: string | undefined): Promise<unknown> {
    const options = { timeout: this.#settings.requestMs };
    try {
      // The first page goes as a plain request, since the client's listTools() with no cursor walks every page itself.
      return cursor === undefined
        ? await this.#client.request({ method: "tools/list" }, options)
        : await this.#client.listTools({ cursor }, options);
    } catch (error) {
      const why = describe(this.#refusal() ?? error, this.#settings.secrets);
      throw new McpError("mcp_tool_list_refused", this.server, `its tool list could not be read: ${why}`, {
        cause: error,
      });
    }
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
      const refusal = this.#refusal();
      const shown = refusal ?? (failure === "server_error" ? error : undefined);
      const detail = shown === undefined ? "" : `: ${describe(shown, this.#settings.secrets)}`;
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
      this.#watchers.clear();
      if (this.#listenTimer !== undefined) this.#timers.clearTimeout(this.#listenTimer);
      await this.#subscription?.close().catch(() => {});
      await this.#client.close().catch(() => {});
      await this.#channel.close().catch(() => {});
    })();
    return this.#closing;
  }
}

/** A channel, and for a remote one the bound that closed it, which explains a failure better than the library can. */
interface Opened {
  readonly channel: McpChannel;
  readonly refusal: () => Error | undefined;
  readonly plannedListenCut?: () => boolean;
}

function channelOf(config: McpServerConfig, log: (line: string) => void, timers: McpTimers): Opened {
  const transport = config.transport;
  const none = () => undefined;
  if (transport.kind === "stdio") return { channel: new StdioChannel(transport, log), refusal: none };
  if (transport.kind === "http" || transport.kind === "sse") return remoteChannel(transport, log, timers);
  return { channel: transport.channel, refusal: none };
}

/** What a handshake works with besides the channel. */
interface HandshakeContext {
  readonly config: McpServerConfig;
  readonly settings: Settings;
  readonly log: (line: string) => void;
  readonly timers: McpTimers;
}

/** Connects through `channel`, bounded by `connectMs`, and closes everything when it fails. */
async function handshake(
  context: HandshakeContext,
  opened: Opened,
  prior: "legacy" | undefined,
  deadline: { readonly ms: number; readonly signal: AbortSignal | undefined },
): Promise<Connection> {
  const { config, settings, log } = context;
  const { channel } = opened;
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
  // A changed list is passed to the connection's watchers, which read it again and diff it against the pins. The same
  // handler serves a legacy server's unsolicited notice and a 2026-07-28 server's notice on its listen stream.
  const hub: ChangeHub = { fire: () => {} };
  client.setNotificationHandler("notifications/tools/list_changed", () => {
    log(`the server "${config.name}" says its tool list changed`);
    hub.fire();
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
    return new Connection({
      server: config.name,
      client,
      channel,
      settings,
      era: era === "modern" ? MODERN_VERSION : "legacy",
      version,
      hub,
      timers: context.timers,
      log,
      refusal: opened.refusal,
      plannedListenCut: opened.plannedListenCut ?? (() => false),
    });
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
 * server; a server that crashes runs once. An `sse` server is spoken to as a legacy server, with no probe. The whole
 * connect, a restart included, takes at most `connectTimeoutMs`. `signal` aborts it, and the server is closed. On a
 * 2026-07-28 server that advertises tool-list changes, the connection opens a `subscriptions/listen` stream for them.
 * `timers` runs the stream's reopen delays; the default is the platform's.
 *
 * Throws a `HarnessError`, code `invalid_mcp_config`, for a config that can't be used, and an `McpError`, code
 * `mcp_connect_failed`, when the server does not start, does not finish the handshake within `connectTimeoutMs`, is
 * aborted, or negotiates a revision this harness does not know.
 */
export async function connectMcpServer(
  config: McpServerConfig,
  options: { readonly log?: (line: string) => void; readonly signal?: AbortSignal; readonly timers?: McpTimers } = {},
): Promise<McpConnection> {
  const settings = checkServerConfig(config);
  const log = options.log ?? (() => {});
  const timers = options.timers ?? systemTimers;
  const context: HandshakeContext = { config, settings, log, timers };
  const ends = Date.now() + settings.connectMs;
  const left = () => ({ ms: ends - Date.now(), signal: options.signal });
  const opened = channelOf(config, log, timers);
  const failed = (error: unknown) => {
    const cause = opened.refusal() ?? error;
    return new McpError("mcp_connect_failed", config.name, `it did not connect: ${describe(cause, settings.secrets)}`, {
      cause: error,
    });
  };
  const channel = opened.channel;
  const prior = config.transport.kind === "sse" ? "legacy" : undefined;
  let connection: Connection;
  try {
    connection = await handshake(context, opened, prior, left());
  } catch (first) {
    const exitedOnProbe = channel instanceof StdioChannel && channel.exitedOnProbe;
    if (!exitedOnProbe || options.signal?.aborted === true || left().ms <= 0) throw failed(first);
    log(`the server "${config.name}" closed after the probe, so it is started again as a legacy server`);
    try {
      connection = await handshake(context, channelOf(config, log, timers), "legacy", left());
    } catch (second) {
      throw failed(second);
    }
  }
  connection.listen();
  return connection;
}
