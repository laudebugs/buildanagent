/**
 * `egressGuard()`: a `fetch` wrapper that lets a model request leave only for one base URL and only with one
 * credential, so a provider that picked up another key or host from the environment fails instead of sending.
 */
import { SafetyError } from "./errors.js";
import { isCloudflareAiGatewayHost, isUnderBase, parseModelBaseUrl } from "./model-url.js";

/** The header that carries a provider's key: `x-api-key` for Anthropic, `authorization` for OpenAI. */
export type CredentialHeader = "authorization" | "x-api-key";

/** The one credential a guarded request must carry. */
export interface EgressCredential {
  /** The header the provider sends its key in. */
  readonly header: CredentialHeader;
  /** The header's exact value, such as `Bearer <key>` for `authorization` or the bare key for `x-api-key`. */
  readonly value: string;
}

/** The options of `egressGuard()`. */
export interface EgressGuardOptions {
  /** The base URL every request must stay under: same origin, and at or below its path. */
  readonly baseURL: string;
  /** The credential every request must carry, and the only one it may carry beside `gatewayToken`. */
  readonly credential: EgressCredential;
  /**
   * The token of a Cloudflare AI Gateway with authentication turned on, which the gateway reads from
   * `cf-aig-authorization`. The guard adds the header to each request, and it is the one other credential a request
   * may carry. The base URL must name one Cloudflare AI Gateway, `/v1/{account}/{gateway}`, so the token can reach no
   * other host or account. The token must be a non-empty string of printable ASCII characters with no whitespace, and
   * it is never read from the environment.
   */
  readonly gatewayToken?: string;
  /** The `fetch` that sends an allowed request. Defaults to `globalThis.fetch`, looked up on each request. */
  readonly fetch?: typeof fetch;
}

/**
 * Headers that carry a credential for some model provider or gateway. A guarded request carries the configured one
 * and none of the others, so a second key can't ride along beside the user's.
 */
export const CREDENTIAL_HEADERS: readonly string[] = Object.freeze([
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
  "cf-aig-authorization",
]);

/** The header that carries the token of a Cloudflare AI Gateway with authentication turned on. */
export const CLOUDFLARE_GATEWAY_TOKEN_HEADER = "cf-aig-authorization";

/** The header that tells Cloudflare AI Gateway never to bill a request to Cloudflare's own credentials. */
export const CLOUDFLARE_NO_WHOLESALE_HEADER = "cf-aig-no-wholesale";

function refuse(message: string): SafetyError {
  return new SafetyError("egress_refused", `egressGuard refused a model request: ${message}`);
}

/**
 * Checks the headers of a request: the configured credential is there, and no other credential header is, except
 * `cf-aig-authorization` carrying exactly the configured gateway token.
 */
function checkCredentials(headers: Headers, credential: EgressCredential, gatewayValue: string | undefined): void {
  const sent = headers.get(credential.header);
  if (sent === null) throw refuse(`it carries no ${credential.header} header`);
  if (sent !== credential.value) throw refuse(`its ${credential.header} header differs from the configured key`);
  for (const name of CREDENTIAL_HEADERS) {
    if (name === credential.header || !headers.has(name)) continue;
    if (name === CLOUDFLARE_GATEWAY_TOKEN_HEADER && gatewayValue !== undefined) {
      if (headers.get(name) !== gatewayValue)
        throw refuse(`its ${name} header differs from the configured gateway token`);
      continue;
    }
    throw refuse(`it carries a second credential header, ${name}`);
  }
}

// A token is printable ASCII: a header value can't hold a control character or a character above U+00FF, and
// whitespace in a token is a paste error.
const USABLE_TOKEN = /^[\x21-\x7e]+$/;

/**
 * The `cf-aig-authorization` value for a gateway token, or `undefined` when none is configured. `who` names the caller
 * in a refusal. A token needs a base URL that names one gateway, `/v1/{account}/{gateway}` on a Cloudflare AI Gateway
 * host, because a base URL of the host alone would let the token go to any account's gateway beneath it.
 */
export function checkGatewayToken(token: unknown, baseURL: unknown, who = "egressGuard"): string | undefined {
  if (token === undefined) return undefined;
  if (typeof token !== "string" || !USABLE_TOKEN.test(token)) {
    throw new SafetyError(
      "invalid_byok_config",
      `${who} needs a gatewayToken of printable ASCII characters, with no whitespace`,
    );
  }
  const parsed = parseModelBaseUrl(baseURL);
  if (!parsed.ok || !isCloudflareAiGatewayHost(parsed.url.hostname)) {
    throw new SafetyError(
      "invalid_byok_config",
      `${who} takes a gatewayToken only with a Cloudflare AI Gateway base URL, so the token can reach no other host`,
    );
  }
  const [, version, account, gateway] = parsed.url.path.split("/");
  if (version !== "v1" || !account || !gateway) {
    throw new SafetyError(
      "invalid_byok_config",
      `${who} takes a gatewayToken only with a base URL that names one gateway, /v1/{account}/{gateway}, so the token can reach no other account's gateway`,
    );
  }
  return `Bearer ${token}`;
}

function checkCredential(credential: EgressCredential | undefined): void {
  if (typeof credential !== "object" || credential === null) {
    throw new SafetyError("invalid_byok_config", "egressGuard needs a credential");
  }
  if (credential.header !== "authorization" && credential.header !== "x-api-key") {
    throw new SafetyError("invalid_byok_config", "egressGuard needs a credential header of authorization or x-api-key");
  }
  if (typeof credential.value !== "string" || credential.value.trim() === "") {
    throw new SafetyError("invalid_byok_config", "egressGuard needs a non-empty credential value");
  }
}

/**
 * Wraps `fetch` so a model request leaves only for `baseURL` and only with `credential`. The returned function
 * rejects with a `SafetyError`, code `egress_refused`, before anything is sent, when a request:
 *
 * - goes to another origin, or to a path outside the base URL's path;
 * - carries no `credential.header`, or one whose value differs from `credential.value`;
 * - carries any other credential header in `CREDENTIAL_HEADERS`. `cf-aig-authorization` is one of them, unless you
 *   configure a `gatewayToken`: the guard then adds `cf-aig-authorization: Bearer <token>`, and a request that
 *   carries that header with another value is refused too. Only that one gateway credential may ride along, and only to
 *   a Cloudflare AI Gateway host.
 *
 * Every request to a Cloudflare AI Gateway host also gets `cf-aig-no-wholesale: true`, so the gateway refuses to bill
 * Cloudflare's credentials even when its own setting is off. Redirects are never followed, because a redirect would
 * resend the key's header to wherever the response points. Error messages name headers, never their values.
 *
 * Throws a `SafetyError`, code `invalid_byok_config`, when the base URL or the credential is unusable, or when a
 * `gatewayToken` is unusable or the base URL does not name one Cloudflare AI Gateway.
 */
export function egressGuard(options: EgressGuardOptions): typeof fetch {
  const check = outgoingCheck(options.baseURL, options.credential, options.gatewayToken);
  const send = options.fetch;
  return async (input, init) => {
    const request = new Request(input, init);
    const headers = check(new URL(request.url), request.headers);
    const guarded = new Request(request, { headers, redirect: "manual" });
    return (send ?? globalThis.fetch)(guarded);
  };
}

/**
 * Builds the check every guarded request passes: the URL stays under the base URL, the headers carry the credential
 * and no other, and a Cloudflare AI Gateway request gains `cf-aig-no-wholesale`. Returns the headers to send.
 */
function outgoingCheck(
  baseURL: string,
  credentialOption: EgressCredential,
  gatewayToken: string | undefined,
): (url: URL, sent: Headers) => Headers {
  const parsed = parseModelBaseUrl(baseURL);
  if (!parsed.ok) throw new SafetyError("invalid_byok_config", `egressGuard: ${parsed.message}`);
  const base = parsed.url;
  checkCredential(credentialOption);
  const credential = { header: credentialOption.header, value: credentialOption.value };
  const gatewayValue = checkGatewayToken(gatewayToken, baseURL);
  return (url, sent) => {
    if (!isUnderBase(url, base)) throw refuse(`${url.host}${url.pathname} is outside the configured base URL`);
    const headers = new Headers(sent);
    checkCredentials(headers, credential, gatewayValue);
    if (isCloudflareAiGatewayHost(url.hostname)) headers.set(CLOUDFLARE_NO_WHOLESALE_HEADER, "true");
    if (gatewayValue !== undefined) headers.set(CLOUDFLARE_GATEWAY_TOKEN_HEADER, gatewayValue);
    return headers;
  };
}

/** The WebSocket constructor shape the AI SDK's providers call, with the handshake headers as a plain object. */
export type GuardableWebSocket = new (
  url: string | URL,
  protocols?: string | string[],
  options?: { headers?: Record<string, string | undefined> },
) => unknown;

// OpenAI's browser mode sends its key as the `openai-insecure-api-key.<key>` subprotocol, which no header check sees,
// so only the plain `realtime` subprotocol may pass.
function checkSubprotocols(protocols: string | string[] | undefined): void {
  for (const protocol of protocols === undefined ? [] : [protocols].flat()) {
    if (protocol !== "realtime") throw refuse("a WebSocket subprotocol other than realtime could carry a key");
  }
}

/**
 * The WebSocket counterpart of `egressGuard()`, for a provider that opens a socket instead of calling `fetch`, such
 * as `@ai-sdk/openai`'s realtime transcription. The handshake must pass the same checks before the socket opens, and
 * a refused one throws the same `SafetyError`. `WebSocket` defaults to `globalThis.WebSocket`, looked up on each
 * connection. It also refuses any subprotocol but `realtime`, because OpenAI's browser mode carries a key there. Not
 * exported from the package root.
 */
export function egressGuardWebSocket(
  options: Omit<EgressGuardOptions, "fetch"> & { readonly WebSocket?: GuardableWebSocket },
): GuardableWebSocket {
  const check = outgoingCheck(options.baseURL, options.credential, options.gatewayToken);
  const open = options.WebSocket;
  return function GuardedWebSocket(
    url: string | URL,
    protocols?: string | string[],
    init?: { headers?: Record<string, string | undefined> },
  ) {
    const target = new URL(url);
    // The base URL is http(s); compare the handshake on the same scheme, then open the socket on the original one.
    const asHttp = new URL(target);
    if (asHttp.protocol === "wss:") asHttp.protocol = "https:";
    else if (asHttp.protocol === "ws:") asHttp.protocol = "http:";
    else throw refuse(`a WebSocket must use wss or ws, not ${target.protocol}`);
    checkSubprotocols(protocols);
    const sent = new Headers();
    for (const [name, value] of Object.entries(init?.headers ?? {})) if (value !== undefined) sent.set(name, value);
    const headers = check(asHttp, sent);
    const Socket = open ?? (globalThis as { WebSocket?: GuardableWebSocket }).WebSocket;
    if (Socket === undefined) throw refuse("no WebSocket implementation is available");
    return new Socket(target, protocols, { headers: Object.fromEntries(headers) });
  } as unknown as GuardableWebSocket;
}
