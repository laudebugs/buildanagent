/**
 * Reading a failed response's retry-after hint. `retry-after` holds seconds, as Anthropic's and OpenAI's rate-limit
 * pages say, or an HTTP date (RFC 9110, section 10.2.3); `retry-after-ms`, which the official TypeScript SDKs read
 * first, holds milliseconds.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { retryAfterMs } from "../src/adapters/wire.js";

const SENT = "Thu, 19 Nov 2026 12:00:00 GMT";

test.each([
  ["whole seconds", { "retry-after": "7" }, 7000],
  ["decimal seconds", { "retry-after": "1.5" }, 1500],
  ["zero seconds", { "retry-after": "0" }, 0],
  ["milliseconds", { "retry-after-ms": "250" }, 250],
  ["milliseconds before seconds", { "retry-after-ms": "250", "retry-after": "7" }, 250],
  ["seconds after invalid milliseconds", { "retry-after-ms": "soon", "retry-after": "7" }, 7000],
  ["an HTTP date, from the response's date", { "retry-after": "Thu, 19 Nov 2026 12:00:30 GMT", date: SENT }, 30_000],
  ["an HTTP date already past, as zero", { "retry-after": "Thu, 19 Nov 2026 11:59:00 GMT", date: SENT }, 0],
] as const)("a retry-after hint in %s is read", (_form, headers, expected) => {
  assert.equal(retryAfterMs(new Headers(headers)), expected);
});

test.each([
  ["no header", {}],
  ["a negative number", { "retry-after": "-5" }],
  ["text that is neither a number nor a date", { "retry-after": "later" }],
  ["an HTTP date without a date header", { "retry-after": "Thu, 19 Nov 2026 12:00:30 GMT" }],
] as const)("a response with %s gives no hint", (_form, headers) => {
  assert.equal(retryAfterMs(new Headers(headers)), undefined);
});
