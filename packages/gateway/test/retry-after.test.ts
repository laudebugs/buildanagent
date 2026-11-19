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
  ["an obsolete RFC 850 date", { "retry-after": "Thursday, 19-Nov-26 12:00:10 GMT", date: SENT }, 10_000],
  ["an asctime date, which means GMT", { "retry-after": "Thu Nov 19 12:00:05 2026", date: SENT }, 5000],
  ["a value with spaces around it", { "retry-after": "  3 " }, 3000],
  ["a value so large it exceeds any wait", { "retry-after": "99999999999" }, 99_999_999_999_000],
] as const)("a retry-after hint in %s is read", (_form, headers, expected) => {
  assert.equal(retryAfterMs(new Headers(headers)), expected);
});

test.each([
  ["no header", {}],
  ["a negative number", { "retry-after": "-5", date: SENT }],
  ["a signed number", { "retry-after": "+5", date: SENT }],
  ["a number in exponent form", { "retry-after": "1e3", date: SENT }],
  ["text that is neither a number nor a date", { "retry-after": "later", date: SENT }],
  ["text Date.parse reads as a date", { "retry-after": "Thursday 2027", date: SENT }],
  ["an HTTP date without a date header", { "retry-after": "Thu, 19 Nov 2026 12:00:30 GMT" }],
  [
    "an HTTP date with a date header that is not a date",
    { "retry-after": "Thu, 19 Nov 2026 12:00:30 GMT", date: "now" },
  ],
] as const)("a response with %s gives no hint", (_form, headers) => {
  assert.equal(retryAfterMs(new Headers(headers)), undefined);
});

test("a repeated retry-after header, which Headers joins with a comma, gives no hint", () => {
  const headers = new Headers([
    ["retry-after", "5"],
    ["retry-after", "10"],
    ["date", SENT],
  ]);
  assert.equal(retryAfterMs(headers), undefined);
});

test("header names match whatever their case", () => {
  assert.equal(retryAfterMs(new Headers({ "Retry-After-Ms": "40", "RETRY-AFTER": "9" })), 40);
});
