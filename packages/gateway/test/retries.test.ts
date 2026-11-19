import assert from "node:assert/strict";
import {
  type AssistantMessage,
  classifyError,
  createModel,
  type ErrorKind,
  emptyUsage,
  type GatewayEvent,
  type ModelAdapter,
  type ModelEvent,
  type ModelRef,
  type Usage,
} from "@buildanagent/gateway";
import { assertStreamContract } from "@buildanagent/gateway/testing";
import { afterEach, test, vi } from "vitest";
import { collect, context, FailingAdapter, recordingSleep, TEST_CAPS } from "./adapters.js";

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
    [
      { status: 429, code: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota)." },
      "retryable",
    ],
    [{ status: 429, message: "Request too large for gpt-x on tokens per min" }, "retryable"],
    [{ status: 429, code: "insufficient_quota", message: "You exceeded your current quota" }, "quota"],
    [{ status: 501 }, "fatal"],
    [{ status: 505 }, "fatal"],
    [{ status: 401 }, "fatal"],
    [{ status: 404 }, "fatal"],
  ];
  for (const [failure, kind] of cases) assert.equal(classifyError(failure), kind, JSON.stringify(failure));
});

/** An adapter whose attempts are given as async generators, for failures the FailingAdapter double can't express. */
function scriptedAdapter(
  attempts: ((model: ModelRef) => AsyncGenerator<ModelEvent>)[],
): ModelAdapter & { calls: number } {
  return {
    specificationVersion: "v1",
    api: "test-api",
    provider: "test",
    defaultCaps: TEST_CAPS,
    calls: 0,
    stream(model) {
      const attempt = attempts[this.calls];
      this.calls += 1;
      if (attempt === undefined) throw new Error("no attempt scripted");
      return attempt(model);
    },
  };
}

const usage = (uncachedInput: number, output: number): Usage => ({ ...emptyUsage(), uncachedInput, output });

function errorMessage(model: ModelRef, kind: ErrorKind, u: Usage): AssistantMessage {
  const cost = { total: null, basis: "unknown", currency: "USD" } as const;
  return { role: "assistant", content: [], model, stopReason: "error", error: { kind, message: kind }, usage: u, cost };
}

test("a stream that throws before output is retried, and one that keeps throwing ends with an error terminal", async () => {
  const adapter = scriptedAdapter([
    // biome-ignore lint/correctness/useYield: the attempt fails before it yields anything
    async function* () {
      throw new TypeError("fetch failed");
    },
    async function* () {
      yield { type: "start" };
      throw new TypeError("fetch failed");
    },
  ]);
  const model = createModel({ adapter, id: "m", retries: 1, sleep: recordingSleep().sleep });

  const events = await assertStreamContract(model.stream(context));

  assert.equal(adapter.calls, 2);
  assert.equal(retriesOf(events).length, 1);
  const last = events.at(-1);
  assert.equal(last?.type, "error");
  assert.deepEqual(last?.type === "error" && last.message.error, {
    kind: "retryable",
    message: "TypeError: fetch failed",
  });
});

test("the final message counts the usage of the failed attempts as well as the last one", async () => {
  const adapter = scriptedAdapter([
    async function* (model) {
      yield { type: "start" };
      yield { type: "error", message: errorMessage(model, "retryable", usage(150, 0)) };
    },
    async function* (model) {
      yield { type: "start" };
      const message: AssistantMessage = {
        ...errorMessage(model, "retryable", usage(150, 7)),
        stopReason: "stop",
      };
      delete message.error;
      yield { type: "done", message };
    },
  ]);
  const model = createModel({ adapter, id: "m", sleep: recordingSleep().sleep });

  const result = await model.complete(context);

  assert.equal(result.usage.uncachedInput, 300);
  assert.equal(result.usage.output, 7);
});

test("a stream that throws something other than a failed fetch ends at once with a fatal error", async () => {
  const adapter = scriptedAdapter([
    // biome-ignore lint/correctness/useYield: the attempt fails before it yields anything
    async function* () {
      throw new RangeError("bad content block");
    },
  ]);
  const model = createModel({ adapter, id: "m", sleep: recordingSleep().sleep });

  const events = await assertStreamContract(model.stream(context));

  assert.equal(adapter.calls, 1);
  const last = events.at(-1);
  assert.deepEqual(last?.type === "error" && last.message.error, {
    kind: "fatal",
    message: "RangeError: bad content block",
  });
});

test("the final message adds the failed attempts' cost, and an unknown cost makes the total unknown", async () => {
  const priced = (model: ModelRef, total: number | null, done: boolean): AssistantMessage => {
    const message: AssistantMessage = {
      ...errorMessage(model, "retryable", usage(1, 0)),
      cost: { total, basis: "provider", currency: "USD" },
    };
    if (!done) return message;
    delete message.error;
    return { ...message, stopReason: "stop" };
  };
  const run = async (second: number | null) => {
    const adapter = scriptedAdapter([
      async function* (model) {
        yield { type: "start" };
        yield { type: "error", message: priced(model, 0.01, false) };
      },
      async function* (model) {
        yield { type: "start" };
        yield { type: "done", message: priced(model, second, true) };
      },
    ]);
    return createModel({ adapter, id: "m", sleep: recordingSleep().sleep }).complete(context);
  };

  assert.equal((await run(0.02)).cost.total?.toFixed(2), "0.03");
  assert.equal((await run(null)).cost.total, null);
});

test("each retry wait is capped at 60 seconds", async () => {
  const attempts = Array.from({ length: 8 }, () => ({ fail: "retryable" as const }));
  const adapter = new FailingAdapter([...attempts, { reply: "ok" }]);
  const { sleep, delays } = recordingSleep();
  await createModel({ adapter, id: "m", retries: 8, sleep }).complete(context);
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
});

test("a retry waits for the provider's retry-after hint when it is longer than the backoff", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable", retryAfterMs: 7000 }, { reply: "ok" }]);
  const { sleep, delays } = recordingSleep();
  const events = await collect(createModel({ adapter, id: "m", sleep }).stream(context));
  assert.deepEqual(delays, [7000]);
  assert.equal(retriesOf(events)[0]?.delayMs, 7000);
});

test("a retry-after hint shorter than the backoff keeps the backoff", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable", retryAfterMs: 500 }, { reply: "ok" }]);
  const { sleep, delays } = recordingSleep();
  await createModel({ adapter, id: "m", sleep }).complete(context);
  assert.deepEqual(delays, [2000]);
});

test("a retry-after hint of exactly 60 seconds still retries after 60 seconds", async () => {
  const adapter = new FailingAdapter([{ fail: "retryable", retryAfterMs: 60_000 }, { reply: "ok" }]);
  const { sleep, delays } = recordingSleep();
  const message = await createModel({ adapter, id: "m", sleep }).complete(context);
  assert.deepEqual(delays, [60_000]);
  assert.equal(message.stopReason, "stop");
});

test.each([120_000, Number.POSITIVE_INFINITY])(
  "a retry-after hint of %d ms, over the 60-second cap, ends the call without a retry",
  async (hintMs) => {
    const adapter = new FailingAdapter([{ fail: "retryable", retryAfterMs: hintMs }, { reply: "never sent" }]);
    const { sleep, delays } = recordingSleep();
    const events = await assertStreamContract(createModel({ adapter, id: "m", sleep }).stream(context));
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(delays, []);
    assert.deepEqual(retriesOf(events), []);
    const last = events.at(-1);
    assert.equal(last?.type, "error");
    const message = last?.type === "error" ? last.message : undefined;
    assert.equal(message?.stopReason, "error");
    assert.equal(message?.error?.kind, "retryable");
    assert.equal(message?.error?.retryAfterMs, hintMs);
  },
);

test("a hint over the cap after an earlier retry keeps every attempt's usage and cost", async () => {
  const usage = { ...emptyUsage(), uncachedInput: 10 };
  const cost = { total: 0.01, basis: "provider", currency: "USD" } as const;
  const adapter = new FailingAdapter([
    { fail: "retryable", usage, cost },
    { fail: "retryable", retryAfterMs: 90_000, usage, cost },
    { reply: "never sent" },
  ]);
  const { sleep, delays } = recordingSleep();
  const message = await createModel({ adapter, id: "m", sleep }).complete(context);
  assert.equal(adapter.calls.length, 2);
  assert.deepEqual(delays, [2000]);
  assert.equal(message.error?.retryAfterMs, 90_000);
  assert.equal(message.usage.uncachedInput, 20);
  assert.equal(message.lastAttemptUsage?.uncachedInput, 10);
  assert.equal(message.cost.total, 0.02);
});

test("an abort before a hint over the cap ends the call as aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const adapter = new FailingAdapter([{ fail: "retryable", retryAfterMs: 120_000 }]);
  const message = await createModel({ adapter, id: "m", sleep: recordingSleep().sleep }).complete(context, {
    signal: controller.signal,
  });
  assert.equal(message.stopReason, "aborted");
});

test.each(["quota", "overflow", "fatal"] as const)(
  "a %s error with a retry-after hint is not retried",
  async (kind) => {
    const adapter = new FailingAdapter([{ fail: kind, retryAfterMs: 1000 }]);
    const { sleep, delays } = recordingSleep();
    const message = await createModel({ adapter, id: "m", sleep }).complete(context);
    assert.equal(adapter.calls.length, 1);
    assert.deepEqual(delays, []);
    assert.equal(message.error?.retryAfterMs, 1000);
  },
);

test("aborting during a retry-after wait ends the stream with stopReason aborted", async () => {
  const controller = new AbortController();
  const adapter = new FailingAdapter([{ fail: "retryable", retryAfterMs: 30_000 }, { reply: "never sent" }]);
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
    controller.abort();
  };
  const message = await createModel({ adapter, id: "m", sleep }).complete(context, { signal: controller.signal });
  assert.deepEqual(delays, [30_000]);
  assert.equal(message.stopReason, "aborted");
  assert.equal(adapter.calls.length, 1);
});
