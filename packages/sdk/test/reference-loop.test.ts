// The reference loop is held to the real loop's contract: it passes the capstone's conformance suite on every backend,
// ends a run with the same stop reason as the real loop on the cases the suite leaves out, stays short and imports
// nothing but the two packages' public exports.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createModel } from "@buildanagent/gateway";
import { type RunInput, type RunOptions, run } from "@buildanagent/sdk";
import { ScriptedModel, type ScriptStep } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { SYSTEM_PROMPT, type Triage, triageOptions } from "../examples/triage-agent.js";
import { continueRun as referenceContinue, run as referenceRun } from "../reference-loop/reference-loop.js";
import { drive } from "./run-helpers.js";
import { anthropicBackend, chatBackend, scriptedBackend } from "./triage-backends.js";
import { triageSuite, world } from "./triage-suite.js";

const source = readFileSync(new URL("../reference-loop/reference-loop.ts", import.meta.url), "utf8");

triageSuite({ run: referenceRun, continueRun: referenceContinue }, [scriptedBackend, anthropicBackend, chatBackend]);

/** The lines a reader counts as code: not blank, and not a comment line. */
function codeLines(text: string): number {
  return text.split("\n").filter((line) => !/^\s*(\/\/|\/\*|\*|$)/.test(line)).length;
}

test("the reference loop stays under 400 non-blank, non-comment lines", () => {
  const lines = codeLines(source);
  assert.ok(lines < 400, `the reference loop has ${lines} code lines`);
});

test("the reference loop imports only the public exports of the gateway and the SDK", () => {
  const specifiers = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), ["@buildanagent/gateway", "@buildanagent/sdk"]);
});

/** One way a run can end, scripted on a model, with the options that make it end that way. */
interface Scenario {
  readonly name: string;
  readonly steps: ScriptStep[];
  readonly options?: (base: RunOptions<Triage>) => RunOptions<Triage>;
  readonly stopReason: string;
}

const call = (name: string, input: unknown, callId: string) => ({ type: "tool_call" as const, callId, name, input });
const tokens = { usage: { uncachedInput: 200, output: 50 } };
const lookupStep = (id: string): ScriptStep => ({
  content: [call("lookup_customer", { email: "a@b.c" }, id)],
  ...tokens,
});
const stuckStep = (id: string): ScriptStep => ({ content: [call("lookup_customer", {}, id)], ...tokens });
const aborted = new AbortController();
aborted.abort();

const SCENARIOS: Scenario[] = [
  {
    name: "a text answer ends done",
    steps: [{ content: [{ type: "text", text: "Nothing to do." }], ...tokens }],
    stopReason: "done",
  },
  {
    name: "the output tool ends done",
    steps: [{ content: [call("submit_triage", { category: "bug", priority: "low", summary: "x" }, "c1")], ...tokens }],
    stopReason: "done",
  },
  {
    name: "the step cap ends max_steps",
    steps: [lookupStep("c1"), lookupStep("c2")],
    options: (base) => ({ ...base, maxSteps: 2 }),
    stopReason: "max_steps",
  },
  {
    name: "a call that would pass the budget ends budget",
    steps: [],
    options: (base) => ({ ...base, budgetUsd: 0 }),
    stopReason: "budget",
  },
  {
    name: "a failed model call ends error",
    steps: [{ content: [], error: { kind: "fatal", message: "rejected" } }],
    stopReason: "error",
  },
  {
    name: "an interceptor that throws ends error",
    steps: [],
    options: (base) => ({
      ...base,
      interceptors: {
        beforeModelCall: () => {
          throw new Error("boom");
        },
      },
    }),
    stopReason: "error",
  },
  {
    name: "an aborted signal ends aborted",
    steps: [],
    options: (base) => ({ ...base, signal: aborted.signal }),
    stopReason: "aborted",
  },
  {
    name: "shouldStop ends stopped",
    steps: [lookupStep("c1")],
    options: (base) => ({ ...base, interceptors: { ...base.interceptors, shouldStop: () => true } }),
    stopReason: "stopped",
  },
  {
    name: "three identical failing calls end no_progress",
    steps: [stuckStep("c1"), stuckStep("c2"), stuckStep("c3")],
    stopReason: "no_progress",
  },
  {
    name: "a gate that asks ends awaiting_approval",
    steps: [{ content: [call("escalate", { reason: "r" }, "c1")], ...tokens }],
    stopReason: "awaiting_approval",
  },
];

/** Runs `scenario` on one loop and returns the fields the two loops must agree on. */
async function outcomeOf(
  start: (options: RunOptions<Triage> & RunInput) => ReturnType<typeof run<Triage>>,
  scenario: Scenario,
) {
  const adapter = new ScriptedModel(scenario.steps, { ref: { provider: "anthropic" } });
  const model = createModel({ adapter, id: "claude-opus-5-5", retries: 0 });
  const base = triageOptions(world().deps(model));
  const options = { ...(scenario.options?.(base) ?? base), system: SYSTEM_PROMPT, input: "Triage it." };
  const { result } = await drive(start(options));
  if (scenario.steps.length > 0) adapter.assertComplete();
  // An aborted run's transcript differs on purpose: the reference loop doesn't close it with an aborted message.
  const messages = result.stopReason === "aborted" ? undefined : result.messages.length;
  return { stopReason: result.stopReason, steps: result.steps, messages };
}

describe("the reference loop ends each run with the real loop's stop reason", () => {
  for (const scenario of SCENARIOS) {
    test(scenario.name, async () => {
      const real = await outcomeOf(run, scenario);
      assert.equal(real.stopReason, scenario.stopReason, "the scenario really ends that way on the real loop");
      assert.deepEqual(await outcomeOf(referenceRun as typeof run, scenario), real);
    });
  }
});
