// The reference loop is held to the real loop's contract: it passes the capstone's conformance suite on every backend,
// ends a run with the same stop reason as the real loop on the cases the suite leaves out, stays short and imports
// nothing but the two packages' public exports.
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import { createModel } from "@buildanagent/gateway";
import {
  type Context,
  type ContinueOptions,
  continueRun,
  createPendingRequest,
  defineTool,
  hmacSigner,
  type Resolution,
  type RunInput,
  type RunOptions,
  type RunResult,
  run,
  type SignedPendingRequest,
} from "@buildanagent/sdk";
import { ScriptedModel, type ScriptStep, testSigner } from "@buildanagent/sdk/testing";
import { describe, test } from "vitest";
import { z } from "zod";
import { SYSTEM_PROMPT, type Triage, triageOptions } from "../examples/triage-agent.js";
import { continueRun as referenceContinue, run as referenceRun } from "../reference-loop/reference-loop.js";
import { drive } from "./run-helpers.js";
import { anthropicBackend, chatBackend, scriptedBackend } from "./triage-backends.js";
import { triageSuite, world } from "./triage-suite.js";

const source = readFileSync(new URL("../reference-loop/reference-loop.ts", import.meta.url), "utf8");

triageSuite({ run: referenceRun, continueRun: referenceContinue }, [scriptedBackend, anthropicBackend, chatBackend]);

/** A string, a template or a comment. Strings and templates are code, so a `//` inside one starts no comment. */
const TOKENS = /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\[\s\S]|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/**
 * The lines a reader counts as code: those holding anything outside a comment. A comment becomes only its line
 * breaks, so a line that starts with `*` or `/*` but holds code still counts. The source has no regex literals.
 */
function codeLines(text: string): number {
  const code = text.replace(TOKENS, (match, quoted?: string) => quoted ?? match.replace(/[^\n]/g, ""));
  return code.split("\n").filter((line) => line.trim() !== "").length;
}

test("the line counter counts code, not comments, and reads strings as code", () => {
  const sample = [
    "// a comment",
    "/* a block",
    " * comment */",
    "",
    'const a = "// not a comment";',
    "const b = `",
    "  /* still a template */`;",
    "  * 2;",
    "/* lead */ const c = 1;",
    "const d = 'it\\'s'; // trailing",
  ].join("\n");
  assert.equal(codeLines(sample), 6);
});

// The cap was 400 until the loop began binding a pause to the run's app data, which takes about ten lines.
test("the reference loop stays under 410 non-blank, non-comment lines", () => {
  const lines = codeLines(source);
  assert.ok(lines < 410, `the reference loop has ${lines} code lines`);
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
  /** The loop's own idGenerator, for a scenario about request ids. */
  readonly idGenerator?: () => () => string;
}

const call = (name: string, input: unknown, callId: string) => ({ type: "tool_call" as const, callId, name, input });
const tokens = { usage: { uncachedInput: 200, output: 50 } };
const lookupStep = (id: string): ScriptStep => ({
  content: [call("lookup_customer", { email: "a@b.c" }, id)],
  ...tokens,
});
// A call to `escalate` with no reason fails its schema, before the gate sees it, so it never pauses the run.
const stuckStep = (id: string): ScriptStep => ({ content: [call("escalate", {}, id)], ...tokens });
const lookup = (id: string) => call("lookup_customer", { email: "a@b.c" }, id);
const answer: ScriptStep = { content: [{ type: "text", text: "Done." }], ...tokens };
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
    name: "a failed model call keeps its status and retry-after hint on the run error",
    steps: [{ content: [], error: { kind: "retryable", message: "rate limited", status: 429, retryAfterMs: 90_000 } }],
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
    name: "a response cut off at the output limit runs none of its calls",
    steps: [{ content: [lookup("c1")], stopReason: "length", ...tokens }, answer],
    stopReason: "done",
  },
  {
    name: "an abort while a gate decides leaves the step's calls unrun",
    steps: [{ content: [lookup("c1"), lookup("c2")], ...tokens }],
    options: (base) => {
      const controller = new AbortController();
      const beforeToolCall = () => {
        controller.abort();
        return { decision: "allow" as const };
      };
      return { ...base, signal: controller.signal, interceptors: { beforeToolCall } };
    },
    stopReason: "aborted",
  },
  {
    name: "a gate that throws denies its call, and the run goes on",
    steps: [lookupStep("c1"), answer],
    options: (base) => ({ ...base, interceptors: { beforeToolCall: () => Promise.reject(new Error("boom")) } }),
    stopReason: "done",
  },
  {
    name: "an afterToolCall that throws withholds the result, and the run goes on",
    steps: [lookupStep("c1"), answer],
    options: (base) => ({
      ...base,
      interceptors: {
        ...base.interceptors,
        afterToolCall: () => {
          throw new Error("boom");
        },
      },
    }),
    stopReason: "done",
  },
  {
    name: "a tool that beforeModelCall's activeTools leaves out can't run",
    steps: [{ content: [call("escalate", { reason: "r" }, "c1")], ...tokens }, answer],
    options: (base) => ({
      ...base,
      interceptors: { ...base.interceptors, beforeModelCall: () => ({ activeTools: ["lookup_customer"] }) },
    }),
    stopReason: "done",
  },
  {
    name: "a hook that throws because of an abort ends aborted",
    steps: [],
    options: (base) => {
      const controller = new AbortController();
      const transformContext = () => {
        controller.abort();
        throw new Error("aborted");
      };
      return { ...base, signal: controller.signal, interceptors: { ...base.interceptors, transformContext } };
    },
    stopReason: "aborted",
  },
  {
    name: "identical failing inputs whose keys come in another order end no_progress",
    steps: [
      { content: [call("escalate", { reason: 1, plan: 2 }, "c1")], ...tokens },
      { content: [call("escalate", { plan: 2, reason: 1 }, "c2")], ...tokens },
      { content: [call("escalate", { reason: 1, plan: 2 }, "c3")], ...tokens },
    ],
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
  const { seen, deps } = world();
  const base = triageOptions(deps(model));
  const options = { ...(scenario.options?.(base) ?? base), system: SYSTEM_PROMPT, input: "Triage it." };
  const { result } = await drive(start(options));
  if (scenario.steps.length > 0) adapter.assertComplete();
  return { ...summary(result), lookups: seen.lookups.length };
}

/** The fields of a result the two loops must agree on, with which tool results were errors. */
function summary(result: RunResult) {
  // An aborted run's transcript differs on purpose: the reference loop doesn't close it with an aborted message.
  const messages = result.stopReason === "aborted" ? undefined : result.messages.length;
  const errors = result.messages.flatMap((message) => (message.role === "tool" ? [message.isError === true] : []));
  // Only the failure's status and hint: an interceptor's error message differs on purpose.
  const { status, retryAfterMs } = result.stopReason === "error" ? result.error : {};
  return { stopReason: result.stopReason, steps: result.steps, messages, errors, status, retryAfterMs };
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

/** Both loops, to run one resume case on each. */
const LOOPS = [
  { name: "real", run, continueRun },
  { name: "reference", run: referenceRun as typeof run, continueRun: referenceContinue as typeof continueRun },
] as const;

/** A scripted model and the triage agent's options over it, plus `extra` options. */
function setup(steps: ScriptStep[], extra: Partial<RunOptions<Triage>> = {}) {
  const adapter = new ScriptedModel(steps, { ref: { provider: "anthropic" } });
  const model = createModel({ adapter, id: "claude-opus-5-5", retries: 0 });
  const { seen, deps } = world();
  return { adapter, seen, options: { ...triageOptions(deps(model)), ...extra } };
}

/** A context whose last response calls `calls` and waits on `pending`, signed or forged. */
function pausedContext(
  calls: ReturnType<typeof call>[],
  pending: SignedPendingRequest[],
  inputs: Record<string, unknown>,
) {
  const messages: Context["messages"] = [
    { role: "user", content: [{ type: "text", text: "Triage it." }] },
    {
      role: "assistant",
      content: calls,
      stopReason: "tool_calls",
      usage: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      cost: { total: 0, basis: "provider", currency: "USD" },
    } as unknown as Context["messages"][number],
  ];
  return { system: SYSTEM_PROMPT, messages, pending, pendingInputs: inputs } satisfies Context;
}

const forged = (id: string, callId: string, tool: string) => ({
  id,
  kind: "approval" as const,
  callId,
  tool,
  inputHash: "0".repeat(64),
  keyId: "test-fixed-key",
  signature: "forged",
  createdAt: "2026-11-20T00:00:00.000Z",
});

describe("the reference loop resumes as the real loop does", () => {
  for (const loop of LOOPS) {
    test(`${loop.name}: a forged request for a tool the model is never sent asks nothing and runs nothing`, async () => {
      const ran: unknown[] = [];
      const hidden = defineTool({
        name: "hidden",
        description: "A tool the model is never sent.",
        inputSchema: { type: "object" },
        exposure: "hidden",
        execute: async (input) => {
          ran.push(input);
          return { content: [{ type: "text", text: "ran" }] };
        },
      });
      const { adapter, options } = setup([answer]);
      const context = pausedContext([call("hidden", { x: 1 }, "c1")], [forged("r1", "c1", "hidden")], { r1: { x: 1 } });
      const tools = [...(options.tools ?? []), hidden];
      const { result } = await drive(loop.continueRun(context, { ...options, tools } as ContinueOptions<Triage>));
      adapter.assertComplete();
      assert.equal(result.stopReason, "done", "no new request is signed for the hidden tool");
      assert.deepEqual(summary(result).errors, [true]);
      assert.deepEqual(ran, []);
    });

    test(`${loop.name}: a request asked again never takes the id of one that still waits`, async () => {
      const { options } = setup([]);
      const signer = testSigner();
      const input = { reason: "r" };
      const held = await createPendingRequest({ kind: "approval", callId: "c1", tool: "escalate", input }, signer, {
        generateId: () => "id-2",
      });
      const calls = [call("escalate", input, "c1"), call("escalate", input, "c2")];
      const context = pausedContext(calls, [held, forged("id-3", "c2", "escalate")], { "id-2": input, "id-3": input });
      const ids = ["run", "id-2"];
      const idGenerator = () => ids.shift() ?? "id-x";
      const { result } = await drive(loop.continueRun(context, { ...options, idGenerator }));
      assert.equal(result.stopReason, "awaiting_approval");
      const pending = (result as Extract<RunResult, { stopReason: "awaiting_approval" }>).pending;
      assert.equal(pending.length, 2);
      assert.notEqual(pending[0]?.id, pending[1]?.id);
    });

    test(`${loop.name}: an approved call runs with exactly the input its request signs`, async () => {
      const inputs: unknown[] = [];
      const charge = defineTool({
        name: "charge",
        description: "Charge an amount.",
        inputSchema: z.object({ amount: z.number().transform((amount) => amount * 100) }),
        execute: async (input) => {
          inputs.push(input);
          return { content: [{ type: "text", text: "charged" }] };
        },
      });
      const gate = { beforeToolCall: () => ({ decision: "ask" as const }) };
      const steps = [{ content: [call("charge", { amount: 10 }, "c1")], ...tokens }, answer];
      const { adapter, options } = setup(steps, { tools: [charge], interceptors: gate, signer: testSigner() });
      const first = await drive(loop.run({ ...options, system: SYSTEM_PROMPT, input: "Charge it." }));
      const { context, pending } = first.result as Extract<RunResult, { stopReason: "awaiting_approval" }>;
      const resolutions: Resolution[] = [{ requestId: pending[0]?.id ?? "", decision: "allow" }];
      const { result } = await drive(loop.continueRun(context, { ...options, resolutions }));
      adapter.assertComplete();
      assert.equal(result.stopReason, "done");
      assert.deepEqual(inputs, [{ amount: 1000 }], "the signed input, converted once, runs as it is");
    });

    test(`${loop.name}: an approved call's start event carries the input that ran`, async () => {
      const charge = defineTool({
        name: "charge",
        description: "Charge an amount.",
        inputSchema: z.object({ amount: z.number().transform((amount) => amount * 100) }),
        execute: async () => ({ content: [{ type: "text", text: "charged" }] }),
      });
      const gate = { beforeToolCall: () => ({ decision: "ask" as const }) };
      const steps = [{ content: [call("charge", { amount: 10 }, "c1")], ...tokens }, answer];
      const { options } = setup(steps, { tools: [charge], interceptors: gate, signer: testSigner() });
      const first = await drive(loop.run({ ...options, system: SYSTEM_PROMPT, input: "Charge it." }));
      const { context, pending } = first.result as Extract<RunResult, { stopReason: "awaiting_approval" }>;
      const resolutions: Resolution[] = [{ requestId: pending[0]?.id ?? "", decision: "allow" }];
      const { events } = await drive(loop.continueRun(context, { ...options, resolutions }));
      const start = events.find((event) => event.type === "tool_call_start");
      assert.deepEqual(start?.type === "tool_call_start" ? start.input : undefined, { amount: 1000 });
    });

    test(`${loop.name}: a tool that redacts its errors keeps the thrown message out of the transcript`, async () => {
      const leaky = defineTool({
        name: "leaky",
        description: "Always fails.",
        inputSchema: z.object({}),
        redactErrors: true,
        execute: async () => {
          throw new Error("connect postgres://user:pw@host failed");
        },
      });
      const steps = [{ content: [call("leaky", {}, "c1")], ...tokens }, answer];
      const { options } = setup(steps, { tools: [leaky] });
      const { result } = await drive(loop.run({ ...options, system: SYSTEM_PROMPT, input: "Go." }));
      assert.doesNotMatch(JSON.stringify(result.messages), /postgres|pw@host/);
    });

    test(`${loop.name}: a run stops listening to the caller's signal when it ends`, async () => {
      const signal = new AbortController().signal;
      const { options } = setup([answer], { signal });
      await drive(loop.run({ ...options, system: SYSTEM_PROMPT, input: "Triage it." }));
      assert.equal(getEventListeners(signal, "abort").length, 0);
    });

    test(`${loop.name}: a request signed under a key the ring has since rotated past still verifies`, async () => {
      const [k1, k2] = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
      const steps = [{ content: [call("escalate", { reason: "r" }, "c1")], ...tokens }, answer];
      const { adapter, seen, options } = setup(steps, { signer: hmacSigner({ keys: { k1 }, current: "k1" }) });
      const first = await drive(loop.run({ ...options, system: SYSTEM_PROMPT, input: "Triage it." }));
      const { context, pending } = first.result as Extract<RunResult, { stopReason: "awaiting_approval" }>;
      const signer = hmacSigner({ keys: { k1, k2 }, current: "k2" });
      const resolutions: Resolution[] = [{ requestId: pending[0]?.id ?? "", decision: "allow" }];
      const { result } = await drive(loop.continueRun(context, { ...options, signer, resolutions }));
      adapter.assertComplete();
      assert.equal(result.stopReason, "done");
      assert.deepEqual(seen.escalations, ["r"]);
    });

    test(`${loop.name}: a gate's replacement input that its tool's schema rejects fails the run`, async () => {
      const gate = { beforeToolCall: () => ({ decision: "allow" as const, input: "not an object" }) };
      const { options } = setup([lookupStep("c1")], { interceptors: gate });
      const started = loop.run({ ...options, system: SYSTEM_PROMPT, input: "Triage it." });
      await assert.rejects(started.result, { code: "invalid_hook_result" });
    });
  }
});
