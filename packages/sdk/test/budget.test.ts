// The pre-emptive USD budget (D9): the loop projects each call's cost with the gateway's projectCallCost() and ends the
// run `budget` before a call that could pass the cap.
import assert from "node:assert/strict";
import {
  createModel,
  projectCallCost as gatewayProjectCallCost,
  type Model,
  type PriceCatalog,
} from "@buildanagent/gateway";
import {
  type AgentEvent,
  type CallOptions,
  type Interceptors,
  isSdkError,
  projectCallCost,
  type RunResult,
  run,
} from "@buildanagent/sdk";
import { ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
import { expect, test } from "vitest";
import { determinism, drive, lookup, scripted, text, toolCall } from "./run-helpers.js";

const SYSTEM = "You look up orders.";
const STEPS = 30;
// Dollars per million tokens, and the output limit the projection prices every call at.
const INPUT_RATE = 3;
const OUTPUT_RATE = 15;
const OUTPUT_LIMIT = 4000;

const SOURCE = "https://provider.test/pricing";
const CATALOG: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: "priced",
      rates: [
        {
          uncachedInput: INPUT_RATE,
          cacheRead: 0,
          cacheWrite: { "5m": 0, "1h": 0 },
          output: OUTPUT_RATE,
          upToInputTokens: null,
        },
      ],
      contextWindow: 200_000,
      maxOutputTokens: OUTPUT_LIMIT,
      asOf: "2026-11-01",
      sources: { rates: SOURCE, contextWindow: SOURCE, maxOutputTokens: SOURCE },
    },
  ],
};

/** A priced model over `steps`, and its adapter. */
function priced(steps: ScriptStep[]): { adapter: ScriptedModel; model: Model } {
  const adapter = new ScriptedModel(steps);
  return { adapter, model: createModel({ adapter, id: "priced", catalog: CATALOG, retries: 0 }) };
}

/** A 30-call script: 29 lookups whose input grows by 100 tokens a call, then a text answer. */
function longScript(): ScriptStep[] {
  const steps: ScriptStep[] = [];
  for (let i = 0; i < STEPS - 1; i++) {
    steps.push({ ...toolCall("lookup", { order: i }), usage: { uncachedInput: 1000 + 100 * i, output: 200 } });
  }
  steps.push({ ...text("All shipped."), usage: { uncachedInput: 1000 + 100 * (STEPS - 1), output: 200 } });
  return steps;
}

function start(model: Model, extra: { budgetUsd?: number; interceptors?: Interceptors } = {}) {
  return run({ model, system: SYSTEM, input: "Go.", tools: [lookup], maxSteps: STEPS, ...determinism(), ...extra });
}

/** What each call cost and what the loop projected for it, read from an unbudgeted run's events. */
interface CallRecord {
  readonly actual: number;
  readonly projected: number;
}

async function recordCalls(model: Model, events: readonly AgentEvent[]): Promise<CallRecord[]> {
  const records: CallRecord[] = [];
  let projected = 0;
  for (const event of events) {
    if (event.type === "model_call_start") {
      projected = projectCallCost(model, event.request.context, event.request.options).total ?? Number.NaN;
    }
    if (event.type === "model_call_end") records.push({ actual: event.message.cost.total ?? Number.NaN, projected });
  }
  return records;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** How many calls the pre-emptive rule lets through under `budgetUsd`: it sends call n + 1 while spend + projection fit. */
function affordableCalls(calls: readonly CallRecord[], budgetUsd: number): number {
  let spent = 0;
  for (const [n, call] of calls.entries()) {
    if (spent + call.projected > budgetUsd) return n;
    spent += call.actual;
  }
  return calls.length;
}

/** The after-the-fact check Claude's `maxBudgetUsd` and mini-swe-agent use: stop once a response has crossed the cap. */
function postResponseCheck(budgetUsd: number): Interceptors {
  return {
    shouldStop: (e) => {
      const spent = sum(e.messages.flatMap((m) => (m.role === "assistant" ? [m.cost.total ?? 0] : [])));
      return spent >= budgetUsd ? { stop: "hook", reason: "budget crossed" } : false;
    },
  };
}

function spentBy(result: RunResult): number {
  return result.cost.total ?? Number.NaN;
}

test("a run whose next call would cross the cap ends budget before that call", async () => {
  const baseline = priced(longScript());
  const baselineRun = await drive(start(baseline.model));
  const calls = await recordCalls(baseline.model, baselineRun.events);
  assert.equal(calls.length, STEPS);

  // The cap sits a nano-dollar under what ten calls plus the eleventh's projection would cost, so ten calls fit and the
  // eleventh can't be afforded.
  const budgetUsd = sum(calls.slice(0, 10).map((c) => c.actual)) + (calls[10]?.projected ?? 0) - 1e-9;
  assert.equal(affordableCalls(calls, budgetUsd), 10);
  const { adapter, model } = priced(longScript());
  const { events, result } = await drive(start(model, { budgetUsd }));

  assert.equal(result.stopReason, "budget");
  if (result.stopReason !== "budget") return;
  assert.equal(result.steps, 10);
  assert.equal(adapter.calls.length, 10, "the scripted model saw no call past the tenth");
  assert.equal(result.budgetUsd, budgetUsd);
  assert.ok(result.spentUsd <= budgetUsd);
  assert.ok(result.spentUsd + result.projectedUsd > budgetUsd);
  assert.match(result.reason, /passes the budget/);
  // The amounts in the reason are rounded, so float noise from summing costs doesn't reach the message.
  assert.doesNotMatch(result.reason, /\d{8,}/);
  assert.equal(events.filter((e) => e.type === "model_call_start").length, 10);
  assert.equal(events.at(-1)?.type, "run_end");
});

test("a budget of zero ends the run before its first call", async () => {
  const { adapter, model } = priced([text("never sent")]);
  const { result } = await drive(start(model, { budgetUsd: 0 }));
  assert.equal(result.stopReason, "budget");
  assert.equal(result.steps, 0);
  assert.equal(adapter.calls.length, 0);
});

test("a run that stays under the cap finishes, and the cap changes nothing about it", async () => {
  const { model } = priced(longScript());
  const { result } = await drive(start(model, { budgetUsd: 100 }));
  assert.equal(result.stopReason, "done");
  assert.equal(result.steps, STEPS);
});

test("a budgeted run on an unknown-price model ends error with unknown_price before any call", async () => {
  const { adapter, model } = scripted([text("never sent")]);
  const { events, result } = await drive(start(model, { budgetUsd: 1 }));
  assert.equal(result.stopReason, "error");
  if (result.stopReason !== "error") return;
  assert.equal(result.error.kind, "unknown_price");
  assert.match(result.error.message, /scripted\/scripted-model/);
  assert.equal(result.steps, 0);
  assert.equal(adapter.calls.length, 0);
  assert.ok(events.some((e) => e.type === "error"));
  assert.equal(events.at(-1)?.type, "run_end");
});

test("the same unknown-price model runs without a budget", async () => {
  const { model } = scripted([text("Hi.")]);
  const { result } = await drive(start(model));
  assert.equal(result.stopReason, "done");
});

test("a call whose cost comes back unknown ends the budgeted run before the next call", async () => {
  // The first response reports no usage, so the spend is unknown; the run won't guess it is zero.
  const { adapter, model } = priced([toolCall("lookup", { order: 1 }), text("never sent")]);
  const { result } = await drive(start(model, { budgetUsd: 100 }));
  assert.equal(result.stopReason, "error");
  if (result.stopReason !== "error") return;
  assert.equal(result.error.kind, "unknown_price");
  assert.equal(result.steps, 1);
  assert.equal(adapter.calls.length, 1);
});

test("the SDK's projectCallCost is the gateway's, and the loop's check uses the same projection", async () => {
  assert.equal(projectCallCost, gatewayProjectCallCost);
  const { model } = priced(longScript());
  let seen: { context: Parameters<typeof projectCallCost>[1]; options: CallOptions } | undefined;
  const interceptors: Interceptors = {
    beforeModelCall: (e) => {
      seen = { context: e.context, options: e.options };
      return undefined;
    },
  };
  const { result } = await drive(start(model, { budgetUsd: 0.02, interceptors }));
  assert.equal(result.stopReason, "budget");
  if (result.stopReason !== "budget" || seen === undefined) return;
  const projection = projectCallCost(model, seen.context, seen.options);
  assert.equal(result.projectedUsd, projection.total);
  assert.ok(result.projectedUsd > 0);
});

test("a budget that isn't a finite non-negative number is refused when the run starts", () => {
  const { model } = priced([text("x")]);
  for (const budgetUsd of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => start(model, { budgetUsd }),
      (error) => isSdkError(error) && error.code === "invalid_run_options",
    );
  }
});

test("overshoot on a scripted 30-step run: the pre-emptive check stays under the cap, a post-response check crosses it", async () => {
  const baseline = priced(longScript());
  const baselineRun = await drive(start(baseline.model));
  const calls = await recordCalls(baseline.model, baselineRun.events);
  const spentAfter = (n: number) => sum(calls.slice(0, n).map((c) => c.actual));
  // One call's projection error: how far the loop's projection ran above the call's actual cost.
  const projectionError = Math.max(...calls.map((c) => c.projected - c.actual));
  expect(projectionError).toBeGreaterThan(0);
  for (const call of calls) assert.ok(call.projected >= call.actual, "the projection never undershoots a call");

  const pre = { overshoot: [] as number[], calls: [] as number[], unused: [] as number[] };
  const post = { overshoot: [] as number[], calls: [] as number[] };
  const crossing: number[] = [];
  // A cap just above the spend after k calls: a post-response check has not crossed it yet, so it sends call k + 1, and
  // that call alone crosses. The pre-emptive check refuses a call as soon as its projection might cross.
  for (let k = 1; k < STEPS; k++) {
    const budgetUsd = spentAfter(k) + 1e-9;
    const pr = await drive(start(priced(longScript()).model, { budgetUsd }));
    const po = await drive(start(priced(longScript()).model, { interceptors: postResponseCheck(budgetUsd) }));
    assert.equal(pr.result.stopReason, "budget");
    assert.equal(
      pr.result.steps,
      affordableCalls(calls, budgetUsd),
      "the pre-emptive check sent each call it could afford",
    );
    assert.equal(po.result.steps, k + 1, "the post-response check let call k + 1 go out");
    pre.overshoot.push(Math.max(0, spentBy(pr.result) - budgetUsd));
    pre.calls.push(pr.result.steps);
    pre.unused.push(budgetUsd - spentBy(pr.result));
    post.overshoot.push(Math.max(0, spentBy(po.result) - budgetUsd));
    post.calls.push(po.result.steps);
    crossing.push(calls[k]?.actual ?? Number.NaN);
  }
  const dollars = (value: number) => `$${value.toFixed(6)}`;
  const mean = (values: readonly number[]) => sum(values) / values.length;
  console.info(
    [
      `overshoot over ${STEPS - 1} caps on a ${STEPS}-step scripted run (cap k = spend after k calls + $0.000000001):`,
      `  pre-emptive:   overshoot mean ${dollars(mean(pre.overshoot))}, worst ${dollars(Math.max(...pre.overshoot))}; ` +
        `mean ${mean(pre.calls).toFixed(1)} calls sent; mean cap left unspent ${dollars(mean(pre.unused))}`,
      `  post-response: overshoot mean ${dollars(mean(post.overshoot))}, worst ${dollars(Math.max(...post.overshoot))}; ` +
        `mean ${mean(post.calls).toFixed(1)} calls sent`,
      `  one call's projection error (worst): ${dollars(projectionError)}; mean cost of the crossing call: ${dollars(mean(crossing))}`,
    ].join("\n"),
  );

  // With the pre-emptive check the overshoot is at most one call's projection error; the projection never undershoots
  // here, so the run never passes the cap at all.
  for (const value of pre.overshoot) assert.ok(value <= projectionError);
  assert.equal(Math.max(...pre.overshoot), 0);
  // The post-response check overshoots by the whole call that crosses the cap, less the nano-dollar of headroom.
  post.overshoot.forEach((value, i) => {
    assert.ok(value >= (crossing[i] ?? Number.NaN) - 1e-8, `call ${i + 2} overshoots by nearly its whole cost`);
  });
});
