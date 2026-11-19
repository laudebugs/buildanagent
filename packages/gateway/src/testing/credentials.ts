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
// bare `apiKey` an options object might hold matches too.
const squash = (name: string): string => name.toLowerCase().replace(/[-_]/g, "");
const CREDENTIAL_KEYS = new Set([...CREDENTIAL_HEADERS.map(squash), "apikey"]);

/**
 * True when `name` names a credential: one of `CREDENTIAL_HEADERS` or `apiKey`, compared without case, hyphens or
 * underscores.
 */
export function isCredentialName(name: string): boolean {
  return CREDENTIAL_KEYS.has(squash(name));
}

/** A copy of `headers` with lower-case names, where every credential header's value is `"[redacted]"`. */
export function redactHeaders(headers: Headers | Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  for (const [name, value] of entries) out[name.toLowerCase()] = isCredentialName(name) ? REDACTED : value;
  return out;
}

/**
 * A deep copy of `value` with every property whose name is a credential (see `isCredentialName()`) left out, at any
 * depth. Arrays and plain objects are copied; other values are kept as they are.
 */
export function stripCredentials<T>(value: T): T {
  return strip(value) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (typeof value !== "object" || value === null) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isCredentialName(key)) out[key] = strip(item);
  }
  return out;
}
