/**
 * The checks on a remote server's config, made when the manager is created, so a bad URL or header fails before any
 * request: the URL's scheme and form, the headers the host supplies, the address ranges it allows and the bounds. The
 * address policy built here decides, for every address a name resolves to and every address a request reaches, whether
 * the request may go on.
 */
import { inAddressRange, isAddressRange, isLoopbackAddress, isPublicAddress } from "../credentials/addresses.js";
import { HarnessError } from "../errors.js";
import type { McpHttpTransport, McpSseTransport } from "./types.js";

const DEFAULTS = {
  maxMessageBytes: 8 * 1024 * 1024,
  maxStreamBytes: 64 * 1024 * 1024,
  headersTimeoutMs: 30_000,
  streamIdleMs: 120_000,
  maxStreamMs: 3_600_000,
  maxStreams: 8,
} as const;
// The longest delay a timer takes: a larger one fires at once.
const MAX_TIMER_MS = 2 ** 31 - 1;
const MAX_URL_CHARS = 2048;
const MAX_HEADER_VALUE_CHARS = 8192;
const MAX_HEADERS = 32;
// RFC 9110's token: the characters a header name may hold.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,64}$/;
// Headers the transport, the HTTP stack or MCP itself sets, which a config may not replace.
const RESERVED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-connection",
  "accept",
  "accept-encoding",
  "last-event-id",
  "mcp-session-id",
  "mcp-protocol-version",
  "mcp-method",
  "mcp-name",
]);
// A query parameter whose name says it holds a credential. A token belongs in a header, because a URL ends up in logs,
// proxies and error messages.
const CREDENTIAL_PART =
  /^(token|key|secret|password|passwd|pass|pwd|auth|authorization|code|sig|signature|credential|credentials|session|sessionid|apikey|jwt|bearer)$/i;
const CREDENTIAL_ENDING = /(key|token|secret|password)$/i;

/** A remote transport's settings with their defaults, checked, and the policy for the addresses it may reach. */
export interface RemoteSettings {
  readonly kind: "http" | "sse";
  readonly url: URL;
  readonly headers: Readonly<Record<string, string>>;
  readonly allows: (address: string) => boolean;
  readonly maxMessageBytes: number;
  readonly maxStreamBytes: number;
  readonly headersTimeoutMs: number;
  readonly streamIdleMs: number;
  readonly maxStreamMs: number;
  readonly maxStreams: number;
  /** The text a log line or an error must never show: the URL and every header value. */
  readonly secrets: readonly string[];
}

const invalid = (why: string): never => {
  throw new HarnessError("invalid_mcp_config", `a remote MCP server ${why}`);
};

function bound(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!(Number.isInteger(value) && value >= 1 && value <= MAX_TIMER_MS)) {
    invalid(`needs ${name} to be a whole number from 1 to ${MAX_TIMER_MS}`);
  }
  return value as number;
}

// The control characters of ASCII, which no URL or header value may hold: a line break would split a header.
const hasControl = (text: string): boolean =>
  [...text].some((char) => (char.codePointAt(0) ?? 0) <= 0x1f || char === "\u007f");

function credentialName(name: string): boolean {
  return name.split(/[-_.]/).some((part) => CREDENTIAL_PART.test(part) || CREDENTIAL_ENDING.test(part));
}

/** Parses and checks the URL. A secret is never quoted back, so a refusal names the rule and not the text. */
function checkUrl(text: unknown, loopback: boolean): URL {
  if (typeof text !== "string" || text === "" || text.length > MAX_URL_CHARS) {
    invalid(`needs a url of 1 to ${MAX_URL_CHARS} characters`);
  }
  // `URL` removes tabs and line breaks before it parses, so they are refused here, where they can still be seen.
  if (hasControl(text as string)) invalid("has a url with a control character, which no URL may hold");
  let url: URL;
  try {
    url = new URL(text as string);
  } catch {
    return invalid("has a url that is not an absolute URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    invalid("needs an https: url; plain http: is accepted only with unsafeAllowLoopback, for a test server");
  }
  if (url.username !== "" || url.password !== "") {
    invalid("has a user name or password in its url; send a credential in headers instead");
  }
  if (url.hash !== "") invalid("has a fragment in its url, which no request sends");
  for (const name of url.searchParams.keys()) {
    if (credentialName(name)) invalid("has a query parameter whose name looks like a credential; send it in headers");
  }
  return url;
}

function checkHeaders(headers: unknown): Record<string, string> {
  if (headers === undefined) return {};
  if (typeof headers !== "object" || headers === null || Array.isArray(headers))
    invalid("needs headers to be an object");
  const entries = Object.entries(headers as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) invalid(`has more than ${MAX_HEADERS} headers`);
  const checked: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) invalid(`has a header name that is not an HTTP token: ${JSON.stringify(name)}`);
    const lower = name.toLowerCase();
    if (RESERVED_HEADERS.has(lower)) invalid(`sets the header ${name}, which the transport sets itself`);
    if (seen.has(lower)) invalid(`sets the header ${name} twice, in some letter case`);
    seen.add(lower);
    // The value is a secret, so the refusal names the header and never its value.
    if (typeof value !== "string" || value.length > MAX_HEADER_VALUE_CHARS || hasControl(value)) {
      invalid(
        `has a value for ${name} that is not a string of at most ${MAX_HEADER_VALUE_CHARS} characters without control characters`,
      );
    }
    checked[lower] = value as string;
  }
  return checked;
}

/**
 * Refuses a range that allows far more than it seems to: `/0`, and an IPv6 range wider than `/96` that holds the
 * IPv4-mapped addresses, such as `::ffff:10.0.0.0/8`, which is `::/8` and so admits every IPv4 address in mapped form.
 */
function checkBreadth(range: string): void {
  const [address = "", prefix] = range.split("/");
  if (prefix === undefined) return;
  if (Number(prefix) === 0)
    invalid(`has the allowAddresses entry ${JSON.stringify(range)}, which allows every address`);
  const mapped = inAddressRange("::ffff:0.0.0.0", range) || inAddressRange("::ffff:255.255.255.255", range);
  if (address.includes(":") && Number(prefix) < 96 && mapped) {
    invalid(
      `has the allowAddresses entry ${JSON.stringify(range)}, an IPv6 range wider than /96 that admits every IPv4 address in mapped form; write the IPv4 range itself`,
    );
  }
}

function checkRanges(ranges: unknown): readonly string[] {
  if (ranges === undefined) return [];
  if (!Array.isArray(ranges)) invalid("needs allowAddresses to be a list of address ranges");
  for (const range of ranges as unknown[]) {
    if (typeof range !== "string" || !isAddressRange(range)) {
      invalid(`has an allowAddresses entry that is not an address or CIDR range: ${JSON.stringify(range)}`);
    }
    checkBreadth(range as string);
  }
  return ranges as string[];
}

/**
 * The policy for the addresses a request may reach: a public address, an address in `allowAddresses` that is not
 * loopback, or, with `unsafeAllowLoopback`, a loopback address. A plain-`http:` URL reaches loopback addresses only.
 */
function policyOf(ranges: readonly string[], loopback: boolean, plain: boolean): (address: string) => boolean {
  return (address) => {
    if (isLoopbackAddress(address)) return loopback;
    if (plain) return false;
    return isPublicAddress(address) || ranges.some((range) => inAddressRange(address, range));
  };
}

/** Checks a remote transport's config. Throws a `HarnessError`, code `invalid_mcp_config`. */
export function checkRemoteTransport(transport: McpHttpTransport | McpSseTransport): RemoteSettings {
  if (transport.unsafeAllowLoopback !== undefined && typeof transport.unsafeAllowLoopback !== "boolean") {
    invalid("needs unsafeAllowLoopback to be true or false");
  }
  const loopback = transport.unsafeAllowLoopback === true;
  const url = checkUrl(transport.url, loopback);
  const headers = checkHeaders(transport.headers);
  const ranges = checkRanges(transport.allowAddresses);
  if (transport.proxy !== undefined && typeof transport.proxy?.fetch !== "function") {
    invalid("needs a proxy with a fetch(), such as the one startEgressProxy() returns");
  }
  if (transport.proxy !== undefined && url.protocol !== "https:") invalid("needs an https: url to go through a proxy");
  if (transport.resolve !== undefined && typeof transport.resolve !== "function")
    invalid("needs resolve to be a function");
  const ca = transport.ca;
  if (
    ca !== undefined &&
    typeof ca !== "string" &&
    !(Array.isArray(ca) && ca.every((one) => typeof one === "string"))
  ) {
    invalid("needs ca to be a certificate or a list of them, as PEM text");
  }
  const secrets = [url.href, url.search, ...Object.values(headers)].filter((text) => text.length >= 4);
  return {
    kind: transport.kind,
    url,
    headers,
    allows: policyOf(ranges, loopback, url.protocol === "http:"),
    maxMessageBytes: bound("maxMessageBytes", transport.maxMessageBytes, DEFAULTS.maxMessageBytes),
    maxStreamBytes: bound("maxStreamBytes", transport.maxStreamBytes, DEFAULTS.maxStreamBytes),
    headersTimeoutMs: bound("headersTimeoutMs", transport.headersTimeoutMs, DEFAULTS.headersTimeoutMs),
    streamIdleMs: bound("streamIdleMs", transport.streamIdleMs, DEFAULTS.streamIdleMs),
    maxStreamMs: bound("maxStreamMs", transport.maxStreamMs, DEFAULTS.maxStreamMs),
    maxStreams: bound("maxStreams", transport.maxStreams, DEFAULTS.maxStreams),
    secrets: [...new Set(secrets)].sort((a, b) => b.length - a.length),
  };
}

/** `text` with every secret of a remote server replaced, for a log line or an error message. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}
