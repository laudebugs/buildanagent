/**
 * The rules a model provider's base URL must meet before a key may travel to it, shared by `egressGuard()`,
 * `explicitProvider()` and `checkModelRoutes()` so the three never disagree.
 */

/** The host of Cloudflare AI Gateway's provider endpoints, as in `https://gateway.ai.cloudflare.com/v1/…`. */
export const CLOUDFLARE_AI_GATEWAY_HOST = "gateway.ai.cloudflare.com";

// The host `@ai-sdk/gateway` 4.0.135 sends to when no base URL is given. Vercel AI Gateway falls back to Vercel's
// own billed keys unless a team dashboard setting is off, and nothing a deploy produces records that setting, so the
// package refuses the host outright (close-sdk-gaps SG4).
const VERCEL_AI_GATEWAY_HOST = "ai-gateway.vercel.sh";

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/** Why a base URL was refused. */
export type BaseUrlProblem = "invalid_base_url" | "vercel_ai_gateway";

/** A base URL that passed the rules: the origin and the path prefix every request must stay under. */
export interface ModelBaseUrl {
  readonly origin: string;
  /** The base URL's path without a trailing slash, such as `/v1`, or the empty string for the root. */
  readonly path: string;
  readonly hostname: string;
}

export type ParsedBaseUrl =
  | { readonly ok: true; readonly url: ModelBaseUrl }
  | { readonly ok: false; readonly problem: BaseUrlProblem; readonly message: string };

function hostIs(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`);
}

/** True for a Cloudflare AI Gateway host. */
export function isCloudflareAiGatewayHost(hostname: string): boolean {
  return hostIs(hostname.toLowerCase(), CLOUDFLARE_AI_GATEWAY_HOST);
}

/**
 * Checks a base URL: an absolute `https:` URL (or `http:` on a loopback host, for a local proxy), with no user name,
 * password, query or fragment, and not on Vercel AI Gateway. The messages name the rule, never the URL's contents
 * beyond its host.
 */
export function parseModelBaseUrl(baseURL: unknown): ParsedBaseUrl {
  const refuse = (message: string): ParsedBaseUrl => ({ ok: false, problem: "invalid_base_url", message });
  if (typeof baseURL !== "string" || baseURL.trim() === "") return refuse("the base URL is missing or empty");
  let url: URL;
  try {
    url = new URL(baseURL);
  } catch {
    return refuse("the base URL is not an absolute URL");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.test(hostname))) {
    return refuse(`the base URL must use https (http only on a loopback host), not ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") return refuse("the base URL must not carry a user name or password");
  if (url.search !== "" || url.hash !== "") return refuse("the base URL must not carry a query or fragment");
  if (hostIs(hostname, VERCEL_AI_GATEWAY_HOST)) {
    return {
      ok: false,
      problem: "vercel_ai_gateway",
      message: `${hostname} is Vercel AI Gateway, which may fall back to Vercel's own keys; call the provider directly or through a Cloudflare AI Gateway set to byok_only`,
    };
  }
  return { ok: true, url: { origin: url.origin, path: url.pathname.replace(/\/+$/, ""), hostname } };
}

/** True when `url` lies on `base`'s origin and at or under its path. */
export function isUnderBase(url: URL, base: ModelBaseUrl): boolean {
  if (url.origin !== base.origin) return false;
  return base.path === "" || url.pathname === base.path || url.pathname.startsWith(`${base.path}/`);
}
