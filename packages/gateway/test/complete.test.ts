import "@agent-speak/gateway/testing/setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { complete, emptyUsage, totalInput, type Usage } from "@agent-speak/gateway";
import { message, streamOf, validEvents } from "./fixtures.ts";

test("complete() returns the done terminal's message", async () => {
  const events = validEvents();
  const result = await complete(streamOf(events));
  assert.equal(result.stopReason, "tool_calls");
  assert.equal(result.content.length, 2);
});

test("complete() returns an error terminal's message with partial content and usage, without throwing", async () => {
  const usage: Usage = { ...emptyUsage({ provider: "raw" }), uncachedInput: 12, output: 3 };
  const terminal = message("error", [{ type: "text", text: "Hal" }], {
    usage,
    error: { kind: "retryable", message: "overloaded", status: 529 },
  });
  const result = await complete(
    streamOf([
      { type: "start" },
      { type: "text_start", index: 0 },
      { type: "text_delta", index: 0, delta: "Hal" },
      { type: "error", message: terminal },
    ]),
  );
  assert.equal(result, terminal);
  assert.equal(result.stopReason, "error");
  assert.deepEqual(result.content, [{ type: "text", text: "Hal" }]);
  assert.equal(result.usage.output, 3);
});

test("complete() throws when the stream has no terminal event", async () => {
  await assert.rejects(() => complete(streamOf([{ type: "start" }])), /ended without a done or error/);
});

test("totalInput() sums uncached input, cache reads and both cache-write lifetimes", () => {
  const usage: Usage = {
    uncachedInput: 10,
    cacheRead: 200,
    cacheWrite: { "5m": 30, "1h": 4 },
    output: 7,
    reasoning: 2,
    raw: null,
  };
  assert.equal(totalInput(usage), 244);
});

test("emptyUsage() starts every count at zero and keeps the raw object", () => {
  const raw = { input_tokens: 0 };
  assert.deepEqual(emptyUsage(raw), {
    uncachedInput: 0,
    cacheRead: 0,
    cacheWrite: { "5m": 0, "1h": 0 },
    output: 0,
    reasoning: 0,
    raw,
  });
});

// Type test (D3): Usage has no field named `input`. If one is added, `pnpm typecheck` fails on this line.
type UsageHasInput = "input" extends keyof Usage ? true : false;
const usageHasInput: UsageHasInput = false;
test("Usage has no field named input", () => assert.equal(usageHasInput, false));
