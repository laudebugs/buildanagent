// What a live run must never write or print: the API keys themselves, and what a provider's response carries about
// the account and the request, such as an organization id, a request id or an authorization header. The runner and
// each harness's live mode pass their output through redact() and refuse to write a live transcript that findSecret()
// flags. The file holds only syntax that Node.js can strip, so .mjs scripts import it without a build.

/**
 * Shapes of credentials and account or request identifiers, by name. Each names a shape, not a value, so a report can
 * say which one matched without repeating it.
 */
export const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ["an Anthropic API key", /sk-ant-[A-Za-z0-9_-]{8,}/],
  ["an OpenAI API key", /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/],
  ["an Anthropic request id", /\breq_[A-Za-z0-9]{12,}/],
  ["a request-id header", /\b(?:x-)?request-id\b/i],
  ["an organization header", /\b(?:anthropic|openai)-organization(?:-id)?\b/i],
  ["an OpenAI project header", /\bopenai-project\b/i],
  ["an OpenAI organization id", /\borg-[A-Za-z0-9]{16,}/],
  ["an authorization header", /\b(?:authorization|x-api-key|proxy-authorization)\b\s*["']?\s*[:=]/i],
  ["a bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/],
  ["a cookie", /\b(?:set-)?cookie\b\s*["']?\s*[:=]/i],
];

/** The name of the first secret `text` holds, or undefined. A value never appears in the result. */
export function findSecret(text: string, values: readonly string[] = []): string | undefined {
  if (values.some((value) => text.includes(value))) return "an API key the run was given";
  return SECRET_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
}

/**
 * `text` with every given value replaced by `<redacted>` and every line that matches a secret pattern replaced by a
 * line that names only the pattern, so a log keeps its shape and loses the secret.
 */
export function redact(text: string, values: readonly string[] = []): string {
  let out = text;
  for (const value of values) out = out.split(value).join("<redacted>");
  return out
    .split("\n")
    .map((line) => {
      const found = SECRET_PATTERNS.find(([, pattern]) => pattern.test(line));
      return found ? `<line withheld: it held ${found[0]}>` : line;
    })
    .join("\n");
}
