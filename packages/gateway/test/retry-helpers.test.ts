/**
 * The retry rules a caller above the model reuses, as the SDK's loop does for turn retries: the backoff, the hint
 * and the default sleep.
 */
import assert from "node:assert/strict";
import {
  type AssistantMessage,
  abortableSleep,
  DEFAULT_INITIAL_RETRY_DELAY_MS,
  emptyUsage,
  MAX_RETRY_DELAY_MS,
  retryDelay,
  retryHintMs,
} from "@buildanagent/gateway";
import { test } from "vitest";

function failed(retryAfterMs?: number): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model: { api: "scripted", provider: "scripted", id: "m" },
    stopReason: "error",
    error: { kind: "retryable", message: "overloaded", ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    usage: emptyUsage(),
    cost: { total: null, basis: "unknown", currency: "USD" },
  };
}

test("the backoff doubles from the initial delay, and the cap is 60 seconds", () => {
  assert.equal(DEFAULT_INITIAL_RETRY_DELAY_MS, 2000);
  assert.equal(MAX_RETRY_DELAY_MS, 60_000);
  assert.deepEqual(
    [1, 2, 3].map((n) => retryDelay(2000, n, 0)),
    [2000, 4000, 8000],
  );
  assert.equal(retryDelay(2000, 20, 0), MAX_RETRY_DELAY_MS);
});

test("a hint longer than the backoff sets the wait, and a shorter one does not", () => {
  assert.equal(retryDelay(2000, 1, 9000), 9000);
  assert.equal(retryDelay(2000, 2, 1000), 4000);
  assert.equal(retryDelay(2000, 1, MAX_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
});

test("retryHintMs reads error.retryAfterMs, and a missing or NaN hint is 0", () => {
  assert.equal(retryHintMs(failed(7000)), 7000);
  assert.equal(retryHintMs(failed()), 0);
  assert.equal(retryHintMs(failed(Number.NaN)), 0);
});

test("abortableSleep resolves, without rejecting, once the signal aborts", async () => {
  const controller = new AbortController();
  const waiting = abortableSleep(60_000, controller.signal);
  controller.abort();
  await waiting;
  await abortableSleep(60_000, controller.signal);
});

test("a zero initial delay stays 0 however many retries come, never NaN", () => {
  assert.equal(retryDelay(0, 1025, 0), 0);
  assert.equal(retryDelay(0, 5000, 300), 300);
  assert.equal(retryDelay(1, 5000, 0), MAX_RETRY_DELAY_MS);
});
