// The pre-call USD cap for the AI SDK (E5): `costGuard()` projects each provider request with the gateway's formula and
// refuses it before `doGenerate` or `doStream` runs when the spend so far plus the projection would pass the cap. Every
// model here is a `MockLanguageModelV4` that records its requests, so "never sent" means the mock saw no request.
import assert from "node:assert/strict";
import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { isSafetyError } from "@buildanagent/agent-safety";
import {
  BudgetExceeded,
  budgetRefusal,
  type CostGuardOptions,
  costGuard,
  type FileRef,
  type GuardedCall,
  guardedModel,
  guardedProvider,
  memorySpend,
  type Spend,
} from "@buildanagent/agent-safety/cost";
import { type PriceCatalog, priceUsage } from "@buildanagent/gateway";
import {
  APICallError,
  customProvider,
  generateText,
  isStepCount,
  jsonSchema,
  type LanguageModelMiddleware,
  streamText,
  tool,
  wrapLanguageModel,
} from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { expect, test } from "vitest";

const STEPS = 30;
// Dollars per million tokens, and the output limit the projection prices every call at.
const INPUT_RATE = 3;
const OUTPUT_RATE = 15;
const OUTPUT_LIMIT = 4000;
const SOURCE = "https://provider.test/pricing";

function entry(id: string) {
  return {
    provider: "mock",
    id,
    rates: [
      {
        uncachedInput: INPUT_RATE,
        cacheRead: 0.3,
        cacheWrite: { "5m": 3.75, "1h": 6 },
        output: OUTPUT_RATE,
        upToInputTokens: null,
      },
    ],
    contextWindow: 200_000,
    maxOutputTokens: OUTPUT_LIMIT,
    asOf: "2026-11-01",
    sources: { rates: SOURCE, contextWindow: SOURCE, maxOutputTokens: SOURCE },
  };
}

const CATALOG: PriceCatalog = { models: [entry("priced"), entry("priced-b")] };

type ReportedUsage = { input: number; output: number } | "unreported";

function usageOf(reported: ReportedUsage) {
  if (reported === "unreported") {
    return {
      inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    };
  }
  return {
    inputTokens: { total: reported.input, noCache: reported.input, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: reported.output, text: reported.output, reasoning: undefined },
  };
}

/** What call `n` (from 0) reports: input that grows by 100 tokens a call, and 200 output tokens. */
function growing(n: number): ReportedUsage {
  return { input: 1000 + 100 * n, output: 200 };
}

/** The dollars a response with `reported` usage costs at the test rates. */
function costOf(reported: { input: number; output: number }): number {
  return (reported.input * INPUT_RATE + reported.output * OUTPUT_RATE) / 1_000_000;
}

interface ScriptOptions {
  readonly id?: string;
  readonly steps?: number;
  readonly usage?: (n: number) => ReportedUsage;
  /** Throws this error from call `n` instead of answering, once. */
  readonly failFirst?: Error;
}

/** A model that calls `lookup` until its last step, then answers, recording every request on generate and stream. */
function scripted(options: ScriptOptions = {}) {
  const { id = "priced", steps = STEPS, usage = growing } = options;
  const requests: LanguageModelV4CallOptions[] = [];
  let failure = options.failFirst;
  const content = (n: number) =>
    n < steps - 1
      ? ({
          type: "tool-call",
          toolCallId: `call_${n}`,
          toolName: "lookup",
          input: JSON.stringify({ order: n }),
        } as const)
      : ({ type: "text", text: "All shipped." } as const);
  const answer = (options: LanguageModelV4CallOptions) => {
    if (failure !== undefined) {
      const error = failure;
      failure = undefined;
      throw error;
    }
    requests.push(options);
    return requests.length - 1;
  };
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: id,
    doGenerate: async (options) => {
      const n = answer(options);
      return {
        content: [content(n)],
        finishReason: { unified: n < steps - 1 ? "tool-calls" : "stop", raw: undefined },
        usage: usageOf(usage(n)),
        warnings: [],
      };
    },
    doStream: async (options) => {
      const n = answer(options);
      const part = content(n);
      const chunks: LanguageModelV4StreamPart[] =
        part.type === "text"
          ? [
              { type: "text-start", id: "t" },
              { type: "text-delta", id: "t", delta: part.text },
              { type: "text-end", id: "t" },
            ]
          : [part];
      chunks.push({
        type: "finish",
        finishReason: { unified: n < steps - 1 ? "tool-calls" : "stop", raw: undefined },
        usage: usageOf(usage(n)),
      });
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
  return { model, requests };
}

const lookup = tool({
  description: "Look up an order's status",
  inputSchema: jsonSchema<{ order: number }>({ type: "object", properties: { order: { type: "number" } } }),
  execute: async () => ({ status: "shipped" }),
});

const SYSTEM = "You look up orders.";

/** One guarded run: what the model saw, the calls the guard let through, the spend, and the error it ended with. */
interface Run {
  readonly requests: number;
  readonly calls: readonly GuardedCall[];
  readonly spent: number;
  readonly error: unknown;
}

async function guardedRun(capUsd: number, options: ScriptOptions = {}, kind: "generate" | "stream" = "generate") {
  const { model, requests } = scripted(options);
  const calls: GuardedCall[] = [];
  const spend = memorySpend();
  const guard = costGuard({ capUsd, spend, catalog: CATALOG, onCallCost: (call) => calls.push(call) });
  const args = {
    model: guardedModel(model, guard),
    system: SYSTEM,
    prompt: "Go.",
    tools: { lookup },
    stopWhen: isStepCount(STEPS),
    maxRetries: 0,
  };
  let error: unknown;
  if (kind === "generate") {
    await generateText(args).catch((e: unknown) => {
      error = e;
    });
  } else {
    const result = streamText({
      ...args,
      onError: ({ error: e }) => {
        error = e;
      },
    });
    await result.consumeStream();
  }
  return { requests: requests.length, calls, spent: await spend.get(), error } satisfies Run;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** How many calls the pre-emptive rule lets through under `capUsd`: it sends call n + 1 while spend + projection fit. */
function affordableCalls(calls: readonly GuardedCall[], capUsd: number): number {
  let spent = 0;
  for (const [n, call] of calls.entries()) {
    if (spent + call.projectedUsd > capUsd) return n;
    spent += call.costUsd ?? Number.NaN;
  }
  return calls.length;
}

function refusal(error: unknown): BudgetExceeded {
  const found = budgetRefusal(error);
  assert.ok(found, `expected a BudgetExceeded, got ${String(error)}`);
  return found;
}

// --- The AI SDK calls a wrapped model's middleware on every request ---------------------------------------------------

/** A middleware that counts the provider requests it sees, on generate and stream. */
function counting(): { middleware: LanguageModelMiddleware; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate }) => {
        seen.push("generate");
        return doGenerate();
      },
      wrapStream: async ({ doStream }) => {
        seen.push("stream");
        return doStream();
      },
    },
  };
}

// The retry delay `ai` reads from the error's headers, so the retry runs at once.
const retryable = () =>
  new APICallError({
    message: "overloaded",
    url: "https://provider.test/v1/messages",
    requestBodyValues: {},
    statusCode: 529,
    responseHeaders: { "retry-after-ms": "0" },
    isRetryable: true,
  });

test("in ai 7.0.162 a wrapLanguageModel middleware sees every step and every retry of generateText", async () => {
  const { model, requests } = scripted({ steps: 3, failFirst: retryable() });
  const { middleware, seen } = counting();
  const result = await generateText({
    model: wrapLanguageModel({ model, middleware }),
    prompt: "Go.",
    tools: { lookup },
    stopWhen: isStepCount(5),
    maxRetries: 1,
  });
  assert.equal(result.steps.length, 3);
  assert.equal(requests.length, 3, "three answered requests");
  assert.deepEqual(seen, ["generate", "generate", "generate", "generate"], "three steps plus the retried attempt");
});

test("in ai 7.0.162 a wrapLanguageModel middleware sees every step and every retry of streamText", async () => {
  const { model, requests } = scripted({ steps: 3, failFirst: retryable() });
  const { middleware, seen } = counting();
  const result = streamText({
    model: wrapLanguageModel({ model, middleware }),
    prompt: "Go.",
    tools: { lookup },
    stopWhen: isStepCount(5),
    maxRetries: 1,
  });
  await result.consumeStream();
  assert.equal((await result.steps).length, 3);
  assert.equal(requests.length, 3);
  assert.deepEqual(seen, ["stream", "stream", "stream", "stream"]);
});

// --- The cap ----------------------------------------------------------------------------------------------------------

test("a run whose next call would cross the cap stops before that call, and the model records no extra request", async () => {
  const baseline = await guardedRun(1000);
  assert.equal(baseline.error, undefined);
  assert.equal(baseline.calls.length, STEPS);
  const calls = baseline.calls;

  // The cap sits a nano-dollar under what ten calls plus the eleventh's projection cost, so ten calls fit.
  const capUsd = sum(calls.slice(0, 10).map((c) => c.costUsd ?? 0)) + (calls[10]?.projectedUsd ?? 0) - 1e-9;
  assert.equal(affordableCalls(calls, capUsd), 10);
  const run = await guardedRun(capUsd);

  assert.equal(run.requests, 10, "the mock model saw no request past the tenth");
  const error = refusal(run.error);
  assert.ok(run.error instanceof BudgetExceeded, "generateText rejects with the refusal itself");
  assert.ok(isSafetyError(error));
  assert.equal(error.code, "budget_exceeded");
  assert.equal(error.capUsd, capUsd);
  assert.equal(error.provider, "mock.chat");
  assert.equal(error.modelId, "priced");
  assert.ok(error.spentUsd <= capUsd);
  assert.equal(error.projectedUsd, calls[10]?.projectedUsd);
  assert.ok(error.spentUsd + (error.projectedUsd ?? 0) > capUsd);
  assert.match(error.message, /passes the cap/);
  assert.doesNotMatch(error.message, /\d{8,}/);
  assert.ok(Math.abs(run.spent - sum(calls.slice(0, 10).map((c) => c.costUsd ?? 0))) < 1e-12);
});

test("each call's cost is its reported usage at the catalog's rates", async () => {
  const run = await guardedRun(1000, { steps: 3 });
  assert.deepEqual(
    run.calls.map((c) => c.costUsd),
    [0, 1, 2].map((n) => costOf(growing(n) as { input: number; output: number })),
  );
});

test("a cap of zero refuses the first call", async () => {
  const run = await guardedRun(0);
  assert.equal(run.requests, 0);
  assert.equal(refusal(run.error).code, "budget_exceeded");
});

test("overshoot on a 30-step run: the pre-emptive check stays under the cap, a post-response check crosses it", async () => {
  const { calls } = await guardedRun(1000);
  const spentAfter = (n: number) => sum(calls.slice(0, n).map((c) => c.costUsd ?? 0));
  // One call's projection error: how far the guard's projection ran above the call's actual cost.
  const projectionError = Math.max(...calls.map((c) => c.projectedUsd - (c.costUsd ?? 0)));
  expect(projectionError).toBeGreaterThan(0);
  for (const call of calls) assert.ok(call.projectedUsd >= (call.costUsd ?? 0), "the projection never undershoots");

  const pre: number[] = [];
  const post: number[] = [];
  // A cap just above the spend after k calls: a post-response check has not crossed it, so it sends call k + 1, which
  // crosses. The pre-emptive check refuses a call as soon as its projection might cross.
  for (let k = 1; k < STEPS; k++) {
    const capUsd = spentAfter(k) + 1e-9;
    const run = await guardedRun(capUsd);
    assert.equal(run.requests, affordableCalls(calls, capUsd), "the guard sent each call it could afford");
    assert.equal(refusal(run.error).code, "budget_exceeded");
    pre.push(Math.max(0, run.spent - capUsd));
    // A post-response check stops after the first call whose cost reaches the cap, k + 1 here.
    post.push(Math.max(0, spentAfter(k + 1) - capUsd));
  }
  // The overshoot is at most one call's projection error; the projection never undershoots here, so it is zero.
  for (const value of pre) assert.ok(value <= projectionError);
  assert.equal(Math.max(...pre), 0);
  post.forEach((value, i) => {
    assert.ok(value >= (calls[i + 1]?.costUsd ?? Number.NaN) - 1e-8, `call ${i + 2} overshoots by nearly its cost`);
  });
});

test("a model with no price in the catalog is refused before its first request", async () => {
  const run = await guardedRun(100, { id: "unpriced" });
  assert.equal(run.requests, 0);
  const error = refusal(run.error);
  assert.equal(error.code, "unknown_price");
  assert.equal(error.projectedUsd, null);
  assert.match(error.message, /mock\.chat\/unpriced/);
});

test("a model outside the shipped catalog is refused when no catalog is passed", async () => {
  const { model, requests } = scripted();
  const guard = costGuard({ capUsd: 100, spend: memorySpend() });
  const error = await generateText({ model: guardedModel(model, guard), prompt: "Go." }).catch((e: unknown) => e);
  assert.equal(refusal(error).code, "unknown_price");
  assert.equal(requests.length, 0);
});

test("a call that reports no usage is charged its projection, and the next call is refused as unknown_price", async () => {
  const run = await guardedRun(100, { usage: (n) => (n === 0 ? "unreported" : growing(n)) });
  assert.equal(run.requests, 1);
  assert.equal(run.calls[0]?.costUsd, null);
  assert.equal(run.spent, run.calls[0]?.projectedUsd);
  const error = refusal(run.error);
  assert.equal(error.code, "unknown_price");
  assert.match(error.message, /reported no usage/);
});

test("a streamed run is capped before the crossing call, and its spend matches its finish usage", async () => {
  const baseline = await guardedRun(1000, {}, "stream");
  assert.equal(baseline.error, undefined);
  assert.equal(baseline.calls.length, STEPS);
  const expected = sum(
    Array.from({ length: STEPS }, (_, n) => costOf(growing(n) as { input: number; output: number })),
  );
  assert.ok(Math.abs(baseline.spent - expected) < 1e-12, "the spend is the finish parts' usage, priced");

  const calls = baseline.calls;
  const capUsd = sum(calls.slice(0, 5).map((c) => c.costUsd ?? 0)) + (calls[5]?.projectedUsd ?? 0) - 1e-9;
  const run = await guardedRun(capUsd, {}, "stream");
  assert.equal(run.requests, 5, "the mock model streamed no response past the fifth");
  assert.equal(refusal(run.error).code, "budget_exceeded");
});

test("a prepareStep that switches to another model from the same guardedProvider is still capped", async () => {
  const a = scripted({ id: "priced" });
  const b = scripted({ id: "priced-b" });
  const spend = memorySpend();
  const provider = guardedProvider(
    customProvider({ languageModels: { priced: a.model, "priced-b": b.model } }),
    costGuard({ capUsd: 0.076, spend, catalog: CATALOG }),
  );
  const error = await generateText({
    model: provider.languageModel("priced"),
    system: SYSTEM,
    prompt: "Go.",
    tools: { lookup },
    stopWhen: isStepCount(STEPS),
    maxRetries: 0,
    prepareStep: ({ stepNumber }) => (stepNumber === 0 ? undefined : { model: provider.languageModel("priced-b") }),
  }).catch((e: unknown) => e);
  // The first call can cost up to $0.0602 and each later one up to $0.0675 (input at the dearest input rate, plus 4,000
  // output tokens), so after the first call's $0.006 the cap fits one more call and no third.
  assert.equal(a.requests.length, 1);
  assert.equal(b.requests.length, 1, "the model prepareStep picked stopped at the cap");
  const refused = refusal(error);
  assert.equal(refused.modelId, "priced-b");
  assert.ok((await spend.get()) <= 0.076);
});

test("a prepareStep model built outside the guarded provider escapes the cap, the risk guardedProvider() closes", async () => {
  const a = scripted({ id: "priced" });
  const outside = scripted({ id: "priced-b", steps: 3 });
  const provider = guardedProvider(
    customProvider({ languageModels: { priced: a.model } }),
    costGuard({ capUsd: 0.07, spend: memorySpend(), catalog: CATALOG }),
  );
  const result = await generateText({
    model: provider.languageModel("priced"),
    prompt: "Go.",
    tools: { lookup },
    stopWhen: isStepCount(5),
    prepareStep: ({ stepNumber }) => (stepNumber === 0 ? undefined : { model: outside.model }),
  });
  assert.equal(a.requests.length, 1);
  assert.equal(outside.requests.length, 3, "an unwrapped model's calls are never checked");
  assert.equal(result.steps.length, 4);
});

test("calls that run at the same time through one guard share its cap", async () => {
  const gates: (() => void)[] = [];
  const requests: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doGenerate: async (options) => {
      requests.push(options);
      await new Promise<void>((resolve) => gates.push(resolve));
      return {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usageOf({ input: 10, output: 10 }),
        warnings: [],
      };
    },
  });
  const calls: GuardedCall[] = [];
  const spend = memorySpend();
  // Probe one call's projection, then cap at two and a half of them.
  const probe = costGuard({ capUsd: 1, spend: memorySpend(), catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  const once = generateText({ model: guardedModel(model, probe), prompt: "Go.", maxRetries: 0 });
  await waitFor(() => gates.length === 1);
  gates.shift()?.();
  await once;
  const projected = calls[0]?.projectedUsd ?? Number.NaN;
  requests.length = 0;

  const guarded = guardedModel(model, costGuard({ capUsd: projected * 2.5, spend, catalog: CATALOG }));
  const runs = Array.from({ length: 5 }, () =>
    generateText({ model: guarded, prompt: "Go.", maxRetries: 0 }).then(
      () => "sent",
      (e: unknown) => refusal(e).code,
    ),
  );
  await waitFor(() => gates.length === 2);
  for (const open of gates.splice(0)) open();
  const outcomes = await Promise.all(runs);
  assert.equal(requests.length, 2, "only two calls fit while both were in flight");
  assert.deepEqual(outcomes.sort(), ["budget_exceeded", "budget_exceeded", "budget_exceeded", "sent", "sent"]);
  assert.ok((await spend.get()) <= projected * 2.5);
});

/** Waits a few ticks for `ready()`, for the calls above that start asynchronously. */
async function waitFor(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.ok(ready(), "the condition never held");
}

test("one Spend across runs caps the session, and a guard per run caps each run", async () => {
  const session = memorySpend();
  const perCall = costOf(growing(0) as { input: number; output: number });
  async function oneRun(runCapUsd: number) {
    const { model, requests } = scripted({ steps: 3, usage: () => growing(0) });
    const guards = [
      costGuard({ capUsd: runCapUsd, spend: memorySpend(), catalog: CATALOG }),
      costGuard({ capUsd: 0.1, spend: session, catalog: CATALOG }),
    ];
    const error = await generateText({
      model: guardedModel(model, guards),
      prompt: "Go.",
      tools: { lookup },
      stopWhen: isStepCount(3),
      maxRetries: 0,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    return { requests: requests.length, error };
  }
  const first = await oneRun(10);
  assert.deepEqual(first, { requests: 3, error: undefined });
  // The run's cap fits one call, so this run stops on its own cap while the session still has room.
  const second = await oneRun(0.065);
  assert.equal(second.requests, 1);
  assert.equal(refusal(second.error).capUsd, 0.065);
  // The session has spent four calls' worth, $0.024. A first call can cost up to $0.0602 and a later one up to $0.0675,
  // so two more calls fit under $0.1 and a third does not.
  const third = await oneRun(10);
  assert.equal(third.requests, 2);
  assert.equal(refusal(third.error).capUsd, 0.1);
  assert.ok(Math.abs((await session.get()) - 6 * perCall) < 1e-12);
});

test("a retried attempt is checked again, and an attempt that failed adds nothing to the spend", async () => {
  const { model, requests } = scripted({ steps: 1, failFirst: retryable() });
  const calls: GuardedCall[] = [];
  const spend = memorySpend();
  const guard = costGuard({ capUsd: 1, spend, catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  await generateText({ model: guardedModel(model, guard), prompt: "Go.", maxRetries: 1 });
  assert.equal(requests.length, 1);
  assert.equal(calls.length, 1, "only the answered attempt is charged");
  assert.equal(await spend.get(), calls[0]?.costUsd);
});

test("a refusal on a retry reaches the caller inside a RetryError, and budgetRefusal() finds it", async () => {
  const { model, requests } = scripted({ steps: 1, failFirst: retryable() });
  const spend: Spend = memorySpend();
  // The first attempt fails; before the retry, another call through the same Spend uses up the cap.
  const guard = costGuard({ capUsd: 0.07, spend, catalog: CATALOG });
  const failing = {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate();
      } catch (error) {
        await spend.add(0.07);
        throw error;
      }
    },
  } satisfies LanguageModelMiddleware;
  const error = await generateText({
    model: guardedModel(model, [failing, guard]),
    prompt: "Go.",
    maxRetries: 1,
  }).catch((e: unknown) => e);
  assert.equal(requests.length, 0);
  assert.ok(!(error instanceof BudgetExceeded), "the AI SDK wrapped the refusal");
  assert.equal(refusal(error).code, "budget_exceeded");
});

test("maxOutputTokens is set on a call that sets none, and the call is priced at it", async () => {
  const { model, requests } = scripted({ steps: 1 });
  const calls: GuardedCall[] = [];
  const guard = costGuard({
    capUsd: 1,
    spend: memorySpend(),
    catalog: CATALOG,
    maxOutputTokens: 100,
    onCallCost: (c) => calls.push(c),
  });
  await generateText({ model: guardedModel(model, guard), prompt: "Go." });
  assert.equal(requests[0]?.maxOutputTokens, 100);
  assert.ok((calls[0]?.projectedUsd ?? 1) < (100 * OUTPUT_RATE + 1000 * INPUT_RATE) / 1_000_000);
  // A call that sets its own limit keeps it.
  const own = scripted({ steps: 1 });
  await generateText({ model: guardedModel(own.model, guard), prompt: "Go.", maxOutputTokens: 50 });
  assert.equal(own.requests[0]?.maxOutputTokens, 50);
  assert.ok((calls[1]?.projectedUsd ?? 1) < (calls[0]?.projectedUsd ?? 0));
});

test("a cap or output limit that isn't a valid number is refused when the guard is built", () => {
  for (const capUsd of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => costGuard({ capUsd, spend: memorySpend() }),
      (error) => isSafetyError(error) && error.code === "invalid_budget",
    );
  }
  assert.throws(
    () => costGuard({ capUsd: 1, spend: memorySpend(), maxOutputTokens: 0 }),
    (error) => isSafetyError(error) && error.code === "invalid_budget",
  );
});

test("cache reads and writes are priced at their own rates, and a write at the dearer lifetime", async () => {
  const { model } = scripted({ steps: 1 });
  const reported = {
    inputTokens: { total: 1000, noCache: 100, cacheRead: 500, cacheWrite: 400 },
    outputTokens: { total: 10, text: 10, reasoning: undefined },
  };
  const calls: GuardedCall[] = [];
  const guard = costGuard({ capUsd: 1, spend: memorySpend(), catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  const wrapped = wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate }) => ({ ...(await doGenerate()), usage: reported }),
    },
  });
  await generateText({ model: guardedModel(wrapped, guard), prompt: "Go." });
  const usage = {
    uncachedInput: 100,
    cacheRead: 500,
    cacheWrite: { "5m": 0, "1h": 400 },
    output: 10,
    reasoning: 0,
    raw: null,
  };
  assert.equal(calls[0]?.costUsd, priceUsage(usage, entry("priced")).total);
});

// --- The guard fails closed on a bad spend, a racing read, a failed write and an interrupted call --------------------

type CallPrompt = LanguageModelV4CallOptions["prompt"];
const USER_TURN: CallPrompt = [{ role: "user", content: [{ type: "text", text: "Go." }] }];

/** The error a model call rejects with, or `undefined` if it resolves. */
async function failure(call: PromiseLike<unknown>): Promise<unknown> {
  try {
    await call;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** A model whose calls answer at once with 10 input and 10 output tokens, recording each request. */
function answering(id = "priced") {
  const requests: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: id,
    doGenerate: async (options) => {
      requests.push(options);
      return {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usageOf({ input: 10, output: 10 }),
        warnings: [],
      };
    },
  });
  return { model, requests };
}

/** The projection of one call with `prompt`, through a fresh guard. */
async function projectionOf(prompt: CallPrompt, fileSize?: CostGuardOptions["fileSize"]): Promise<number> {
  const calls: GuardedCall[] = [];
  const guard = costGuard({
    capUsd: 100,
    spend: memorySpend(),
    catalog: CATALOG,
    ...(fileSize === undefined ? {} : { fileSize }),
    onCallCost: (c) => calls.push(c),
  });
  await guardedModel(answering().model, guard).doGenerate({ prompt });
  return calls[0]?.projectedUsd ?? Number.NaN;
}

test("a Spend that returns something other than a number of dollars refuses the call", async () => {
  for (const value of [undefined, "0.12", Number.NaN, -1]) {
    const { model, requests } = answering();
    const spend = { get: async () => value, add: async () => {} } as unknown as Spend;
    const error = await failure(
      guardedModel(model, costGuard({ capUsd: 1, spend, catalog: CATALOG })).doGenerate({ prompt: USER_TURN }),
    );
    assert.equal(refusal(error).code, "unknown_price", `for ${String(value)}`);
    assert.equal(requests.length, 0);
  }
});

test("a call that settles while another call reads a stale spend is still counted", async () => {
  const gates: (() => void)[] = [];
  const requests: LanguageModelV4CallOptions[] = [];
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doGenerate: async (options) => {
      requests.push(options);
      // Only the first call waits, so a second call that got through fails the test instead of hanging it.
      if (requests.length === 1) await new Promise<void>((resolve) => gates.push(resolve));
      return {
        content: [{ type: "text", text: "Done." }],
        finishReason: { unified: "stop", raw: undefined },
        // The first call costs about its whole projection, so a second one doesn't fit.
        usage: usageOf({ input: 10, output: OUTPUT_LIMIT }),
        warnings: [],
      };
    },
  });
  const projected = await projectionOf(USER_TURN);
  // A store whose read answers with the value it held when the read started, once `release()` lets it answer.
  let stored = 0;
  let release: (() => void) | undefined;
  const spend: Spend = {
    get: () => {
      const snapshot = stored;
      if (requests.length === 0) return Promise.resolve(snapshot);
      return new Promise((resolve) => {
        release = () => resolve(snapshot);
      });
    },
    add: async (usd) => {
      stored += usd;
    },
  };
  const guarded = guardedModel(model, costGuard({ capUsd: projected * 1.5, spend, catalog: CATALOG }));
  const first = guarded.doGenerate({ prompt: USER_TURN });
  await waitFor(() => gates.length === 1);
  const second = failure(guarded.doGenerate({ prompt: USER_TURN }));
  await waitFor(() => release !== undefined);
  // The first call settles, adds its cost and gives back its reservation while the second call's read is pending.
  gates.shift()?.();
  await first;
  release?.();
  const error = await second;
  assert.equal(requests.length, 1, "the second call never reached the provider");
  assert.equal(refusal(error).code, "budget_exceeded");
});

test("a Spend that fails to record a call's cost stops the guard", async () => {
  const { model, requests } = answering();
  let fail = true;
  const inner = memorySpend();
  const spend: Spend = {
    get: () => inner.get(),
    add: async (usd) => {
      if (fail) throw new Error("database timed out");
      await inner.add(usd);
    },
  };
  const guarded = guardedModel(model, costGuard({ capUsd: 1, spend, catalog: CATALOG }));
  await assert.rejects(Promise.resolve(guarded.doGenerate({ prompt: USER_TURN })), /database timed out/);
  fail = false;
  const error = await failure(guarded.doGenerate({ prompt: USER_TURN }));
  assert.equal(refusal(error).code, "unknown_price");
  assert.equal(requests.length, 1);
});

test("a stream cancelled before its finish part is charged its projection, and the guard carries on", async () => {
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunks: [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Partial" },
        ],
        chunkDelayInMs: 5,
      }),
    }),
    doGenerate: answering().model.doGenerate,
  });
  const calls: GuardedCall[] = [];
  const spend = memorySpend();
  const guard = costGuard({ capUsd: 1, spend, catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  const guarded = guardedModel(model, guard);
  const { stream } = await guarded.doStream({ prompt: USER_TURN });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel("the user pressed stop");
  await waitFor(() => calls.length === 1);
  assert.equal(calls[0]?.costUsd, null);
  assert.equal(await spend.get(), calls[0]?.projectedUsd);
  await guarded.doGenerate({ prompt: USER_TURN });
  assert.equal(calls.length, 2, "the next call went through");
});

test("a stream that reports an error and never finishes is charged its projection, and the guard carries on", async () => {
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunks: [
          { type: "text-start", id: "t" },
          { type: "error", error: new Error("overloaded") },
        ],
      }),
    }),
    doGenerate: answering().model.doGenerate,
  });
  const calls: GuardedCall[] = [];
  const spend = memorySpend();
  const guard = costGuard({ capUsd: 1, spend, catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  const guarded = guardedModel(model, guard);
  const { stream } = await guarded.doStream({ prompt: USER_TURN });
  await stream.pipeTo(new WritableStream());
  assert.equal(calls[0]?.costUsd, null);
  assert.equal(await spend.get(), calls[0]?.projectedUsd);
  await guarded.doGenerate({ prompt: USER_TURN });
  assert.equal(calls.length, 2, "the next call went through");
});

test("a call whose abort signal was already aborted when it was sent is not charged", async () => {
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doGenerate: async () => {
      throw new DOMException("aborted", "AbortError");
    },
  });
  const spend = memorySpend();
  const guard = costGuard({ capUsd: 1, spend, catalog: CATALOG });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    Promise.resolve(guardedModel(model, guard).doGenerate({ prompt: USER_TURN, abortSignal: controller.signal })),
    /aborted/,
  );
  assert.equal(await spend.get(), 0);
});

test("a refusal message writes a tiny cap in fixed notation", async () => {
  const guard = costGuard({ capUsd: 1e-7, spend: memorySpend(), catalog: CATALOG });
  const error = await failure(guardedModel(answering().model, guard).doGenerate({ prompt: USER_TURN }));
  assert.match(refusal(error).message, /cap of \$0\.0000001\b/);
});

test("a stream that ends without a finish part stops the guard as unreported", async () => {
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doStream: async () => ({
      stream: simulateReadableStream<LanguageModelV4StreamPart>({ chunks: [{ type: "text-start", id: "t" }] }),
    }),
  });
  const guarded = guardedModel(model, costGuard({ capUsd: 1, spend: memorySpend(), catalog: CATALOG }));
  const { stream } = await guarded.doStream({ prompt: USER_TURN });
  await stream.pipeTo(new WritableStream());
  const error = await failure(guarded.doStream({ prompt: USER_TURN }));
  assert.equal(refusal(error).code, "unknown_price");
});

test("a generate call its abort signal stopped is charged its projection", async () => {
  const model = new MockLanguageModelV4({
    provider: "mock.chat",
    modelId: "priced",
    doGenerate: (options) =>
      new Promise((_resolve, reject) => {
        options.abortSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  const calls: GuardedCall[] = [];
  const spend = memorySpend();
  const guard = costGuard({ capUsd: 1, spend, catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  const controller = new AbortController();
  const call = guardedModel(model, guard).doGenerate({ prompt: USER_TURN, abortSignal: controller.signal });
  await waitFor(() => model.doGenerateCalls.length === 1);
  controller.abort();
  await assert.rejects(Promise.resolve(call), /aborted/);
  assert.equal(calls.length, 1);
  assert.equal(await spend.get(), calls[0]?.projectedUsd);
});

test("an image a tool returns counts as an image, not as its base64 characters", async () => {
  type ToolPart = Extract<CallPrompt[number], { role: "tool" }>["content"][number];
  const toolTurn = (output: ToolPart): CallPrompt => [
    ...USER_TURN,
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "screen", input: {} }] },
    { role: "tool", content: [output] },
  ];
  const screenshot = "A".repeat(270_000);
  const withImage = await projectionOf(
    toolTurn({
      type: "tool-result",
      toolCallId: "c1",
      toolName: "screen",
      output: {
        type: "content",
        value: [{ type: "file", mediaType: "image/png", data: { type: "data", data: screenshot } }],
      },
    }),
  );
  const empty = await projectionOf(
    toolTurn({ type: "tool-result", toolCallId: "c1", toolName: "screen", output: { type: "content", value: [] } }),
  );
  // One image is 4,784 tokens at the dearest input rate, $6 a million here, not 108,000 tokens of base64.
  assert.ok(withImage - empty < (5000 * 6) / 1_000_000, `the image added ${withImage - empty}`);
  assert.ok(withImage - empty > (4700 * 6) / 1_000_000);
});

// The projection prices every input token at the model's dearest input rate: its long cache write, $6 a million.
const DEAREST_INPUT_RATE = 6;
const PDF_URL = "https://files.test/report.pdf";
const pdfTurn = (data: unknown): CallPrompt => [
  { role: "user", content: [{ type: "file", mediaType: "application/pdf", filename: "report.pdf", data } as never] },
];
// A PDF of no bytes, the baseline that a sized file's extra cost is measured from.
const noPdf = () => projectionOf(pdfTurn({ type: "url", url: new URL(PDF_URL) }), () => ({ bytes: 0 }));

test("a PDF sent by URL counts by the bytes fileSize gives, as the base64 characters it would take inline", async () => {
  const withBytes = await projectionOf(pdfTurn({ type: "url", url: new URL(PDF_URL) }), () => ({ bytes: 300_000 }));
  // 300,000 bytes are 400,000 base64 characters, at the gateway's 2.5 characters a token.
  const expected = ((400_000 / 2.5) * DEAREST_INPUT_RATE) / 1_000_000;
  assert.ok(Math.abs(withBytes - (await noPdf()) - expected) < 1e-6, `added ${withBytes - (await noPdf())}`);
});

test("a PDF sent by provider reference counts by its pages, each as one image", async () => {
  const withPages = await projectionOf(pdfTurn({ type: "reference", reference: { openai: "file-abc" } }), () => ({
    pages: 10,
  }));
  assert.ok(
    Math.abs(withPages - (await noPdf()) - (10 * 4784 * DEAREST_INPUT_RATE) / 1_000_000) < 1e-6,
    `added ${withPages - (await noPdf())}`,
  );
});

test("fileSize is asked once for each file, with the file's URL, kind, media type and name", async () => {
  const asked: FileRef[] = [];
  const same = { type: "url", url: new URL(PDF_URL) };
  const prompt: CallPrompt = [
    {
      role: "user",
      content: [
        { type: "file", mediaType: "application/pdf", filename: "report.pdf", data: same } as never,
        { type: "file", mediaType: "application/pdf", filename: "report.pdf", data: same } as never,
      ],
    },
  ];
  await projectionOf(prompt, (file) => {
    asked.push(file);
    return { bytes: 10 };
  });
  assert.deepEqual(asked, [{ kind: "url", source: PDF_URL, mediaType: "application/pdf", filename: "report.pdf" }]);
});

test("a file the guard can't size is refused before the call, whether it is sent by URL or by reference", async () => {
  const refs = [
    { type: "url", url: new URL(PDF_URL) },
    { type: "reference", reference: { openai: "file-abc" } },
  ];
  // What a `fileSize` can return that the guard can't use, and no `fileSize` at all.
  const unusable: [string, Partial<CostGuardOptions>][] = [
    ["no fileSize", {}],
    ...[undefined, null, "10", 5, { bytes: -1 }, { bytes: 1.5 }, { bytes: 2 ** 40 + 3 }].map(
      (size): [string, Partial<CostGuardOptions>] => [
        JSON.stringify(size) ?? "undefined",
        { fileSize: () => size as never },
      ],
    ),
    ...[{ pages: Number.NaN }, { pages: Number.POSITIVE_INFINITY }, { pages: 100_001 }, { bytes: 1, pages: 1 }].map(
      (size): [string, Partial<CostGuardOptions>] => [JSON.stringify(size), { fileSize: () => size as never }],
    ),
  ];
  for (const data of refs) {
    for (const [label, fileSize] of unusable) {
      const { model, requests } = answering();
      const spend = memorySpend();
      const guard = costGuard({ capUsd: 100, spend, catalog: CATALOG, ...fileSize });
      const refused = refusal(await failure(guardedModel(model, guard).doGenerate({ prompt: pdfTurn(data) })));
      assert.equal(refused.code, "unknown_price", `${data.type} with ${label}`);
      assert.equal(refused.projectedUsd, null);
      assert.match(refused.message, /report\.pdf/);
      assert.match(refused.message, /fileSize/);
      assert.equal(requests.length, 0, "the model received no request");
      assert.equal(await spend.get(), 0, "a refused call adds nothing to the spend");
    }
  }
});

test("a size far beyond a cap is counted without building the file, and refuses as budget_exceeded", async () => {
  const { model, requests } = answering();
  const guard = costGuard({ capUsd: 100, spend: memorySpend(), catalog: CATALOG, fileSize: () => ({ bytes: 5e9 }) });
  const refused = refusal(
    await failure(guardedModel(model, guard).doGenerate({ prompt: pdfTurn({ type: "url", url: new URL(PDF_URL) }) })),
  );
  assert.equal(refused.code, "budget_exceeded");
  assert.equal(requests.length, 0);
});

test("a refusal names a file without its URL's query, which may hold a signature", async () => {
  const signed = "https://bucket.test/reports/q3.pdf?X-Amz-Signature=secret123#frag";
  const prompt: CallPrompt = [
    {
      role: "user",
      content: [{ type: "file", mediaType: "application/pdf", data: { type: "url", url: new URL(signed) } } as never],
    },
  ];
  const guard = costGuard({ capUsd: 100, spend: memorySpend(), catalog: CATALOG });
  const refused = refusal(await failure(guardedModel(answering().model, guard).doGenerate({ prompt })));
  assert.match(refused.message, /https:\/\/bucket\.test\/reports\/q3\.pdf /);
  assert.doesNotMatch(refused.message, /secret123|X-Amz|frag/);
});

test("a size is asked for once for each file across calls, and a file with no size is asked for again", async () => {
  const asked: string[] = [];
  const answers = [undefined, { bytes: 10 }];
  const guard = costGuard({
    capUsd: 100,
    spend: memorySpend(),
    catalog: CATALOG,
    fileSize: (file) => {
      asked.push(file.source);
      return answers.shift() as never;
    },
  });
  const model = guardedModel(answering().model, guard);
  const prompt = pdfTurn({ type: "url", url: new URL(PDF_URL) });
  await failure(model.doGenerate({ prompt }));
  await model.doGenerate({ prompt });
  await model.doGenerate({ prompt });
  assert.deepEqual(asked, [PDF_URL, PDF_URL], "asked again after the first call had no size, then remembered");
});

test("a file a tool returns by URL is refused when it has no size, and counted when it has one", async () => {
  const prompt: CallPrompt = [
    ...USER_TURN,
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "fetch", input: {} }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "fetch",
          output: {
            type: "content",
            value: [
              { type: "file", mediaType: "application/pdf", data: { type: "url", url: new URL(PDF_URL) } } as never,
            ],
          },
        },
      ],
    },
  ];
  const { model, requests } = answering();
  const guard = costGuard({ capUsd: 100, spend: memorySpend(), catalog: CATALOG });
  assert.equal(refusal(await failure(guardedModel(model, guard).doGenerate({ prompt }))).code, "unknown_price");
  assert.equal(requests.length, 0);
  const none = await projectionOf(prompt, () => ({ pages: 0 }));
  const two = await projectionOf(prompt, () => ({ pages: 2 }));
  assert.ok(Math.abs(two - none - (2 * 4784 * DEAREST_INPUT_RATE) / 1_000_000) < 1e-6);
});

test("an image sent by URL needs no size, and a file sent inline is counted by its data", async () => {
  const image: CallPrompt = [
    {
      role: "user",
      content: [
        {
          type: "file",
          mediaType: "image/png",
          data: { type: "url", url: new URL("https://files.test/a.png") },
        } as never,
      ],
    },
  ];
  const asked: FileRef[] = [];
  await projectionOf(image, (file) => {
    asked.push(file);
    return undefined;
  });
  assert.deepEqual(asked, [], "an image is never sized");
  const inline = await projectionOf(pdfTurn({ type: "data", data: "A".repeat(40_000) }));
  assert.ok(inline > (await noPdf()));
});

test("a projection the catalog can't price is refused as unknown_price", async () => {
  const limited = entry("priced");
  const tier = { ...limited.rates[0], upToInputTokens: 1 };
  const catalog = { models: [{ ...limited, rates: [tier] }] } as PriceCatalog;
  const { model, requests } = answering();
  const error = await failure(
    guardedModel(model, costGuard({ capUsd: 1, spend: memorySpend(), catalog })).doGenerate({ prompt: USER_TURN }),
  );
  const refused = refusal(error);
  assert.equal(refused.code, "unknown_price");
  assert.equal(refused.projectedUsd, null);
  assert.equal(requests.length, 0);
});

test("a refusal for a model without a price reports what was spent", async () => {
  const { model } = answering("unpriced");
  const error = await failure(
    guardedModel(model, costGuard({ capUsd: 10, spend: memorySpend(4.9), catalog: CATALOG })).doGenerate({
      prompt: USER_TURN,
    }),
  );
  assert.equal(refusal(error).spentUsd, 4.9);
});

test("a continued call reuses earlier usage only for the same model, the same tools and the answer it returned", async () => {
  const calls: GuardedCall[] = [];
  const guard = costGuard({ capUsd: 100, spend: memorySpend(), catalog: CATALOG, onCallCost: (c) => calls.push(c) });
  const a = guardedModel(answering("priced").model, guard);
  const b = guardedModel(answering("priced-b").model, guard);
  const bigTool = { type: "function", name: "big", description: "x".repeat(25_000), inputSchema: {} } as const;
  const next = (answer: string): CallPrompt => [
    ...USER_TURN,
    { role: "assistant", content: [{ type: "text", text: answer }] },
    { role: "user", content: [{ type: "text", text: "Again." }] },
  ];
  await a.doGenerate({ prompt: USER_TURN });
  // The answer as returned: its call's 10 input and 10 output tokens stand in for the first two messages.
  await a.doGenerate({ prompt: next("Done.") });
  // Another model, a new tool or a longer answer than the call returned each count from characters instead.
  await b.doGenerate({ prompt: next("Done.") });
  await a.doGenerate({ prompt: next("Done."), tools: [bigTool] });
  await a.doGenerate({ prompt: next("y".repeat(25_000)) });
  // Input beyond the output limit's price, in tokens at the dearest input rate of $6 a million.
  const outputUsd = (OUTPUT_LIMIT * OUTPUT_RATE) / 1_000_000;
  const [reused, other, tools, longer] = calls.slice(1).map((c) => ((c.projectedUsd - outputUsd) * 1_000_000) / 6);
  assert.equal(Math.round(reused ?? 0), 20 + Math.ceil("Again.".length / 2.5));
  assert.equal(Math.round(other ?? 0), Math.ceil("Go.Done.Again.".length / 2.5), "another model's usage isn't reused");
  assert.ok((tools ?? 0) > 10_000, "the new tool's 10,000 tokens count");
  assert.ok((longer ?? 0) > 10_000, "the longer answer's 10,000 tokens count");
});
