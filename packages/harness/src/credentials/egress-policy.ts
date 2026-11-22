/**
 * `EgressPolicy`: what a sandbox may reach, as plain data that names its credentials but never holds them, so a
 * backend can compile it, store it or send it to a hosted provider without carrying a secret. `compileEgressPolicy()`
 * compiles it for the local proxy, `startEgressProxy()`. It is portable: it imports no Node module.
 */
import { HarnessError } from "../errors.js";
import { isAddressLiteral } from "./addresses.js";
import { type CredentialRoute, gitHostOverlap, parseAllow, parseRoutes } from "./allowlist.js";
import { checkGitFilter, type GitRouteFilter } from "./git-route.js";

/** A route that swaps the sentinel in one request header for a credential, as `startEgressProxy()`'s routes do. */
export interface HeaderEgressRoute {
  readonly kind: "header";
  /** The first part of the path the sandbox requests, such as `github`. Lower case letters, digits, `-` and `_`. */
  readonly route: string;
  /** The HTTPS host the request is forwarded to, such as `api.github.com`, with `:port` when it isn't 443. */
  readonly host: string;
  /** The methods the route accepts, such as `["GET"]`. */
  readonly methods: readonly string[];
  /** The request header that carries the credential, such as `authorization`. */
  readonly header: string;
  /** The name of the credential the host injects, in upper case, such as `GITHUB_TOKEN`. Never the credential. */
  readonly credential: string;
}

/**
 * A route for git over HTTPS: git's smart HTTP requests for the listed repositories only, and a push only to the listed
 * branches. A deletion and a tag are always refused, and so is anything the route can't parse.
 */
export interface GitEgressRoute {
  readonly kind: "git";
  /** The first part of the path the sandbox's git remote uses, such as `git`. */
  readonly route: string;
  /** The git host, such as `github.com`. */
  readonly host: string;
  /** The repositories the route reaches, as `owner/name`. */
  readonly repositories: readonly string[];
  /** The branches a push may create or update, such as `refs/heads/agent/*`. Leave it out to refuse every push. */
  readonly pushRefs?: readonly string[];
  /** Whether a fetch or clone may read the repositories. Defaults to `false`. */
  readonly fetch?: boolean;
  /** The user name sent with the credential in HTTP Basic. Defaults to `x-access-token`, which GitHub App tokens use. */
  readonly username?: string;
  /** The name of the credential the host injects, in upper case, such as `GITHUB_TOKEN`. Never the credential. */
  readonly credential: string;
}

/** One credential route of an `EgressPolicy`. */
export type EgressRoute = HeaderEgressRoute | GitEgressRoute;

/** What a sandbox may reach: the hosts it may tunnel to, and the routes that add a credential on its behalf. */
export interface EgressPolicy {
  /** Exact host names, with `:port` when it isn't 443. A wildcard and an address literal are refused. */
  readonly allow: readonly string[];
  readonly routes: readonly EgressRoute[];
}

/** The options of `compileEgressPolicy()`. */
export interface CompileEgressOptions {
  /** Reads the credential a route names, at each request, on the host. It never runs in the sandbox. */
  readonly secret: (name: string) => Promise<string>;
}

/** A compiled policy: the `allow` and `routes` options of `startEgressProxy()`. */
export interface CompiledEgressPolicy {
  readonly allow: readonly string[];
  readonly routes: readonly CredentialRoute[];
}

const CREDENTIAL_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
// Well-known credential formats, matched at the start of a value or of a token in it, so a token pasted where its name
// belongs is refused while an ordinary name that merely contains such letters, such as acme/sk-api, is not. An AWS key
// id is matched only as a whole token, because its prefix starts ordinary upper-case names too.
const CREDENTIAL_SHAPED =
  /^(gh[pousr]_|github_pat_|xox[abposr]-|sk-|sk_live_|sk_test_|glpat-|AIza)|^(AKIA|ASIA)[0-9A-Z]{16}$/;
const AUTH_SCHEME = /^(Bearer|Basic) /i;
// What separates a pasted token from the text around it: white space, and the punctuation of `key=value`, `user:pass`,
// `user@host`, lists and quotes. A repository's `/` and a host's `.` are not separators.
const TOKEN_SEPARATOR = /[\s=:@,;"'`]+/;

/** Whether `text` looks like a credential, or carries one in a token or after an auth scheme. */
const credentialShaped = (text: string): boolean =>
  AUTH_SCHEME.test(text) || text.split(TOKEN_SEPARATOR).some((token) => CREDENTIAL_SHAPED.test(token));
const HEADER_FIELDS = new Set(["kind", "route", "host", "methods", "header", "credential"]);
const GIT_FIELDS = new Set(["kind", "route", "host", "repositories", "pushRefs", "fetch", "username", "credential"]);
const DEFAULT_GIT_USERNAME = "x-access-token";

const invalid = (message: string) => new HarnessError("invalid_egress_options", message);

/** Every string anywhere in `value`, for the scan that refuses a credential-shaped one. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/** Throws unless `entry` is an exact host name, with an optional port. The message names only its place. */
function checkHost(entry: unknown, where: string): void {
  const text = typeof entry === "string" ? entry : "";
  const name = text.replace(/:[0-9]+$/, "");
  if (text.includes("*") || name.startsWith("[") || isAddressLiteral(name)) {
    throw invalid(`${where} must be an exact host name, not a wildcard or an address`);
  }
  try {
    parseAllow([text]);
  } catch {
    // The proxy's own message quotes the entry, which this one must not.
    throw invalid(`${where} must be a host name, such as example.com`);
  }
}

/** Throws unless `route` has only its kind's fields and names its credential. */
function checkRoute(route: unknown, index: number): asserts route is EgressRoute {
  if (typeof route !== "object" || route === null) throw invalid(`route ${index} is not an object`);
  const kind = (route as { kind?: unknown }).kind;
  const fields = kind === "header" ? HEADER_FIELDS : kind === "git" ? GIT_FIELDS : undefined;
  if (fields === undefined) throw invalid(`route ${index} must have the kind header or git`);
  if (Object.keys(route).some((key) => !fields.has(key))) {
    throw invalid(`route ${index} has a field an egress route doesn't have, such as a credential's value`);
  }
  const credential = (route as { credential?: unknown }).credential;
  if (typeof credential !== "string" || !CREDENTIAL_NAME.test(credential)) {
    throw invalid(`route ${index} must name its credential in upper case, such as GITHUB_TOKEN, not hold it`);
  }
  checkHost((route as { host?: unknown }).host, `the host of route ${index}`);
  const { route: name, methods, pushRefs } = route as { route?: unknown; methods?: unknown; pushRefs?: unknown };
  const listed = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
  if (typeof name !== "string" || (kind === "header" && !listed(methods))) {
    throw invalid(`route ${index} needs a name and, for a header route, a list of methods`);
  }
  if (kind === "git" && pushRefs !== undefined && !listed(pushRefs))
    throw invalid(`route ${index}'s pushRefs is not a list`);
}

/** The proxy's filter for a git route, with its defaults filled in. */
function gitFilter(route: GitEgressRoute): GitRouteFilter {
  return {
    repositories: Array.isArray(route.repositories) ? [...route.repositories] : [],
    pushRefs: [...(route.pushRefs ?? [])],
    fetch: route.fetch ?? false,
    username: route.username ?? DEFAULT_GIT_USERNAME,
  };
}

/** The local proxy's route for one checked egress route. */
function toCredentialRoute(route: EgressRoute, options: CompileEgressOptions): CredentialRoute {
  const secret = () => options.secret(route.credential);
  if (route.kind === "header") {
    return { route: route.route, host: route.host, methods: [...route.methods], header: route.header, secret };
  }
  return {
    route: route.route,
    host: route.host,
    methods: ["GET", "POST"],
    header: "authorization",
    secret,
    git: gitFilter(route),
  };
}

/** Throws unless each git route's filter is usable and no tunnel or other route reaches its host. */
function checkGitRoutes(routes: readonly EgressRoute[], allow: readonly string[]): void {
  const overlap = gitHostOverlap(
    routes.map((route) => ({ host: route.host, ...(route.kind === "git" ? { git: gitFilter(route) } : {}) })),
    parseAllow(allow),
  );
  if (overlap?.with === "allow") {
    throw invalid(
      `the host of git route ${overlap.index} is also in allow, so a tunnel could go around its ref filter`,
    );
  }
  if (overlap?.with === "route") {
    throw invalid(
      `the host of git route ${overlap.index} is another route's host, so that route could go around its ref filter`,
    );
  }
  for (const [index, route] of routes.entries()) {
    if (route.kind !== "git") continue;
    try {
      checkGitFilter(gitFilter(route));
    } catch (error) {
      // The filter's messages name a field and its place, never its value.
      throw invalid(`git route ${index} is not usable: ${(error as Error).message}`);
    }
  }
}

/**
 * Checks `policy` and compiles it for `startEgressProxy()`: pass the result's `allow` and `routes` with a `log`.
 * Everything is refused that isn't plainly allowed, with `HarnessError` code `invalid_egress_options`, and the
 * message names the entry's place, never its value:
 *
 * - a field a route kind doesn't have, such as `secret` or `token`, and a credential that is not an upper-case name;
 * - any string in the policy that looks like a credential, such as one starting `ghp_` or `sk-`;
 * - a wildcard or an address literal in `allow` or a route's host;
 * - a git route whose host is also in `allow`, because a tunnel to it would go around the ref filter, and a git route
 *   whose host is another route's host, because that route would carry a credential there without the ref filter;
 * - a git route with no repository, a push ref outside `refs/heads/`, or neither a push nor a fetch.
 *
 * The compiled routes read each credential through `options.secret` at every request, so a rotated one is used at once.
 */
export function compileEgressPolicy(policy: EgressPolicy, options: CompileEgressOptions): CompiledEgressPolicy {
  if (typeof options?.secret !== "function") throw invalid("compileEgressPolicy needs a secret function");
  const { allow, routes } = (policy ?? {}) as Partial<EgressPolicy>;
  if (!Array.isArray(allow) || !Array.isArray(routes)) throw invalid("an egress policy has an allow and a routes list");
  if (Object.keys(policy).some((key) => key !== "allow" && key !== "routes")) {
    throw invalid("an egress policy has only allow and routes");
  }
  if (strings(policy).some(credentialShaped)) {
    throw invalid("the egress policy holds what looks like a credential; name it in a route's credential instead");
  }
  for (const [index, entry] of allow.entries()) checkHost(entry, `allow entry ${index}`);
  for (const [index, route] of routes.entries()) checkRoute(route, index);
  checkGitRoutes(routes, allow);
  const compiled = routes.map((route) => toCredentialRoute(route, options));
  try {
    parseRoutes(compiled, parseAllow(allow));
  } catch {
    // The proxy's own message quotes the route's name or header, which this one must not.
    throw invalid("a route's name, methods or header is not usable, or two routes share a name");
  }
  return { allow: [...allow], routes: compiled };
}
