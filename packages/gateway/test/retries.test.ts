import assert from "node:assert/strict";
import { classifyError, createModel, type ErrorKind, type GatewayEvent } from "@buildanagent/gateway";
import { assertStreamContract } from "@buildanagent/gateway/testing";
import { afterEach, test, vi } from "vitest";
import { collect, context, FailingAdapter, recordingSleep } from "./adapters.ts";

afterEach(() => {
  vi.useRealTimers();
});

const retriesOf = (events: GatewayEvent[]) => events.filter((e) => e.type === "retry");

test("a retryable failure before output is retried twice with two retry events, then succeeds", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable" }, { fail: "retryable" }, { reply: "ok" }]);
  const { sleep, delays } = recordingSleep();
  const model = createModel({ adapter, id: "m", sleep });

  const events = await assertStreamContract(model.stream(context));

  assert.equal(adapter.calls.length, 3);
  assert.deepEqual(retriesOf(events), [
    { type: "retry", attempt: 1, delayMs: 2000, error: "retryable failure" },
    { type: "retry", attempt: 2, delayMs: 4000, error: "retryable failure" },
  ]);
  assert.deepEqual(delays, [2000, 4000]);
  assert.equal(events.filter((e) => e.type === "start").length, 1);
  const last = events.at(-1);
  assert.equal(last?.type, "done");
});

test("a retryable failure that outlasts the retries returns the error terminal", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable" }, { fail: "retryable" }, { fail: "retryable" }]);
  const model = createModel({ adapter, id: "m", sleep: recordingSleep().sleep });

  const events = await assertStreamContract(model.stream(context));
  const last = events.at(-1);
  const message = last?.type === "error" ? last.message : undefined;

  assert.equal(adapter.calls.length, 3);
  assert.equal(retriesOf(events).length, 2);
  assert.equal(message?.stopReason, "error");
  assert.equal(message?.error?.kind, "retryable");
});

test("a failure after the first delta is not retried", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable", afterOutput: true }, { reply: "never" }]);
  const model = createModel({ adapter, id: "m", sleep: recordingSleep().sleep });

  const events = await assertStreamContract(model.stream(context));

  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(retriesOf(events), []);
  const last = events.at(-1);
  assert.equal(last?.type, "error");
  assert.deepEqual(last?.type === "error" ? last.message.content : [], [{ type: "text", text: "partial" }]);
});

test.each<ErrorKind>(["quota", "overflow", "fatal"])("a %s error is not retried", async (kind) => {
  const adapter = new FailingAdapter([{ fail: kind }, { reply: "never" }]);
  const model = createModel({ adapter, id: "m", sleep: recordingSleep().sleep });

  const message = await model.complete(context);

  assert.equal(adapter.calls.length, 1);
  assert.equal(message.stopReason, "error");
  assert.equal(message.error?.kind, kind);
});

test("retries: 0 turns HTTP retries off", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable" }, { reply: "never" }]);
  const message = await createModel({ adapter, id: "m", retries: 0 }).complete(context);
  assert.equal(adapter.calls.length, 1);
  assert.equal(message.stopReason, "error");
});

test("the default backoff waits 2 s before the first retry and 4 s before the second", async () => {
  vi.useFakeTimers();
  const adapter = new FailingAdapter([{ fail: "retryable" }, { fail: "retryable" }, { reply: "ok" }]);
  const result = collect(createModel({ adapter, id: "m" }).stream(context));

  await vi.advanceTimersByTimeAsync(1999);
  assert.equal(adapter.calls.length, 1);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(adapter.calls.length, 2);
  await vi.advanceTimersByTimeAsync(3999);
  assert.equal(adapter.calls.length, 2);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(adapter.calls.length, 3);
  assert.equal((await result).at(-1)?.type, "done");
});

test("aborting during backoff ends the stream with stopReason aborted within 50 ms", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const adapter = new FailingAdapter([{ fail: "retryable" }, { reply: "never" }]);
  const iterator = createModel({ adapter, id: "m" }).stream(context, { signal: controller.signal });
  const events = iterator[Symbol.asyncIterator]();

  assert.equal((await events.next()).value?.type, "start");
  assert.equal((await events.next()).value?.type, "retry");
  const terminal = events.next();
  let settled = false;
  void terminal.then(() => {
    settled = true;
  });

  // Halfway through the 2 s backoff, abort, then allow the clock only 50 ms.
  await vi.advanceTimersByTimeAsync(1000);
  const abortedAt = Date.now();
  controller.abort();
  await vi.advanceTimersByTimeAsync(50);

  assert.equal(settled, true);
  assert.ok(Date.now() - abortedAt <= 50);
  const event = (await terminal).value;
  assert.equal(event?.type, "error");
  assert.equal(event?.type === "error" ? event.message.stopReason : undefined, "aborted");
  assert.equal(event?.type === "error" ? event.message.error : "unset", undefined);
  assert.equal((await events.next()).done, true);
  assert.equal(adapter.calls.length, 1);
});

test("the signal reaches the adapter on every attempt", async () => {
  const controller = new AbortController();
  const adapter = new FailingAdapter([{ fail: "retryable" }, { reply: "ok" }]);
  await createModel({ adapter, id: "m", sleep: recordingSleep().sleep }).complete(context, {
    signal: controller.signal,
  });
  assert.deepEqual(
    adapter.calls.map((o) => o.signal),
    [controller.signal, controller.signal],
  );
});

test("classifyError sorts HTTP failures into the four kinds", () => {
  const cases: [Parameters<typeof classifyError>[0], ErrorKind][] = [
    [{ status: 429, message: "rate limited" }, "retryable"],
    [{ status: 429, code: "insufficient_quota" }, "quota"],
    [{ status: 402 }, "quota"],
    [{ status: 400, message: "Your credit balance is too low" }, "quota"],
    [{ status: 529, code: "overloaded_error" }, "retryable"],
    [{ status: 503 }, "retryable"],
    [{ status: 408 }, "retryable"],
    [{}, "retryable"],
    [{ status: 413 }, "overflow"],
    [{ status: 400, message: "prompt is too long: 210000 tokens > 200000 maximum" }, "overflow"],
    [{ status: 400, code: "context_length_exceeded" }, "overflow"],
    [{ status: 400, message: "invalid request" }, "fatal"],
    [{ status: 401 }, "fatal"],
    [{ status: 404 }, "fatal"],
  ];
  for (const [failure, kind] of cases) assert.equal(classifyError(failure), kind, JSON.stringify(failure));
});
