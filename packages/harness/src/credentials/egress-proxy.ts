/**
 * `startEgressProxy()`: the host-side proxy that keeps credentials out of the sandbox. Nothing leaves the sandbox except
 * through it, it refuses everything that isn't on its allowlist, and it logs each request without its headers. A tool
 * that needs a credential sends its request to a local route, such as `http://127.0.0.1:<port>/github/user`, with the
 * route's sentinel where the credential goes. The proxy checks the sentinel and the method, swaps in the real secret and
 * forwards the request over HTTPS. It never intercepts TLS: everything else leaves through `CONNECT` to an
 * allowlisted name, and a name is connected to only at an address the proxy checked. It is Node-only.
 */
import { HarnessError } from "../errors.js";
import { isAddressLiteral, isPublicAddress } from "./addresses.js";
import {
  type AllowEntry,
  type CredentialRoute,
  isAllowed,
  type ParsedRoute,
  parseAllow,
  parseRoutes,
} from "./allowlist.js";
import { basicCarries, basicHeader, type GitRouteFilter, gitEndpoint, PushReader, pushVerdict } from "./git-route.js";

export type { CredentialRoute } from "./allowlist.js";

/** One line of the egress log. It names the host and the outcome, and never holds a header, a body or a secret. */
export interface EgressRecord {
  /** When the request ended, as an ISO 8601 string. */
  readonly time: string;
  /** `connect` for a tunnel, `route` for a credential route and `fetch` for an in-process call. */
  readonly kind: "connect" | "route" | "fetch";
  /** The host the request was for. */
  readonly host: string;
  readonly port: number;
  readonly method: string;
  /** The status the sandbox saw: 200 for an established tunnel, 403 for a refusal, 502 for a failed connection. */
  readonly status: number;
  /** The bytes that went both ways, 0 for a refusal. */
  readonly bytes: number;
  /** The route's name, for a route request. */
  readonly route?: string | undefined;
  /** Why a request was refused or failed, as a short code such as `not_allowed` or `address_refused`. */
  readonly reason?: string;
}

/** The options of `startEgressProxy()`. */
export interface EgressProxyOptions {
  /** The names a tunnel or an in-process fetch may reach: `example.com`, `*.example.com`, or either with `:port`. */
  readonly allow: readonly string[];
  /** The credential routes. Without any, the proxy only tunnels. */
  readonly routes?: readonly CredentialRoute[];
  /** Receives one record for each request. A throw from it is ignored. */
  readonly log: (record: EgressRecord) => void;
  /** Listens on this Unix socket instead of a port on `127.0.0.1`, so a container can mount it (`dockerSandbox`'s `proxySocket`). */
  readonly socketPath?: string;
  /** Extra certificate authorities to trust for the routes' hosts and for the fetch, such as a test's own. */
  readonly ca?: string | Uint8Array | readonly (string | Uint8Array)[];
  /** Resolves a name to its addresses. Defaults to the system resolver. Every address it returns is checked. */
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  /**
   * Addresses that skip the public-address check. This exists so a test can reach a server on `127.0.0.1`. Never set it
   * for a real run: the check is what keeps a name that points at the host's own network from being reached.
   */
  readonly unsafeAllowAddresses?: readonly string[];
  /** Ends a tunnel, a forwarded request or a push check that is idle this long. Defaults to 120000. */
  readonly idleTimeoutMs?: number;
}

/** A running egress proxy. */
export interface EgressProxy {
  /**
   * Where the sandbox sends its requests: give it as `HTTPS_PROXY`, and join a route's name to it for a route. On a Unix
   * socket it is `unix:<path>`, which is not a proxy URL: the program that uses the socket connects to it itself.
   */
  readonly url: string;
  /** The Unix socket the proxy listens on, when it was started with `socketPath`. */
  readonly socketPath?: string;
  /** For each route, the placeholder the sandbox puts where the credential goes. The real secret never leaves the host. */
  readonly sentinels: Readonly<Record<string, string>>;
  /**
   * Fetches `input` for an in-process tool, under the same allowlist. A host that isn't on it rejects with `egress_denied`.
   * A route is reached at `${proxy.url}/<route>/…`, or at `http://egress.proxy/<route>/…`, which also works on a Unix socket.
   */
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  /** The routes' secrets now, for `scrubSecrets()`. */
  knownSecrets(): Promise<readonly string[]>;
  /** Stops listening and ends every open tunnel and request. */
  close(): Promise<void>;
}

type Modules = {
  readonly http: typeof import("node:http");
  readonly https: typeof import("node:https");
  readonly net: typeof import("node:net");
  readonly dns: typeof import("node:dns");
  readonly crypto: typeof import("node:crypto");
  readonly stream: typeof import("node:stream");
};

function nodeModules(): Modules {
  if (typeof process === "undefined" || typeof process.getBuiltinModule !== "function") {
    throw new HarnessError(
      "invalid_egress_options",
      "the egress proxy needs Node's network modules, which this runtime lacks",
    );
  }
  return {
    http: process.getBuiltinModule("node:http"),
    https: process.getBuiltinModule("node:https"),
    net: process.getBuiltinModule("node:net"),
    dns: process.getBuiltinModule("node:dns"),
    crypto: process.getBuiltinModule("node:crypto"),
    stream: process.getBuiltinModule("node:stream"),
  };
}

// Headers that belong to one connection, and are never passed on to the next.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);
const DEFAULT_IDLE_MS = 120_000;
// What Node refuses in a header value: anything but tab, printable ASCII and the Latin-1 range. A secret with a line break
// or another control character would split or break the request, so it is refused before it is sent.
const INVALID_HEADER_VALUE = /[^\t\x20-\x7e\x80-\xff]/;
// The origin an in-process tool uses for a route, in either mode, because a Unix socket has no address of its own.
const ROUTE_ORIGIN = "http://egress.proxy";

/** What a request for a route resolves to, before it is written to a socket or wrapped in a `Response`. */
interface RouteReply {
  readonly status: number;
  readonly headers: Record<string, string | string[]>;
  readonly body: import("node:stream").Readable | undefined;
  readonly reason?: string;
}

const refusal = (status: number, reason: string): RouteReply => ({
  status,
  headers: { "content-type": "text/plain" },
  body: undefined,
  reason,
});

/**
 * The answer to a git request whose credential is missing or wrong, or `undefined` when its HTTP Basic password is the
 * route's sentinel. A missing one gets 401 with a Basic challenge, so git asks its credential helper.
 */
function gitCredentialRefusal(presented: string | string[] | undefined, sentinel: string): RouteReply | undefined {
  if (presented === undefined) {
    return { ...refusal(401, "git_credential_missing"), headers: { "www-authenticate": 'Basic realm="egress"' } };
  }
  return typeof presented === "string" && basicCarries(presented, sentinel) ? undefined : refusal(403, "bad_sentinel");
}

class EgressGate {
  private readonly modules: Modules;
  private readonly allow: readonly AllowEntry[];
  private readonly routes: ReadonlyMap<string, ParsedRoute>;
  private readonly sentinels: Record<string, string> = {};
  private readonly options: EgressProxyOptions;
  private readonly unsafe: ReadonlySet<string>;
  private readonly sockets = new Set<import("node:net").Socket>();
  private readonly requests = new Set<import("node:http").ClientRequest>();
  private origin = "";

  constructor(modules: Modules, options: EgressProxyOptions) {
    this.modules = modules;
    this.options = options;
    this.allow = parseAllow(options.allow);
    this.routes = new Map(parseRoutes(options.routes ?? [], this.allow).map((route) => [route.route, route]));
    this.unsafe = new Set(options.unsafeAllowAddresses ?? []);
    for (const route of this.routes.keys()) {
      this.sentinels[route] = `sentinel_${modules.crypto.randomBytes(18).toString("base64url")}`;
    }
  }

  setOrigin(origin: string): void {
    this.origin = origin;
  }

  sentinelMap(): Readonly<Record<string, string>> {
    return this.sentinels;
  }

  private record(record: Omit<EgressRecord, "time">): void {
    try {
      this.options.log({ time: new Date().toISOString(), ...record });
    } catch {
      // A logger that throws must not take the proxy down.
    }
  }

  /** A `lookup` for `net` and `https`: it resolves in the proxy, checks every address, and connects only to those. */
  private readonly checkedLookup = (
    hostname: string,
    lookupOptions: { all?: boolean },
    callback: (error: Error | null, address?: unknown, family?: number) => void,
  ): void => {
    const resolve =
      this.options.resolve ??
      (async (host: string) =>
        (await this.modules.dns.promises.lookup(host, { all: true })).map((found) => found.address));
    resolve(hostname).then(
      (addresses) => {
        const refused = addresses.length === 0 || addresses.some((a) => !isPublicAddress(a) && !this.unsafe.has(a));
        if (refused) {
          callback(
            Object.assign(new Error(`${hostname} resolves to an address the proxy refuses`), {
              code: "EGRESS_ADDRESS",
            }),
          );
          return;
        }
        const family = (address: string) => (address.includes(":") ? 6 : 4);
        if (lookupOptions.all === true) {
          callback(
            null,
            addresses.map((address) => ({ address, family: family(address) })),
          );
        } else {
          callback(null, addresses[0], family(addresses[0] ?? ""));
        }
      },
      (error: unknown) => callback(error as Error),
    );
  };

  private reasonOf(error: unknown): string {
    const code = (error as { code?: string }).code;
    if (code === "EGRESS_ADDRESS") return "address_refused";
    return code === "ETIMEDOUT" ? "timeout" : "connect_failed";
  }

  /** The host and port of a `CONNECT` target, or `undefined` for one that isn't `host:port`. */
  private parseTarget(target: string): { host: string; port: number } | undefined {
    const match = /^(\[[0-9a-fA-F:.]+\]|[^:[\]]+):([0-9]{1,5})$/.exec(target);
    if (match === null) return undefined;
    const host = (match[1] ?? "").toLowerCase().replace(/\.$/, "");
    const port = Number(match[2]);
    return port >= 1 && port <= 65535 ? { host, port } : undefined;
  }

  /** Handles one `CONNECT`: allow-checks the name, then tunnels to the address the proxy checked. */
  handleConnect(request: import("node:http").IncomingMessage, client: import("node:net").Socket, head: Buffer): void {
    this.track(client);
    const target = this.parseTarget(request.url ?? "");
    const host = target?.host ?? "(invalid)";
    const port = target?.port ?? 0;
    const deny = (reason: string, status = 403) => {
      client.end(`HTTP/1.1 ${status} ${status === 403 ? "Forbidden" : "Bad Gateway"}\r\nConnection: close\r\n\r\n`);
      this.record({ kind: "connect", host, port, method: "CONNECT", status, bytes: 0, reason });
    };
    const refusedBecause =
      target === undefined
        ? "bad_target"
        : isAddressLiteral(host)
          ? "address_literal"
          : isAllowed(this.allow, host, port)
            ? undefined
            : "not_allowed";
    if (refusedBecause !== undefined) {
      deny(refusedBecause);
      return;
    }
    let established = false;
    const upstream = this.modules.net.connect({ host, port, lookup: this.checkedLookup as never });
    this.track(upstream);
    // A client that leaves before the tunnel is up takes the connection attempt with it.
    client.once("close", () => upstream.destroy());
    upstream.setTimeout(this.options.idleTimeoutMs ?? DEFAULT_IDLE_MS, () =>
      upstream.destroy(Object.assign(new Error("idle"), { code: "ETIMEDOUT" })),
    );
    upstream.once("error", (error) => {
      if (established) client.destroy();
      else deny(this.reasonOf(error), 502);
      upstream.destroy();
    });
    upstream.once("connect", () => {
      established = true;
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
      const done = () => {
        client.destroy();
        upstream.destroy();
      };
      client.once("close", done);
      upstream.once("close", () => {
        this.record({
          kind: "connect",
          host,
          port,
          method: "CONNECT",
          status: 200,
          bytes: upstream.bytesRead + upstream.bytesWritten,
        });
        done();
      });
    });
    client.once("error", () => upstream.destroy());
  }

  private track(socket: import("node:net").Socket): void {
    if (this.sockets.has(socket)) return;
    this.sockets.add(socket);
    socket.once("close", () => this.sockets.delete(socket));
    socket.on("error", () => {});
  }

  /** Handles one request that isn't a `CONNECT`: a route request, or a refusal of anything else. */
  handleRequest(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse): void {
    this.track(request.socket);
    const url = request.url ?? "";
    if (!url.startsWith("/")) {
      // A proxy request in absolute form: only a tunnel may leave, so the name is not even looked at.
      this.finish(response, refusal(403, "only_connect"), {
        kind: "route",
        host: "(proxy request)",
        port: 0,
        method: request.method ?? "",
      });
      return;
    }
    // A client that goes away takes the upstream request with it, so a credential isn't spent for nobody.
    const gone = new AbortController();
    response.once("close", () => gone.abort());
    const base = {
      kind: "route" as const,
      host: "(route)",
      port: 0,
      method: request.method ?? "GET",
      route: undefined,
    };
    this.routeRequest(request.method ?? "GET", url, request.headers, request, gone.signal).then(
      (reply) => this.finish(response, reply.reply, reply.base),
      () => this.finish(response, refusal(502, "request_failed"), base),
    );
  }

  private finish(
    response: import("node:http").ServerResponse,
    reply: RouteReply,
    base: Pick<EgressRecord, "kind" | "host" | "port" | "method" | "route">,
  ): void {
    response.writeHead(reply.status, reply.headers);
    let bytes = 0;
    const report = () =>
      this.record({
        ...base,
        status: reply.status,
        bytes,
        ...(reply.reason === undefined ? {} : { reason: reply.reason }),
      });
    if (reply.body === undefined) {
      response.end(reply.status === 403 || reply.status >= 400 ? `${reply.reason ?? "refused"}\n` : undefined);
      report();
      return;
    }
    reply.body.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    reply.body.once("close", report);
    reply.body.once("error", () => response.destroy());
    response.once("close", () => reply.body?.destroy());
    reply.body.pipe(response);
  }

  /**
   * Resolves a request for `/<route>/…`. It checks the route, the method and the sentinel, swaps in the secret, and
   * forwards the request to the route's host. A request that fails any check is answered here, and nothing is sent.
   */
  async routeRequest(
    method: string,
    rawPath: string,
    headers: Record<string, string | string[] | undefined>,
    body: import("node:stream").Readable | Uint8Array | undefined,
    signal?: AbortSignal,
  ): Promise<{ reply: RouteReply; base: Pick<EgressRecord, "kind" | "host" | "port" | "method" | "route"> }> {
    const match = /^\/([^/?#]+)(\/[^?#]*)?(\?[^#]*)?$/.exec(rawPath);
    const route = match === null ? undefined : this.routes.get(match[1] ?? "");
    const base = {
      kind: "route" as const,
      host: route?.hostname ?? "(no route)",
      port: route?.port ?? 0,
      method,
      route: route?.route,
    };
    if (route === undefined || match === null) return { reply: refusal(403, "unknown_route"), base };
    if (!route.methods.has(method.toUpperCase())) return { reply: refusal(405, "method_not_allowed"), base };
    const target = { path: match[2] ?? "/", query: match[3] ?? "" };
    const reply =
      route.git === undefined
        ? await this.headerRequest(route, method, target, headers, body, signal)
        : await this.gitRequest(route, route.git, method, target, headers, body, signal);
    return { reply, base };
  }

  /** Resolves a request on a header route: it swaps the sentinel in the route's header for the secret. */
  private async headerRequest(
    route: ParsedRoute,
    method: string,
    target: { readonly path: string; readonly query: string },
    headers: Record<string, string | string[] | undefined>,
    body: import("node:stream").Readable | Uint8Array | undefined,
    signal?: AbortSignal,
  ): Promise<RouteReply> {
    const presented = headers[route.header];
    const sentinel = this.sentinels[route.route] ?? "";
    if (typeof presented !== "string" || sentinel === "" || !presented.includes(sentinel)) {
      return refusal(403, "bad_sentinel");
    }
    const secret = await route.secret().catch(() => "");
    if (secret === "" || INVALID_HEADER_VALUE.test(secret)) return refusal(502, "secret_unavailable");
    const outgoing = this.outgoingHeaders(
      headers,
      route,
      presented.replaceAll(sentinel, () => secret),
    );
    return this.forward(route, method, `${target.path}${target.query}`, outgoing, body, signal);
  }

  /**
   * Resolves a request on a git route. The endpoint and repository are checked first, then the sentinel in HTTP Basic,
   * then a push's command list, and only then is the secret read and the request forwarded with it. A missing
   * credential gets 401 with a Basic challenge, so git asks its credential helper for the sentinel.
   */
  private async gitRequest(
    route: ParsedRoute,
    filter: GitRouteFilter,
    method: string,
    target: { readonly path: string; readonly query: string },
    headers: Record<string, string | string[] | undefined>,
    body: import("node:stream").Readable | Uint8Array | undefined,
    signal?: AbortSignal,
  ): Promise<RouteReply> {
    const endpoint = gitEndpoint(filter, method, target.path, target.query);
    if ("refused" in endpoint) return refusal(403, endpoint.refused);
    const unauthorized = gitCredentialRefusal(headers.authorization, this.sentinels[route.route] ?? "");
    if (unauthorized !== undefined) return unauthorized;
    let forwarded = body;
    if (endpoint.service === "git-receive-pack" && endpoint.phase === "rpc") {
      const encoding = headers["content-encoding"];
      if (encoding !== undefined && encoding !== "identity") return refusal(403, "git_encoded_push");
      const checked = await this.checkPush(body, filter);
      if ("refused" in checked) return refusal(403, checked.refused);
      forwarded = checked.body;
    }
    const secret = await route.secret().catch(() => "");
    if (secret === "" || INVALID_HEADER_VALUE.test(secret)) return refusal(502, "secret_unavailable");
    const outgoing = this.outgoingHeaders(headers, route, basicHeader(filter.username, secret));
    return this.forward(route, method, `${target.path}${target.query}`, outgoing, forwarded, signal);
  }

  /**
   * Reads a push's command list and checks it, then hands back a body that starts with what was read. `PushReader`
   * reads each chunk once, so the check is linear in the bytes however small the chunks. The check gives up once the
   * body is idle for the idle timeout, which each chunk resets.
   */
  private checkPush(
    body: import("node:stream").Readable | Uint8Array | undefined,
    filter: GitRouteFilter,
  ): Promise<{ readonly refused: string } | { readonly body: import("node:stream").Readable | Uint8Array }> {
    if (body === undefined) return Promise.resolve({ refused: "git_bad_pkt_line" });
    if (body instanceof Uint8Array) {
      const verdict = pushVerdict(body, filter, true);
      return Promise.resolve(verdict === "allowed" ? { body } : { refused: (verdict as { refused: string }).refused });
    }
    return new Promise((resolve) => {
      const reader = new PushReader(filter);
      const chunks: Uint8Array[] = [];
      const idleMs = this.options.idleTimeoutMs ?? DEFAULT_IDLE_MS;
      const timedOut = () => settle({ refused: "git_timeout" });
      let idle = setTimeout(timedOut, idleMs);
      const settle = (outcome: { refused: string } | { body: import("node:stream").Readable }) => {
        clearTimeout(idle);
        body.off("data", onData);
        body.off("end", onEnd);
        body.off("error", onError);
        body.off("close", onError);
        resolve(outcome);
      };
      const judge = (verdict: ReturnType<PushReader["add"]>, ended: boolean) => {
        if (verdict === "incomplete") return;
        if (verdict !== "allowed") {
          settle(verdict);
          return;
        }
        const rest = new this.modules.stream.PassThrough();
        for (const chunk of chunks) rest.write(chunk);
        settle({ body: rest });
        if (ended) rest.end();
        else body.pipe(rest);
      };
      const onData = (chunk: Uint8Array) => {
        clearTimeout(idle);
        idle = setTimeout(timedOut, idleMs);
        chunks.push(chunk);
        judge(reader.add(chunk), false);
      };
      const onEnd = () => judge(reader.end(), true);
      const onError = () => settle({ refused: "request_failed" });
      body.on("data", onData);
      body.once("end", onEnd);
      body.once("error", onError);
      // A client that goes away before its command list ends would otherwise hold the check until the idle timeout.
      body.once("close", onError);
    });
  }

  private outgoingHeaders(
    headers: Record<string, string | string[] | undefined>,
    route: ParsedRoute,
    credential: string,
  ): Record<string, string | string[]> {
    const out: Record<string, string | string[]> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined && !HOP_BY_HOP.has(name)) out[name] = value;
    }
    out[route.header] = credential;
    out.host = route.port === 443 ? route.hostname : `${route.hostname}:${route.port}`;
    return out;
  }

  private forward(
    route: ParsedRoute,
    method: string,
    path: string,
    headers: Record<string, string | string[]>,
    body: import("node:stream").Readable | Uint8Array | undefined,
    signal?: AbortSignal,
  ): Promise<RouteReply> {
    return new Promise((resolve) => {
      let upstream: import("node:http").ClientRequest;
      try {
        upstream = this.openRoute(route, method, path, headers);
      } catch {
        resolve(refusal(502, "request_invalid"));
        return;
      }
      const stop = () => upstream.destroy(new Error("client gone"));
      if (signal?.aborted === true) stop();
      else signal?.addEventListener("abort", stop, { once: true });
      upstream.once("close", () => signal?.removeEventListener("abort", stop));
      this.requests.add(upstream);
      upstream.setTimeout(this.options.idleTimeoutMs ?? DEFAULT_IDLE_MS, () => upstream.destroy(new Error("idle")));
      upstream.once("close", () => this.requests.delete(upstream));
      upstream.once("response", (reply) => {
        const passed: Record<string, string | string[]> = {};
        for (const [name, value] of Object.entries(reply.headers)) {
          if (value !== undefined && !HOP_BY_HOP.has(name)) passed[name] = value;
        }
        resolve({ status: reply.statusCode ?? 502, headers: passed, body: reply });
      });
      upstream.once("error", (error) => resolve(refusal(502, this.reasonOf(error))));
      if (body === undefined) upstream.end();
      else if (body instanceof Uint8Array) upstream.end(body);
      else body.pipe(upstream);
    });
  }

  /** Opens the HTTPS request to a route's host, which throws for a header or path Node refuses. */
  private openRoute(
    route: ParsedRoute,
    method: string,
    path: string,
    headers: Record<string, string | string[]>,
  ): import("node:http").ClientRequest {
    return this.modules.https.request({
      host: route.hostname,
      port: route.port,
      servername: route.hostname,
      method,
      path,
      headers,
      agent: false,
      lookup: this.checkedLookup as never,
      ...(this.options.ca === undefined ? {} : { ca: this.options.ca as never }),
    });
  }

  /** An in-process fetch under the same allowlist, with the same address checks and pinned connection. */
  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const port = url.port === "" ? 443 : Number(url.port);
    const bodyBytes =
      request.method === "GET" || request.method === "HEAD" ? undefined : new Uint8Array(await request.arrayBuffer());
    if (url.origin === ROUTE_ORIGIN || (this.origin !== "" && url.origin === this.origin)) {
      return this.fetchRoute(request, url, bodyBytes);
    }
    const refuse = (reason: string): never => {
      this.record({ kind: "fetch", host, port, method: request.method, status: 403, bytes: 0, reason });
      throw new HarnessError("egress_denied", `the egress proxy refused ${url.host}: ${reason}`);
    };
    if (url.protocol !== "https:") return refuse("only_https");
    if (isAddressLiteral(host)) return refuse("address_literal");
    if (!isAllowed(this.allow, host, port)) return refuse("not_allowed");
    return this.sendFetch(request, url, host, port, bodyBytes);
  }

  private async fetchRoute(request: Request, url: URL, body: Uint8Array | undefined): Promise<Response> {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const path = `${url.pathname}${url.search}`;
    const { reply, base } = await this.routeRequest(request.method, path, headers, body, request.signal);
    const stream = reply.body;
    let bytes = 0;
    stream?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    const finished = () =>
      this.record({
        ...base,
        status: reply.status,
        bytes,
        ...(reply.reason === undefined ? {} : { reason: reply.reason }),
      });
    if (stream === undefined) finished();
    else stream.once("close", finished);
    return this.toResponse(reply.status, reply.headers, stream);
  }

  private sendFetch(
    request: Request,
    url: URL,
    host: string,
    port: number,
    body: Uint8Array | undefined,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      request.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
      });
      const upstream = this.modules.https.request({
        host,
        port,
        servername: host,
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host },
        agent: false,
        lookup: this.checkedLookup as never,
        ...(this.options.ca === undefined ? {} : { ca: this.options.ca as never }),
      });
      this.requests.add(upstream);
      const abort = () => upstream.destroy(request.signal.reason as Error);
      request.signal.addEventListener("abort", abort, { once: true });
      upstream.once("close", () => {
        this.requests.delete(upstream);
        request.signal.removeEventListener("abort", abort);
      });
      upstream.setTimeout(this.options.idleTimeoutMs ?? DEFAULT_IDLE_MS, () => upstream.destroy(new Error("idle")));
      upstream.once("response", (reply) => {
        let bytes = 0;
        reply.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
        });
        // The record is written when the response is done with, which also covers one that is never read to its end.
        reply.once("close", () =>
          this.record({ kind: "fetch", host, port, method: request.method, status: reply.statusCode ?? 0, bytes }),
        );
        resolve(this.toResponse(reply.statusCode ?? 502, reply.headers as Record<string, string | string[]>, reply));
      });
      upstream.once("error", (error) => {
        if (request.signal.aborted) {
          reject(request.signal.reason);
          return;
        }
        const reason = this.reasonOf(error);
        this.record({ kind: "fetch", host, port, method: request.method, status: 502, bytes: 0, reason });
        reject(
          new HarnessError("egress_denied", `the egress proxy could not reach ${url.host}: ${reason}`, {
            cause: error,
          }),
        );
      });
      upstream.end(body);
    });
  }

  private toResponse(
    status: number,
    headers: Record<string, string | string[]>,
    stream: import("node:stream").Readable | undefined,
  ): Response {
    const out = new Headers();
    for (const [name, value] of Object.entries(headers)) {
      for (const one of Array.isArray(value) ? value : [value]) out.append(name, one);
    }
    const bodiless = stream === undefined || [101, 204, 205, 304].includes(status);
    // A response with no body is drained, so its socket and its log record don't wait for a reader that never comes.
    if (bodiless) stream?.resume();
    const web = bodiless ? null : (this.modules.stream.Readable.toWeb(stream) as ReadableStream);
    return new Response(web, { status, headers: out });
  }

  async knownSecrets(): Promise<readonly string[]> {
    const secrets = await Promise.all([...this.routes.values()].map((route) => route.secret().catch(() => "")));
    return [...new Set(secrets.filter((secret) => secret !== ""))];
  }

  close(server: import("node:http").Server): Promise<void> {
    return new Promise((resolve) => {
      for (const socket of this.sockets) socket.destroy();
      for (const request of this.requests) request.destroy();
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

/**
 * Starts the egress proxy on `127.0.0.1` with a port the system picks, or on `socketPath`. The allowlist and routes are
 * checked first, and a bad entry throws `invalid_egress_options`. Give the sandbox `proxy.url` as `HTTPS_PROXY`, and
 * give a tool that needs a credential the route's URL and its sentinel.
 */
export async function startEgressProxy(options: EgressProxyOptions): Promise<EgressProxy> {
  const modules = nodeModules();
  const proxy = new EgressGate(modules, options);
  const server = modules.http.createServer((request, response) => proxy.handleRequest(request, response));
  server.on("connect", (request, socket, head) => proxy.handleConnect(request, socket as never, head));
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    if (options.socketPath === undefined) server.listen(0, "127.0.0.1", resolve);
    else server.listen(options.socketPath, resolve);
  });
  const address = server.address();
  const url =
    options.socketPath !== undefined
      ? `unix:${options.socketPath}`
      : `http://127.0.0.1:${(address as { port: number }).port}`;
  if (options.socketPath === undefined) proxy.setOrigin(url);
  return {
    url,
    ...(options.socketPath === undefined ? {} : { socketPath: options.socketPath }),
    sentinels: proxy.sentinelMap(),
    fetch: (input, init) => proxy.fetch(input, init),
    knownSecrets: () => proxy.knownSecrets(),
    close: () => proxy.close(server),
  };
}
