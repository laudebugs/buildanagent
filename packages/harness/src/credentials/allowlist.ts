/**
 * The egress proxy's configuration, checked once when it starts: the allowlist of names and the credential routes. A
 * bad entry throws, so a typo can't widen what leaves the machine. It is pure and portable.
 */
import { HarnessError } from "../errors.js";
import { isAddressLiteral } from "./addresses.js";

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
}

/** A route with its host and port split, its method and header names normalised, and its sentinel. */
export interface ParsedRoute {
  readonly route: string;
  readonly hostname: string;
  readonly port: number;
  readonly methods: ReadonlySet<string>;
  readonly header: string;
  readonly secret: () => Promise<string>;
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

/** Parses and checks the routes, and refuses two with one name. */
export function parseRoutes(routes: readonly CredentialRoute[]): ParsedRoute[] {
  const seen = new Set<string>();
  return routes.map((route) => {
    if (!ROUTE_NAME.test(route.route)) throw invalid(`the route name ${JSON.stringify(route.route)} is not usable`);
    if (seen.has(route.route)) throw invalid(`two routes are named ${route.route}`);
    seen.add(route.route);
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
    return { route: route.route, hostname: name, port, methods: new Set(methods), header, secret: route.secret };
  });
}
