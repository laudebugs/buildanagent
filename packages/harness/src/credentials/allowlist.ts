/**
 * The egress proxy's configuration, checked once when it starts: the allowlist of names and the credential routes. A
 * bad entry throws, so a typo can't widen what leaves the machine. It is pure and portable.
 */
import { HarnessError } from "../errors.js";
import { isAddressLiteral } from "./addresses.js";
import { checkGitFilter, type GitRouteFilter } from "./git-route.js";

/** A host the proxy may reach on one port. A `*.` name matches every name under it, and never the name itself. */
export interface AllowEntry {
  readonly name: string;
  readonly wildcard: boolean;
  readonly port: number;
}

/** One credential route: where a request for `/<route>/…` goes, and how the proxy adds the credential. */
export interface CredentialRoute {
  /** The first part of the path the sandbox requests, such as `github`. Lower case letters, digits, `-` and `_`. */
  readonly route: string;
  /** The HTTPS host the request is forwarded to, such as `api.github.com`, with `:port` when it isn't 443. */
  readonly host: string;
  /** The methods the route accepts, such as `["GET"]`. A request with another method is refused. */
  readonly methods: readonly string[];
  /** The request header that carries the credential, such as `authorization`. */
  readonly header: string;
  /** The real secret, read at each request so a rotated key is used at once. It never enters the sandbox. */
  readonly secret: () => Promise<string>;
  /**
   * Makes the route a git route: only git's smart HTTP requests for the listed repositories pass, a push only to the
   * listed branches, and the secret goes in HTTP Basic as the password of `username`. Its `header` must be
   * `authorization` and its `methods` `GET` and `POST`. The sandbox's git sends the route's sentinel as its password.
   */
  readonly git?: GitRouteFilter;
}

/** A route with its host and port split, its method and header names normalised, and its sentinel. */
export interface ParsedRoute {
  readonly route: string;
  readonly hostname: string;
  readonly port: number;
  readonly methods: ReadonlySet<string>;
  readonly header: string;
  readonly secret: () => Promise<string>;
  readonly git?: GitRouteFilter;
}

const HOST_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const ROUTE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;
const METHOD = /^[A-Z]{3,10}$/;
// Headers the proxy sets or removes itself, so a route can't name one as its credential header.
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
]);

function invalid(message: string): HarnessError {
  return new HarnessError("invalid_egress_options", message);
}

/** The lower-case host name and the port of `text`, which is `name` or `name:port`, or an error. */
function splitHost(text: string, what: string): { name: string; port: number } {
  const [name = "", port, extra] = text.toLowerCase().split(":");
  const portNumber = port === undefined ? 443 : Number(port);
  if (extra !== undefined || !Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
    throw invalid(`${what} ${JSON.stringify(text)} has a bad port`);
  }
  return { name, port: portNumber };
}

/** Parses the allowlist: each entry is `name`, `*.name`, with `:port` when it isn't 443. */
export function parseAllow(entries: readonly string[]): AllowEntry[] {
  return entries.map((entry) => {
    const wildcard = entry.startsWith("*.");
    const { name, port } = splitHost(wildcard ? entry.slice(2) : entry, "the allowlist entry");
    if (!HOST_NAME.test(name) || isAddressLiteral(name)) {
      throw invalid(
        `the allowlist entry ${JSON.stringify(entry)} must be a host name, such as example.com or *.example.com`,
      );
    }
    return { name, wildcard, port };
  });
}

/** Whether `host` on `port` is on the allowlist. `host` is lower case, without a trailing dot. */
export function isAllowed(allow: readonly AllowEntry[], host: string, port: number): boolean {
  return allow.some(
    (entry) => entry.port === port && (entry.wildcard ? host.endsWith(`.${entry.name}`) : host === entry.name),
  );
}

/** Whether `name` is on the allowlist on any port, so a tunnel could reach it. */
const allowedOnAnyPort = (allow: readonly AllowEntry[], name: string): boolean =>
  allow.some((entry) => (entry.wildcard ? name.endsWith(`.${entry.name}`) : name === entry.name));

/**
 * The first git route that shares its host with a way around its filter, and what that way is: an allowlist entry, on
 * any port, that lets a tunnel reach the host, or another route to the same host, which would carry a credential there
 * without the git route's repository and ref checks. Hosts are compared in lower case without their ports.
 */
export function gitHostOverlap(
  routes: readonly Pick<CredentialRoute, "host" | "git">[],
  allow: readonly AllowEntry[],
): { readonly index: number; readonly with: "allow" | "route" } | undefined {
  const names = routes.map((route) =>
    String(route.host)
      .toLowerCase()
      .replace(/:[0-9]*$/, ""),
  );
  for (const [index, route] of routes.entries()) {
    if (route.git === undefined) continue;
    const name = names[index] ?? "";
    if (allowedOnAnyPort(allow, name)) return { index, with: "allow" };
    if (names.some((other, at) => at !== index && other === name)) return { index, with: "route" };
  }
  return undefined;
}

/**
 * Parses and checks the routes against the parsed allowlist. It refuses two routes with one name, and a git route whose
 * host is also on the allowlist or is another route's host, because either would go around its filter.
 */
export function parseRoutes(routes: readonly CredentialRoute[], allow: readonly AllowEntry[]): ParsedRoute[] {
  const seen = new Set<string>();
  const parsed = routes.map((route) => {
    if (!ROUTE_NAME.test(route.route)) throw invalid(`the route name ${JSON.stringify(route.route)} is not usable`);
    if (seen.has(route.route)) throw invalid(`two routes are named ${route.route}`);
    seen.add(route.route);
    return parseRoute(route);
  });
  const overlap = gitHostOverlap(routes, allow);
  if (overlap !== undefined) {
    const name = routes[overlap.index]?.route ?? "";
    throw invalid(
      overlap.with === "allow"
        ? `the host of the git route ${name} is also on the allowlist, so a tunnel could go around its filter`
        : `the host of the git route ${name} is another route's host, which could go around its filter`,
    );
  }
  return parsed;
}

/** Parses and checks one route's host, methods, header, secret and git filter. */
function parseRoute(route: CredentialRoute): ParsedRoute {
  const { name, port } = splitHost(route.host, "the route host");
  if (!HOST_NAME.test(name) || isAddressLiteral(name))
    throw invalid(`the route host ${route.host} must be a host name`);
  const methods = route.methods.map((method) => method.toUpperCase());
  if (methods.length === 0 || !methods.every((method) => METHOD.test(method)) || methods.includes("CONNECT")) {
    throw invalid(`the route ${route.route} needs a list of methods, such as ["GET"]`);
  }
  const header = route.header.toLowerCase();
  if (!HEADER_NAME.test(header) || RESERVED_HEADERS.has(header)) {
    throw invalid(`the route ${route.route} can't carry its credential in the header ${route.header}`);
  }
  if (typeof route.secret !== "function") throw invalid(`the route ${route.route} needs a secret function`);
  if (route.git !== undefined) checkGitRoute(route.git, methods, header);
  return {
    route: route.route,
    hostname: name,
    port,
    methods: new Set(methods),
    header,
    secret: route.secret,
    ...(route.git === undefined ? {} : { git: route.git }),
  };
}

/** Throws unless a git route carries its credential in `authorization` and takes exactly `GET` and `POST`. */
function checkGitRoute(filter: GitRouteFilter, methods: readonly string[], header: string): void {
  checkGitFilter(filter);
  if (header !== "authorization") throw invalid("a git route carries its credential in the authorization header");
  if (new Set(methods).size !== 2 || !methods.includes("GET") || !methods.includes("POST")) {
    throw invalid("a git route takes the methods GET and POST");
  }
}
