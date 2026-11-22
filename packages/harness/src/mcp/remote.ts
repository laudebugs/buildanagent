/**
 * A remote server as a channel: the client library's streamable HTTP or SSE transport, with every request sent through
 * `guardedFetch()`. The network under it is the egress proxy when one is configured, the pinned Node fetch on Node,
 * and the platform's own `fetch` elsewhere, such as on Cloudflare, where the harness can't resolve a name itself.
 *
 * The library's reconnects are bounded here too. A streamable HTTP stream that drops is reopened by the library after
 * a delay this module sets: one second, doubling to thirty, whatever the server says, and at most `MAX_REOPENS` times
 * in ten minutes before the connection closes. A legacy SSE stream is opened once: when it ends, the connection closes.
 */
import { SSEClientTransport, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { isAddressLiteral, isLoopbackAddress } from "../credentials/addresses.js";
import { type FetchLike, guardedFetch, RemoteRefusal } from "./guarded-fetch.js";
import { hasNodeNetwork, nodeFetch } from "./http-node.js";
import { checkRemoteTransport, type RemoteSettings, redact } from "./remote-config.js";
import type { McpChannel, McpHttpTransport, McpSseTransport, McpTimers } from "./types.js";

const MIN_REOPEN_MS = 1000;
const MAX_REOPEN_MS = 30_000;
const MAX_REOPENS = 10;
const REOPEN_WINDOW_MS = 10 * 60 * 1000;

/**
 * The platform's fetch, for a runtime without Node's network modules. It can't resolve a name, so it checks a literal
 * address, counts `localhost` and a name under `.localhost` as loopback, and leaves where any other name goes to the
 * platform. Plain `http:` reaches a loopback literal or a localhost name only.
 */
export function platformFetch(settings: RemoteSettings): FetchLike {
  return (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.href);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const local = host === "localhost" || host.endsWith(".localhost");
    if ((isAddressLiteral(host) && !settings.allows(host)) || (local && !settings.allows("127.0.0.1"))) {
      return Promise.reject(new RemoteRefusal("refused", "the server's address is one it may not reach"));
    }
    if (url.protocol === "http:" && !(local || (isAddressLiteral(host) && isLoopbackAddress(host)))) {
      return Promise.reject(new RemoteRefusal("refused", "plain http: reaches only a loopback address"));
    }
    return globalThis.fetch(url, { ...init, redirect: "manual" });
  };
}

/** The network a remote server's requests go out on. */
function networkOf(transport: McpHttpTransport | McpSseTransport, settings: RemoteSettings): FetchLike {
  const proxy = transport.proxy;
  if (proxy !== undefined) return (input, init) => proxy.fetch(input, { ...init, redirect: "manual" });
  if (hasNodeNetwork()) return nodeFetch(settings, { resolve: transport.resolve, ca: transport.ca });
  return platformFetch(settings);
}

/**
 * The reconnect schedule the library's streamable HTTP transport uses: a delay of its own choosing within one to
 * thirty seconds, and a budget of reopens per window. Past the budget it closes the channel instead.
 */
function reopenSchedule(timers: McpTimers, onExhausted: () => void) {
  const recent: number[] = [];
  return (reconnect: () => void, _delay: number, attempt: number): (() => void) => {
    const now = timers.now();
    while (recent.length > 0 && now - (recent[0] as number) > REOPEN_WINDOW_MS) recent.shift();
    if (recent.length >= MAX_REOPENS) {
      onExhausted();
      return () => {};
    }
    recent.push(now);
    const delay = Math.min(MAX_REOPEN_MS, MIN_REOPEN_MS * 2 ** Math.max(attempt, recent.length - 1));
    const handle = timers.setTimeout(reconnect, delay);
    return () => timers.clearTimeout(handle);
  };
}

/** A remote channel and what the connection needs to know about it. */
export interface RemoteChannel {
  readonly channel: McpChannel;
  readonly settings: RemoteSettings;
  /** The bound a response broke that closed the connection, if one did. */
  readonly refusal: () => RemoteRefusal | undefined;
}

/** Builds the channel for a remote server. Nothing is sent until the client starts it. */
export function remoteChannel(
  transport: McpHttpTransport | McpSseTransport,
  log: (line: string) => void,
  timers: McpTimers,
): RemoteChannel {
  const settings = checkRemoteTransport(transport);
  const say = (line: string) => log(redact(line, settings.secrets));
  let channel: McpChannel | undefined;
  const closeChannel = () => {
    void channel?.close().catch(() => {});
  };
  let gets = 0;
  const onGet =
    transport.kind === "sse"
      ? () => {
          gets += 1;
          if (gets === 1) return true;
          say("the server's event stream ended, so the connection was closed; nothing reconnects it");
          closeChannel();
          return false;
        }
      : undefined;
  let refusal: RemoteRefusal | undefined;
  const onBroken = (error: RemoteRefusal, fatal: boolean) => {
    if (!fatal) {
      say(`a stream of the server was cut and may be opened again: ${error.message}`);
      return;
    }
    refusal ??= error;
    say(`the connection was closed: ${error.message}`);
    closeChannel();
  };
  const fetch = guardedFetch(networkOf(transport, settings), settings, {
    ...(onGet === undefined ? {} : { onGet }),
    onBroken,
    log: say,
  });
  if (transport.kind === "sse") {
    channel = new SSEClientTransport(settings.url, { fetch, eventSourceInit: { fetch } }) as unknown as McpChannel;
  } else {
    const schedule = reopenSchedule(timers, () => {
      say(`the server's stream dropped ${MAX_REOPENS} times in ten minutes, so the connection was closed`);
      closeChannel();
    });
    channel = new StreamableHTTPClientTransport(settings.url, {
      fetch,
      reconnectionScheduler: schedule,
      reconnectionOptions: {
        initialReconnectionDelay: MIN_REOPEN_MS,
        maxReconnectionDelay: MAX_REOPEN_MS,
        reconnectionDelayGrowFactor: 2,
        maxRetries: 2,
      },
    }) as unknown as McpChannel;
  }
  return { channel, settings, refusal: () => refusal };
}
