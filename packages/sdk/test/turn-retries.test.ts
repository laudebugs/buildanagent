// Turn retries: the loop re-issues a model call that ended with a `retryable` error, which the gateway can't retry once
// output has streamed. Every test scripts the failure with ScriptedModel and a fake sleep, so none waits.
import assert from "node:assert/strict";
import { createModel, type Message, type PriceCatalog } from "@buildanagent/gateway";
import { type AgentEvent, defineTool, isSdkError, type Run, type RunOptions, run } from "@buildanagent/sdk";
import { type AssistantScript, ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import { determinism, drive, lookup, scripted, text, toolCall, typesOf } from "./run-helpers.js";

const SYSTEM = "You look up orders.";

/** A catalog that prices the scripted model `priced`, so a run can set `budgetUsd`. */
function pricedCatalog(): PriceCatalog {
  const source = "https://provider.test/pricing";
  return {
    models: [
      {
        provider: "scripted",
        id: "priced",
        rates: [
          { uncachedInput: 3, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 15, upToInputTokens: null },
        ],
        contextWindow: 200_000,
        maxOutputTokens: 4000,
        asOf: "2026-11-01",
        sources: { rates: source, contextWindow: source, maxOutputTokens: source },
      },
    ],
  };
}

type Failure = NonNullable<AssistantScript["error"]>;

/** A response that streams `partial` and then ends with a `retryable` error, as a cut-off stream does. */
function cutOff(partial = "The order", extra: Partial<Failure> = {}): AssistantScript {
  return {
    content: [{ type: "text", text: partial }],
    error: { kind: "retryable", message: "stream cut off", ...extra },
    usage: { uncachedInput: 10, output: 3 },
  };
}

/** A fake sleep that records the waits it was asked for and returns at once. */
function fakeSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
  };
}

/** Starts and drives a run with turn retries on and a fake sleep, over `steps`. */
async function retried(steps: ScriptStep[], options: Partial<RunOptions> = {}) {
  const { adapter, model } = scripted(steps);
  const { waits, sleep } = fakeSleep();
  const driven = await drive(
    run({ model, system: SYSTEM, input: "Go.", turnRetries: 3, sleep, ...determinism(), ...options }),
  );
  return { adapter, waits, ...driven };
}

function retryEvents(events: readonly AgentEvent[]) {
  return events.flatMap((event) => (event.type === "retry" ? [event] : []));
}

test("a call that streams text and then fails retryable is called again, and the failed message leaves the transcript", async () => {
  const { adapter, result } = await retried([
    cutOff(),
    { ...text("Shipped."), usage: { uncachedInput: 20, output: 7 } },
  ]);
  assert.equal(result.stopReason, "done");
  assert.equal(adapter.calls.length, 2);
  assert.deepEqual(
    result.context.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  const answer = result.context.messages.at(-1);
  assert.equal(answer?.role === "assistant" ? answer.stopReason : undefined, "stop");
  assert.equal(result.steps, 2);
});

test("a retried turn's events end the failed call, mark it superseded, and start a new step for the retry", async () => {
  const { events } = await retried([cutOff(), text("Shipped.")]);
  const types = typesOf(events);
  assert.deepEqual(
    types.filter((type) => ["step_start", "step_end", "retry"].includes(type)),
    ["step_start", "retry", "step_end", "step_start", "step_end"],
  );
  const retry = types.indexOf("retry");
  assert.equal(types[retry - 1], "model_call_end");
  assert.deepEqual(types.slice(retry + 1, retry + 4), ["step_end", "step_start", "model_call_start"]);
  // Every step_start has a step_end with the same index.
  const indexesOf = (type: string) => events.flatMap((event) => (event.type === type ? [event.stepIndex] : []));
  assert.deepEqual(indexesOf("step_start"), [0, 1]);
  assert.deepEqual(indexesOf("step_end"), [0, 1]);
  const [first, second] = events.filter((event) => event.type === "model_call_end");
  assert.equal(first?.type === "model_call_end" ? first.message.stopReason : undefined, "error");
  assert.equal(second?.type === "model_call_end" ? second.message.stopReason : undefined, "stop");
  assert.deepEqual(
    retryEvents(events).map(({ layer, attempt, delayMs, error }) => ({ layer, attempt, delayMs, error })),
    [{ layer: "turn", attempt: 1, delayMs: 2000, error: "stream cut off" }],
  );
  // Each model call has its own index, so the retry's events don't share the failed call's.
  const starts = events.flatMap((event) => (event.type === "model_call_start" ? [event.stepIndex] : []));
  assert.deepEqual(starts, [0, 1]);
});

test("every model_call_end without a retry after it is in result.context.messages, and no other assistant message is", async () => {
  const { events, result } = await retried(
    [cutOff(), cutOff("Still"), { ...toolCall("lookup", { order: 1 }) }, text("Done.")],
    {
      tools: [lookup],
    },
  );
  const kept: Message[] = [];
  events.forEach((event, index) => {
    if (event.type === "model_call_end" && events[index + 1]?.type !== "retry") kept.push(event.message);
  });
  const assistants = result.context.messages.filter((message) => message.role === "assistant");
  assert.deepEqual(assistants, kept);
  assert.equal(result.stopReason, "done");
});

test("a retryable failure that never succeeds ends the run error after exactly turnRetries retries", async () => {
  const { adapter, waits, events, result } = await retried([cutOff(), cutOff(), cutOff()], {
    turnRetries: 2,
    maxSteps: 20,
  });
  assert.equal(result.stopReason, "error");
  assert.equal(result.stopReason === "error" ? result.error.kind : undefined, "retryable");
  assert.equal(adapter.calls.length, 3);
  assert.equal(retryEvents(events).length, 2);
  assert.deepEqual(waits, [2000, 4000]);
  // The last failure was not retried, so it stays in the transcript and its model_call_end has no retry after it.
  assert.equal(result.context.messages.at(-1)?.role, "assistant");
});

test("a retry waits as the gateway does: turnRetryDelayMs doubling, or a longer retry-after hint, up to 60 seconds", async () => {
  const { waits } = await retried([cutOff(), cutOff("a", { retryAfterMs: 9000 }), cutOff(), text("ok")], {
    turnRetryDelayMs: 100,
  });
  assert.deepEqual(waits, [100, 9000, 400]);
});

test("a retry streak counts against maxSteps, and a run it stops ends max_steps", async () => {
  const { adapter, events, result } = await retried([cutOff(), cutOff()], { maxSteps: 2, turnRetries: 5 });
  assert.equal(result.stopReason, "max_steps");
  assert.equal(adapter.calls.length, 2);
  assert.equal(result.steps, 2);
  assert.equal(retryEvents(events).length, 1);
  assert.ok(events.some((event) => event.type === "warning" && event.code === "max_steps"));
  assert.equal(result.context.messages.at(-1)?.role, "assistant");
});

test("a first failure on the last step ends error, as it would without turn retries", async () => {
  const { adapter, events, result } = await retried([cutOff()], { maxSteps: 1, turnRetries: 3 });
  assert.equal(result.stopReason, "error");
  assert.equal(result.stopReason === "error" ? result.error.kind : undefined, "retryable");
  assert.equal(adapter.calls.length, 1);
  assert.equal(retryEvents(events).length, 0);
});

test("a sleep that rejects ends the wait early with a hook_error, and the retry still goes out", async () => {
  const { adapter, events, result } = await retried([cutOff(), text("ok")], {
    sleep: async () => {
      throw new Error("timer disposed");
    },
  });
  assert.equal(result.stopReason, "done");
  assert.equal(adapter.calls.length, 2);
  assert.ok(events.some((event) => event.type === "hook_error" && event.hook === "sleep"));
});

test("a retryable failure whose retry-after is over the gateway's 60-second cap is not retried and keeps its hint", async () => {
  const { adapter, events, result } = await retried([cutOff("The", { retryAfterMs: 61_000 })]);
  assert.equal(result.stopReason, "error");
  assert.equal(adapter.calls.length, 1);
  assert.equal(retryEvents(events).length, 0);
  const last = result.context.messages.at(-1);
  assert.equal(last?.role === "assistant" ? last.error?.retryAfterMs : undefined, 61_000);
});

test("a hint at the cap is retried, waiting the cap", async () => {
  const { waits, result } = await retried([cutOff("The", { retryAfterMs: 60_000 }), text("ok")]);
  assert.equal(result.stopReason, "done");
  assert.deepEqual(waits, [60_000]);
});

for (const kind of ["overflow", "quota", "fatal"] as const) {
  test(`a ${kind} failure is never retried at the turn level`, async () => {
    const { adapter, events, result } = await retried([cutOff("The", { kind })]);
    assert.equal(result.stopReason, "error");
    assert.equal(result.stopReason === "error" ? result.error.kind : undefined, kind);
    assert.equal(adapter.calls.length, 1);
    assert.equal(retryEvents(events).length, 0);
  });
}

test("with turnRetries unset the run ends error on the first failure, as before", async () => {
  const { adapter, model } = scripted([cutOff()]);
  const { events, result } = await drive(run({ model, system: SYSTEM, input: "Go.", ...determinism() }));
  assert.equal(result.stopReason, "error");
  assert.equal(adapter.calls.length, 1);
  assert.equal(retryEvents(events).length, 0);
  assert.deepEqual(typesOf(events).filter((type) => type === "step_end").length, 1);
});

test("the result's usage and cost include every failed attempt", async () => {
  const adapter = new ScriptedModel([
    cutOff(),
    cutOff("again"),
    { ...text("ok"), usage: { uncachedInput: 20, output: 7 } },
  ]);
  const rate = { uncachedInput: 1, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 1, upToInputTokens: null };
  const source = "https://provider.test/pricing";
  const catalog: PriceCatalog = {
    models: [
      {
        provider: "scripted",
        id: "priced",
        rates: [rate],
        contextWindow: 200_000,
        maxOutputTokens: 4000,
        asOf: "2026-11-01",
        sources: { rates: source, contextWindow: source, maxOutputTokens: source },
      },
    ],
  };
  const model = createModel({ adapter, id: "priced", catalog, retries: 0 });
  const { sleep } = fakeSleep();
  const { result } = await drive(run({ model, system: SYSTEM, input: "Go.", turnRetries: 2, sleep, ...determinism() }));
  assert.equal(result.stopReason, "done");
  assert.equal(result.usage.uncachedInput, 40);
  assert.equal(result.usage.output, 13);
  assert.equal(result.cost.total, (40 + 13) / 1_000_000);
});

test("an abort during the backoff ends the run aborted with a well-formed transcript", async () => {
  const controller = new AbortController();
  const sleep = async () => controller.abort();
  const { adapter, events, result } = await retried([cutOff()], { signal: controller.signal, sleep });
  assert.equal(result.stopReason, "aborted");
  assert.equal(adapter.calls.length, 1);
  const last = result.context.messages.at(-1);
  assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "aborted");
  assert.deepEqual(
    result.context.messages.map((message) => message.role),
    ["user", "assistant"],
  );
  assert.deepEqual(typesOf(events).slice(-2), ["agent_settled", "run_end"]);
  // The failed call was billed, so its usage stays in the result.
  assert.equal(result.usage.uncachedInput, 10);
});

test("a failed attempt's tool calls never run, and the retry's tool call runs once", async () => {
  const inputs: unknown[] = [];
  const tool = defineTool({
    ...lookup,
    async execute(input) {
      inputs.push(input);
      return { content: [{ type: "text", text: "shipped" }] };
    },
  });
  const failed = { ...toolCall("lookup", { order: 1 }), error: { kind: "retryable" as const, message: "cut off" } };
  const { events, result } = await retried([failed, toolCall("lookup", { order: 1 }), text("Done.")], {
    tools: [tool],
  });
  assert.equal(result.stopReason, "done");
  assert.equal(inputs.length, 1);
  assert.equal(events.filter((event) => event.type === "tool_call_start").length, 1);
  assert.deepEqual(
    result.context.messages.map((message) => message.role),
    ["user", "assistant", "tool", "assistant"],
  );
});

test("the interceptors before the model call, and the budget check, run for every attempt", async () => {
  const seen: number[] = [];
  const { events, result } = await retried([cutOff(), cutOff(), text("ok")], {
    interceptors: {
      beforeModelCall: async ({ context }) => {
        seen.push(context.messages.length);
        return undefined;
      },
    },
  });
  assert.equal(result.stopReason, "done");
  assert.deepEqual(seen, [1, 1, 1]);
  assert.equal(retryEvents(events).length, 2);
});

test("afterModelCall sees the response the run goes on with, not a failure that is retried", async () => {
  const seen: string[] = [];
  const { result } = await retried([cutOff(), text("ok")], {
    interceptors: {
      afterModelCall: async ({ message }) => {
        seen.push(message.stopReason);
        return undefined;
      },
    },
  });
  assert.equal(result.stopReason, "done");
  assert.deepEqual(seen, ["stop"]);
});

test("the budget is checked before each retry, and a failed attempt's cost counts toward it", async () => {
  const source = "https://provider.test/pricing";
  const catalog: PriceCatalog = {
    models: [
      {
        provider: "scripted",
        id: "priced",
        rates: [
          { uncachedInput: 3, cacheRead: 0, cacheWrite: { "5m": 0, "1h": 0 }, output: 15, upToInputTokens: null },
        ],
        contextWindow: 200_000,
        maxOutputTokens: 4000,
        asOf: "2026-11-01",
        sources: { rates: source, contextWindow: source, maxOutputTokens: source },
      },
    ],
  };
  const adapter = new ScriptedModel([{ ...cutOff(), usage: { uncachedInput: 10_000, output: 100 } }]);
  const model = createModel({ adapter, id: "priced", catalog, retries: 0 });
  const { sleep, waits } = fakeSleep();
  const { events, result } = await drive(
    run({ model, system: SYSTEM, input: "Go.", turnRetries: 3, budgetUsd: 0.07, sleep, ...determinism() }),
  );
  assert.equal(result.stopReason, "budget");
  assert.equal(adapter.calls.length, 1);
  assert.equal(result.usage.uncachedInput, 10_000);
  // The budget can't cover a retry, so none is announced or waited for, and the failure stays in the transcript.
  assert.equal(retryEvents(events).length, 0);
  assert.deepEqual(waits, []);
  const last = result.context.messages.at(-1);
  assert.equal(last?.role === "assistant" ? last.stopReason : undefined, "error");
});

test("a budgeted run whose failed attempt has an unknown cost ends error with that failure, not unknown_price", async () => {
  const adapter = new ScriptedModel([{ ...cutOff(), usage: { unreported: true } }, text("ok")]);
  const model = createModel({ adapter, id: "priced", catalog: pricedCatalog(), retries: 0 });
  const { sleep, waits } = fakeSleep();
  const { events, result } = await drive(
    run({ model, system: SYSTEM, input: "Go.", turnRetries: 3, budgetUsd: 1, sleep, ...determinism() }),
  );
  assert.equal(result.stopReason, "error");
  assert.equal(result.stopReason === "error" ? result.error.kind : undefined, "retryable");
  assert.equal(adapter.calls.length, 1);
  assert.equal(retryEvents(events).length, 0);
  assert.deepEqual(waits, []);
});

test("retries are not a stuck loop: the same failed-then-retried call never trips the progress check", async () => {
  const failing = { ...toolCall("lookup", { order: 1 }), error: { kind: "retryable" as const, message: "cut off" } };
  const { result } = await retried(
    [failing, failing, failing, failing, toolCall("lookup", { order: 1 }), text("Done.")],
    {
      tools: [lookup],
      turnRetries: 4,
      maxSteps: 10,
    },
  );
  assert.equal(result.stopReason, "done");
});

test("a gateway retry and a turn retry are told apart by layer", async () => {
  const overloaded = { content: [], error: { kind: "retryable" as const, message: "overloaded", status: 529 } };
  const adapter = new ScriptedModel([overloaded, cutOff(), text("ok")]);
  const { sleep } = fakeSleep();
  const model = createModel({ adapter, id: "m", retries: 1, sleep });
  const { events, result } = await drive(
    run({ model, system: SYSTEM, input: "Go.", turnRetries: 1, sleep, ...determinism() }),
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(
    retryEvents(events).map(({ layer, attempt }) => [layer, attempt]),
    [
      ["gateway", 1],
      ["turn", 1],
    ],
  );
});

test("the count restarts after a call that succeeds", async () => {
  const { result, events } = await retried([cutOff(), toolCall("lookup", { order: 1 }), cutOff(), text("Done.")], {
    tools: [lookup],
    turnRetries: 1,
  });
  assert.equal(result.stopReason, "done");
  assert.equal(retryEvents(events).length, 2);
});

test("turnRetries, turnRetryDelayMs and sleep are checked", () => {
  const { model } = scripted([text("ok")]);
  for (const bad of [
    { turnRetries: -1 },
    { turnRetries: 1.5 },
    { turnRetryDelayMs: -1 },
    { turnRetryDelayMs: 60_001 },
    { turnRetries: Symbol("x") as never },
    { turnRetryDelayMs: Symbol("x") as never },
  ]) {
    assert.throws(
      () => run({ model, system: SYSTEM, input: "Go.", ...bad }),
      (error) => isSdkError(error) && error.code === "invalid_run_options",
    );
  }
  assert.throws(
    () => run({ model, system: SYSTEM, input: "Go.", sleep: "soon" as never }),
    (error) => isSdkError(error) && error.code === "invalid_run_options",
  );
});

test("a retry's transformContext sees the last accepted call's usage, not the failed attempt's", async () => {
  const seen: Array<number | undefined> = [];
  const interceptors = {
    transformContext: async (e: { messages: readonly Message[]; lastUsage?: { uncachedInput: number } }) => {
      seen.push(e.lastUsage?.uncachedInput);
      return e.messages;
    },
  };
  const { result } = await retried(
    [{ ...toolCall("lookup", { orderId: "1" }), usage: { uncachedInput: 100, output: 5 } }, cutOff(), text("Done.")],
    { tools: [lookup], interceptors },
  );
  assert.equal(result.stopReason, "done");
  assert.deepEqual(seen, [undefined, 100, 100]);
});

test("a steer sent during the wait is applied to the retry's request, with the retry's step index", async () => {
  let started: Run | undefined;
  let receipt: Promise<{ stepIndex: number }> | undefined;
  const { adapter, model } = scripted([cutOff(), text("ok")]);
  started = run({
    model,
    system: SYSTEM,
    input: "Go.",
    turnRetries: 2,
    sleep: async () => {
      receipt = started?.steer("Be brief.");
    },
    ...determinism(),
  });
  const { result } = await drive(started);
  assert.equal(result.stopReason, "done");
  assert.equal((await receipt)?.stepIndex, 1);
  const lastRequest = adapter.calls[1]?.context.messages.at(-1);
  assert.deepEqual(lastRequest?.content, [{ type: "text", text: "Be brief." }]);
});
