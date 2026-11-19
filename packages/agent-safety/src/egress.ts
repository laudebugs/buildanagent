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
  /** The credential every request must carry, and the only one it may carry. */
  readonly credential: EgressCredential;
  /** The `fetch` that sends an allowed request. Defaults to `globalThis.fetch`, looked up on each request. */
  readonly fetch?: typeof fetch;
}

/**
 * Headers that carry a credential for some model provider or gateway. A guarded request carries the configured one
 * and none of the others, so a second key can't ride along beside the user's.
 */
export const CREDENTIAL_HEADERS: readonly string[] = [
  "authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "proxy-authorization",
  "cf-aig-authorization",
];

/** The header that tells Cloudflare AI Gateway never to bill a request to Cloudflare's own credentials. */
export const CLOUDFLARE_NO_WHOLESALE_HEADER = "cf-aig-no-wholesale";

function refuse(message: string): SafetyError {
  return new SafetyError("egress_refused", `egressGuard refused a model request: ${message}`);
}

function checkCredentials(headers: Headers, credential: EgressCredential): void {
  const sent = headers.get(credential.header);
  if (sent === null) throw refuse(`it carries no ${credential.header} header`);
  if (sent !== credential.value) throw refuse(`its ${credential.header} header differs from the configured key`);
  for (const name of CREDENTIAL_HEADERS) {
    if (name !== credential.header && headers.has(name)) throw refuse(`it carries a second credential header, ${name}`);
  }
}

function checkCredential(credential: EgressCredential): void {
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
 * - carries any other credential header in `CREDENTIAL_HEADERS`.
 *
 * Every request to a Cloudflare AI Gateway host also gets `cf-aig-no-wholesale: true`, so the gateway refuses to bill
 * Cloudflare's credentials even when its own setting is off. Redirects are never followed, because a redirect would
 * resend the key's header to wherever the response points. Error messages name headers, never their values.
 *
 * Throws a `SafetyError`, code `invalid_byok_config`, when the base URL or the credential is unusable.
 */
export function egressGuard(options: EgressGuardOptions): typeof fetch {
  const parsed = parseModelBaseUrl(options.baseURL);
  if (!parsed.ok) throw new SafetyError("invalid_byok_config", `egressGuard: ${parsed.message}`);
  const base = parsed.url;
  checkCredential(options.credential);
  const credential = { header: options.credential.header, value: options.credential.value };
  const send = options.fetch;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (!isUnderBase(url, base)) throw refuse(`${url.host}${url.pathname} is outside the configured base URL`);
    const headers = new Headers(request.headers);
    checkCredentials(headers, credential);
    if (isCloudflareAiGatewayHost(url.hostname)) headers.set(CLOUDFLARE_NO_WHOLESALE_HEADER, "true");
    const guarded = new Request(request, { headers, redirect: "manual" });
    return (send ?? globalThis.fetch)(guarded);
  };
}
