/**
 * The network under a remote server's fetch on Node, when no egress proxy is configured. Each request resolves the
 * server's name once, checks every address it gets against the server's address policy, connects to the first, and
 * checks the address the socket reached once more, so a name whose answer changes between two lookups can't steer a
 * request to the host's own network. It verifies certificates, asks for no compression, follows no redirect and keeps
 * no connection alive between requests. It loads Node's modules by `process.getBuiltinModule()` when a request is made,
 * so the `mcp` entry still loads on a runtime without them.
 */
import { isAddressLiteral } from "../credentials/addresses.js";
import type { FetchLike } from "./guarded-fetch.js";
import { RemoteRefusal } from "./guarded-fetch.js";
import type { RemoteSettings } from "./remote-config.js";

type IncomingMessage = import("node:http").IncomingMessage;

const bare = (host: string): string => (host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host);
const familyOf = (address: string): 4 | 6 => (address.includes(":") ? 6 : 4);

/** Whether this runtime has Node's network modules. */
export function hasNodeNetwork(): boolean {
  return typeof process !== "undefined" && typeof process.getBuiltinModule === "function";
}

/** The body a request sends: the client library sends JSON text, or nothing. */
async function bodyOf(init: RequestInit): Promise<Uint8Array | undefined> {
  if (init.body === undefined || init.body === null) return undefined;
  return new Uint8Array(await new Response(init.body).arrayBuffer());
}

/** A Web `Response` for a Node response. A body nobody can read is drained, so the socket closes. */
function toResponse(reply: IncomingMessage): Response {
  const stream = process.getBuiltinModule("node:stream");
  const headers = new Headers();
  for (const [name, value] of Object.entries(reply.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }
  const status = reply.statusCode ?? 0;
  // Node parses any three-digit status, and `Response` throws outside 200 to 599, so such an answer is refused here.
  if (status < 200 || status > 599) {
    reply.destroy();
    throw new RemoteRefusal("refused", `the server answered with status ${status}, which HTTP does not define`);
  }
  if ([204, 205, 304].includes(status)) {
    reply.resume();
    return new Response(null, { status, headers });
  }
  return new Response(stream.Readable.toWeb(reply) as ReadableStream<Uint8Array>, {
    status,
    statusText: reply.statusMessage ?? "",
    headers,
  });
}

type Resolve = (host: string) => Promise<readonly string[]>;
type ClientRequest = import("node:http").ClientRequest;

/** The system resolver: every address of a name, in the order the system gives them. */
const systemResolve: Resolve = async (host) =>
  (await process.getBuiltinModule("node:dns").promises.lookup(host, { all: true, verbatim: true })).map(
    (found) => found.address,
  );

/**
 * A `lookup` for `node:https`: it resolves the name once, refuses it when any address is one the server may not reach,
 * and hands back the first address alone, so the socket connects to that checked address and no other.
 */
function checkedLookup(settings: RemoteSettings, resolve: Resolve) {
  return (
    hostname: string,
    lookupOptions: { all?: boolean },
    callback: (error: Error | null, address?: unknown, family?: number) => void,
  ): void => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some((address) => !settings.allows(address))) {
          callback(new RemoteRefusal("refused", "the server's name resolves to an address it may not reach"));
          return;
        }
        const first = addresses[0] as string;
        if (lookupOptions.all === true) callback(null, [{ address: first, family: familyOf(first) }]);
        else callback(null, first, familyOf(first));
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
    );
  };
}

/** The request's headers for Node: no compression, a length for the body, and the URL's own `Host`. */
function nodeHeaders(init: RequestInit, url: URL, body: Uint8Array | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  headers["accept-encoding"] = "identity";
  if (body !== undefined) headers["content-length"] = String(body.length);
  headers.host = url.host;
  return headers;
}

/**
 * Checks the address the socket reached once it has connected: the lookup's answer is what it connected to, and this
 * proves it for a literal address and for any path around the lookup.
 */
function checkReached(request: ClientRequest, settings: RemoteSettings, secure: boolean): void {
  request.once("socket", (socket) => {
    socket.once(secure ? "secureConnect" : "connect", () => {
      const reached = socket.remoteAddress;
      if (reached === undefined || !settings.allows(reached)) {
        request.destroy(new RemoteRefusal("refused", "the connection reached an address the server may not use"));
      }
    });
  });
}

/** Settles with the response, refusing a compressed one, which the request did not ask for. */
function settle(request: ClientRequest, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const abort = () => request.destroy(signal?.reason instanceof Error ? signal.reason : new Error("aborted"));
    signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal?.removeEventListener("abort", abort));
    request.once("response", (reply) => {
      const encoding = String(reply.headers["content-encoding"] ?? "identity")
        .trim()
        .toLowerCase();
      if (encoding !== "identity" && encoding !== "") {
        reply.destroy();
        reject(new RemoteRefusal("refused", "the server compressed its answer, which the harness did not ask for"));
        return;
      }
      // A throw here would escape the event handler and end the process, so every failure becomes a rejection.
      try {
        resolve(toResponse(reply));
      } catch (error) {
        reply.destroy();
        reject(error);
      }
    });
    request.once("error", (error) => reject(signal?.aborted ? signal.reason : error));
  });
}

/** The pinned fetch, for one server's settings. */
export function nodeFetch(
  settings: RemoteSettings,
  options: { readonly resolve?: Resolve | undefined; readonly ca?: string | readonly string[] | undefined },
): FetchLike {
  const lookup = checkedLookup(settings, options.resolve ?? systemResolve);
  return async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.href);
    const host = bare(url.hostname);
    const literal = isAddressLiteral(host);
    // A literal address is checked as it is, since Node looks nothing up for it; a name is looked up once, in `lookup`.
    if (literal && !settings.allows(host))
      throw new RemoteRefusal("refused", "the server's address is one it may not reach");
    const secure = url.protocol === "https:";
    const body = await bodyOf(init);
    const signal = init.signal ?? undefined;
    signal?.throwIfAborted();
    const request = process
      .getBuiltinModule(secure ? "node:https" : "node:http")
      .request(requestOptions(url, init, body, literal ? undefined : lookup, options.ca));
    checkReached(request, settings, secure);
    const response = settle(request, signal);
    request.end(body);
    return response;
  };
}

/** The options of one Node request: no shared agent, the checked lookup for a name, and TLS settings for `https:`. */
function requestOptions(
  url: URL,
  init: RequestInit,
  body: Uint8Array | undefined,
  lookup: ReturnType<typeof checkedLookup> | undefined,
  ca: string | readonly string[] | undefined,
) {
  const host = bare(url.hostname);
  const secure = url.protocol === "https:";
  const port = url.port !== "" ? Number(url.port) : secure ? 443 : 80;
  return {
    protocol: url.protocol,
    hostname: host,
    port,
    method: init.method ?? "GET",
    path: `${url.pathname}${url.search}`,
    headers: nodeHeaders(init, url, body),
    agent: false as const,
    ...(lookup === undefined ? {} : { lookup: lookup as never }),
    ...(secure ? tlsOptions(lookup === undefined ? undefined : host, ca) : {}),
  };
}

/** Certificates are always verified, against the system's authorities or the server's own `ca`, over TLS 1.2 or later. */
function tlsOptions(servername: string | undefined, ca: string | readonly string[] | undefined) {
  return {
    ...(servername === undefined ? {} : { servername }),
    rejectUnauthorized: true,
    minVersion: "TLSv1.2" as const,
    ...(ca === undefined ? {} : { ca: ca as string | string[] }),
  };
}
