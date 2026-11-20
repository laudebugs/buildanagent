/**
 * Credential stripping for anything a test writes down: the mock server's request log and the SDK's recorded pairs.
 * A recording that kept a real key would leak it the moment the fixture is committed, so every recorder runs its
 * data through these helpers before storing it.
 */

/**
 * The HTTP header names that carry credentials, in lower case: bearer tokens, the providers' API-key headers, a
 * proxy's or Cloudflare AI Gateway's authorization, and cookies.
 */
export const CREDENTIAL_HEADERS = Object.freeze([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-goog-api-key",
  "cf-aig-authorization",
  "cookie",
  "set-cookie",
] as const);

/** What a redacted header's value becomes, so a test can still see that the header was sent. */
export const REDACTED = "[redacted]";

// Compared without case, hyphens or underscores, so `X-Api-Key`, `x_api_key` and `xApiKey` all match, and the
// bare `apiKey` an options object might hold matches too. A name that ends like a credential, such as
// `x-amz-security-token`, `client_secret` or `openai-api-key`, matches as well.
const squash = (name: string): string => name.toLowerCase().replace(/[-_]/g, "");
const CREDENTIAL_KEYS = new Set([...CREDENTIAL_HEADERS.map(squash), "apikey"]);
const CREDENTIAL_ENDINGS = ["apikey", "authorization", "token", "secret", "password"] as const;
// Query parameters that carry a key, such as Google's `?key=`, besides every credential name.
const CREDENTIAL_PARAMETERS = new Set(["key", "accesstoken", "sig", "signature"]);
const AUTH_SCHEME = /^(?:bearer|basic)\s+\S/i;
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * True when `name` names a credential: one of `CREDENTIAL_HEADERS` or `apiKey`, or a name that ends in `apiKey`,
 * `authorization`, `token`, `secret` or `password`, compared without case, hyphens or underscores.
 */
export function isCredentialName(name: string): boolean {
  const squashed = squash(name);
  return CREDENTIAL_KEYS.has(squashed) || CREDENTIAL_ENDINGS.some((ending) => squashed.endsWith(ending));
}

/** A copy of `headers` with lower-case names, where every credential header's value is `"[redacted]"`. */
export function redactHeaders(
  headers: Headers | Readonly<Record<string, string>> | readonly (readonly [string, string])[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const entries =
    headers instanceof Headers ? [...headers.entries()] : Array.isArray(headers) ? headers : Object.entries(headers);
  for (const [name, value] of entries) out[name.toLowerCase()] = isCredentialName(name) ? REDACTED : value;
  return out;
}

/**
 * `url` with its user name and password, and the value of every query parameter that carries a key (`key`,
 * `access_token`, `sig`, `signature` or a credential name such as `api_key`), replaced by `"[redacted]"`. Text that
 * isn't an absolute URL comes back unchanged.
 */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  let changed = false;
  if (parsed.username !== "" || parsed.password !== "") {
    parsed.username = parsed.username === "" ? "" : REDACTED;
    parsed.password = parsed.password === "" ? "" : REDACTED;
    changed = true;
  }
  for (const name of new Set(parsed.searchParams.keys())) {
    if (isCredentialName(name) || CREDENTIAL_PARAMETERS.has(squash(name))) {
      parsed.searchParams.set(name, REDACTED);
      changed = true;
    }
  }
  // An untouched URL keeps its exact spelling, so a URL without credentials is never rewritten by normalisation.
  return changed ? parsed.href : url;
}

/**
 * A deep copy of `value` with every credential left out, at any depth: each property whose name is a credential
 * (see `isCredentialName()`), each `[name, value]` pair in an array whose name is one, and each such entry of a
 * `Headers` object, which becomes a plain object. A string that starts with a `Bearer` or `Basic` scheme becomes
 * `"[redacted]"`, and a URL string loses its credentials as `redactUrl()` describes. Arrays and plain objects are
 * copied; other values are kept as they are.
 */
export function stripCredentials<T>(value: T): T {
  return strip(value) as T;
}

function isCredentialPair(item: unknown): boolean {
  return Array.isArray(item) && item.length === 2 && typeof item[0] === "string" && isCredentialName(item[0]);
}

function stripString(value: string): string {
  if (AUTH_SCHEME.test(value)) return REDACTED;
  return ABSOLUTE_URL.test(value) ? redactUrl(value) : value;
}

function strip(value: unknown): unknown {
  if (typeof value === "string") return stripString(value);
  if (Array.isArray(value)) return value.filter((item) => !isCredentialPair(item)).map(strip);
  if (typeof value !== "object" || value === null) return value;
  if (value instanceof Headers) return strip(Object.fromEntries(value.entries()));
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isCredentialName(key)) out[key] = strip(item);
  }
  return out;
}
