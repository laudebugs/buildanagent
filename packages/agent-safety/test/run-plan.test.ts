import assert from "node:assert/strict";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import {
  type EffectRecord,
  type EffectStore,
  isSafetyError,
  memoryEffectStore,
  memoryPlanLedger,
  type PlanApproval,
  type PlanFields,
  type PlanLedger,
  type PlanOutcome,
  type PlanStepImpl,
  planWriteOutcome,
  renderPlanOutcome,
  runPlan,
  type StateRead,
  signPlan,
  type WriteOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";
import { toAiToolResult } from "@buildanagent/agent-safety/ai";
import { testSigner } from "@buildanagent/agent-safety/testing";
import { generateText, isStepCount, jsonSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, test } from "vitest";

// E4b: `runPlan()` runs a signed plan in order through guarded writes, compensates before the pivot, runs forward after
// it, and reports an outcome the harness computes. Every system here is a fake that counts the requests it receives by
// key, so "no step repeated" means no key was sent twice.
const APPROVED_AT = new Date("2026-11-20T12:00:00.000Z");
const SCOPE = { tenant: "user-1", session: "session-1", branch: "main" };
const STATE = [{ source: "orders", key: "order:4417:refundable_cents", value: 2500 }] as const;

/** a, b and c are compensable, p is the pivot, and r and s run after it. */
const FIELDS: PlanFields = {
  steps: ["a", "b", "c"]
    .map((id) => ({
      id,
      tool: `do_${id}`,
      class: "compensable" as const,
      input: { id },
      businessKey: `biz:${id}`,
      summary: `Do ${id}`,
    }))
    .concat([
      { id: "p", tool: "do_p", class: "pivot" as never, input: { id: "p" }, businessKey: "biz:p", summary: "Do p" },
    ])
    .concat(
      ["r", "s"].map((id) => ({
        id,
        tool: `do_${id}`,
        class: "retryable" as never,
        input: { id },
        businessKey: `biz:${id}`,
        summary: `Do ${id}`,
      })),
    ),
  state: [...STATE],
  expiresInMs: 15 * 60 * 1000,
};

const applied = (operation: string) => writeOutcome({ kind: "applied", operation, next: "Carry on." });
const notApplied = (operation: string) =>
  writeOutcome({ kind: "not_applied", operation, retry: "never", reason: "REJECTED", next: "Stop." });

type Behaviour = (key: string) => Promise<WriteOutcome>;

/** The fake system of record: it counts requests by key, and a test sets what a step or an undo answers. */
function fake() {
  const requests: { op: string; key: string }[] = [];
  const answers = new Map<string, Behaviour>();
  // The plan lists the first value only. The second, such as an order's balance, is one its arguments came from.
  const state: unknown[] = [...STATE.map((entry) => entry.value), 2500];
  const reconcile = new Map<string, () => Promise<WriteOutcome | "not_found">>();
  const impl = (field: (typeof FIELDS.steps)[number], signed: PlanApproval["steps"][number]): PlanStepImpl => {
    const base = { step: signed, input: field.input, dedupe: "idempotency_key" as const };
    const reconcileFor = (op: string) =>
      reconcile.has(op)
        ? { reconcile: async () => (reconcile.get(op) as () => Promise<WriteOutcome | "not_found">)() }
        : {};
    return {
      ...base,
      ...reconcileFor(field.id),
      async run(key) {
        requests.push({ op: field.id, key });
        return (answers.get(field.id) ?? (async () => applied(field.tool)))(key);
      },
      ...(field.class === "compensable"
        ? {
            async compensate(key: string) {
              requests.push({ op: `undo_${field.id}`, key });
              return (answers.get(`undo_${field.id}`) ?? (async () => applied(`undo_${field.id}`)))(key);
            },
            ...(reconcile.has(`undo_${field.id}`)
              ? {
                  reconcileCompensation: async () =>
                    (reconcile.get(`undo_${field.id}`) as () => Promise<WriteOutcome | "not_found">)(),
                }
              : {}),
          }
        : {}),
    };
  };
  return {
    requests,
    state,
    answer: (op: string, behaviour: Behaviour) => answers.set(op, behaviour),
    reconcile: (op: string, find: () => Promise<WriteOutcome | "not_found">) => reconcile.set(op, find),
    ops: () => requests.map((request) => request.op),
    keysSent: () => requests.map((request) => request.key),
    steps: (approval: PlanApproval) => FIELDS.steps.map((field, index) => impl(field, approval.steps[index] as never)),
    readState: async (reads: readonly StateRead[]) => reads.map((_, index) => state[index]),
  };
}

async function setup(overrides: { store?: EffectStore; ledger?: PlanLedger } = {}) {
  const system = fake();
  const signer = testSigner();
  const approval = await signPlan(FIELDS, signer, { generateId: () => "plan_1", now: () => APPROVED_AT });
  const store = overrides.store ?? memoryEffectStore();
  const ledger = overrides.ledger ?? memoryPlanLedger();
  const clock = { at: APPROVED_AT.getTime() + 60_000 };
  const run = (extra: { signal?: AbortSignal; steps?: PlanStepImpl[]; approval?: unknown; store?: EffectStore } = {}) =>
    runPlan({
      approval: extra.approval ?? approval,
      steps: extra.steps ?? system.steps(approval),
      store: extra.store ?? store,
      scope: SCOPE,
      signer,
      ledger,
      readState: system.readState,
      now: () => new Date(clock.at),
      ...(extra.signal === undefined ? {} : { signal: extra.signal }),
    });
  return { system, approval, store, ledger, run, clock, signer };
}

function assertSafetyError(code: string) {
  return (error: unknown) => {
    assert.ok(isSafetyError(error), `expected a SafetyError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  };
}

type NotRun = Extract<PlanOutcome, { status: "stale_approval" | "expired" | "rejected" }>;
type Ran = Exclude<PlanOutcome["status"], NotRun["status"]>;

/** Asserts a plan outcome's status and narrows it to that status's shape. */
function status(outcome: PlanOutcome, expected: NotRun["status"]): NotRun;
function status<S extends Ran>(outcome: PlanOutcome, expected: S): Extract<PlanOutcome, { status: S }>;
function status(outcome: PlanOutcome, expected: PlanOutcome["status"]): PlanOutcome {
  assert.equal(outcome.status, expected, JSON.stringify(outcome));
  return outcome;
}

test("a plan whose steps all apply runs them in order and completes", async () => {
  const { system, run } = await setup();
  const outcome = status(await run(), "completed");
  assert.deepEqual(system.ops(), ["a", "b", "c", "p", "r", "s"]);
  assert.deepEqual(outcome.effects, ["a: Do a", "b: Do b", "c: Do c", "p: Do p", "r: Do r", "s: Do s"]);
  assert.equal(new Set(system.keysSent()).size, 6, "each step sent its own key");
});

test("a failure in a compensable step undoes the earlier steps in reverse order, and never runs the pivot", async () => {
  const { system, run } = await setup();
  system.answer("c", async () => notApplied("do_c"));
  const outcome = status(await run(), "failed_compensated");
  assert.equal(outcome.failedStep, "c");
  assert.equal(outcome.reason, "STEP_FAILED");
  assert.deepEqual(outcome.undone, ["b: Do b", "a: Do a"]);
  assert.deepEqual(system.ops(), ["a", "b", "c", "undo_b", "undo_a"], "no pivot and no later step ran");
});

test("a compensation that fails stops the unwind and returns failed_needs_human with that effect outstanding", async () => {
  const { system, run } = await setup();
  system.answer("c", async () => notApplied("do_c"));
  system.answer("undo_b", async () => notApplied("undo_b"));
  const outcome = status(await run(), "failed_needs_human");
  assert.equal(outcome.reason, "COMPENSATION_FAILED");
  assert.deepEqual(outcome.outstanding, ["b: Do b", "a: Do a"]);
  assert.deepEqual(outcome.undone, []);
  assert.deepEqual(system.ops(), ["a", "b", "c", "undo_b"], "a was not undone, because b still holds");
  assert.match(outcome.avoid, /do not undo anything yourself/i);
});

test("a pivot that times out returns pending with pivot_unknown, and nothing is undone or sent under a new key", async () => {
  const { system, run } = await setup();
  system.answer("p", async () => {
    throw new Error("timeout");
  });
  const outcome = status(await run(), "pending");
  assert.equal(outcome.phase, "pivot_unknown");
  assert.equal(outcome.stepId, "p");
  assert.deepEqual(system.ops(), ["a", "b", "c", "p"], "no compensation ran and no later step ran");
});

test("a later run reconciles the unknown pivot, and a pivot that took effect is not sent again", async () => {
  const { system, run } = await setup();
  let calls = 0;
  system.answer("p", async () => {
    calls++;
    throw new Error("timeout");
  });
  system.reconcile("p", async () => applied("do_p"));
  status(await run(), "pending");
  // The pivot is reconciled on the next call; its record shows the timeout, and the plan carries on forward.
  const outcome = status(await run(), "completed");
  assert.equal(calls, 1, "the pivot was sent once");
  assert.deepEqual(system.ops(), ["a", "b", "c", "p", "r", "s"]);
  assert.equal(outcome.effects.length, 6);
});

test("a pivot that rejects the call is undone like any failed step, but one that left effects is handed to a person", async () => {
  const rejected = await setup();
  rejected.system.answer("p", async () => notApplied("do_p"));
  const clean = status(await rejected.run(), "failed_compensated");
  assert.equal(clean.failedStep, "p");
  assert.deepEqual(rejected.system.ops(), ["a", "b", "c", "p", "undo_c", "undo_b", "undo_a"]);

  const partial = await setup();
  partial.system.answer("p", async () =>
    writeOutcome({
      kind: "partial",
      operation: "do_p",
      retry: "never",
      applied: ["half the refund"],
      next: "Ask a person.",
    }),
  );
  const handed = status(await partial.run(), "failed_needs_human");
  assert.equal(handed.reason, "STEP_PARTIAL");
  assert.deepEqual(partial.system.ops(), ["a", "b", "c", "p"], "nothing is undone around a pivot that left effects");
  assert.deepEqual(handed.outstanding, ["p: Do p (may have taken effect)", "c: Do c", "b: Do b", "a: Do a"]);
});

test("a step that fails after the pivot is retried while it may succeed, and handed over when it cannot", async () => {
  const retrying = await setup();
  retrying.system.answer("r", async () =>
    writeOutcome({ kind: "not_applied", operation: "do_r", retry: "same_key", next: "Retry." }),
  );
  const waiting = status(await retrying.run(), "pending");
  assert.deepEqual([waiting.phase, waiting.stepId], ["running", "r"]);
  assert.ok(!retrying.system.ops().some((op) => op.startsWith("undo")), "the pivot is never undone");

  const refused = await setup();
  refused.system.answer("r", async () => notApplied("do_r"));
  const handed = status(await refused.run(), "failed_needs_human");
  assert.equal(handed.reason, "RETRY_REFUSED");
  assert.deepEqual(handed.outstanding, ["r: Do r (not run)", "s: Do s (not run)"]);
  assert.deepEqual(refused.system.ops(), ["a", "b", "c", "p", "r"]);
});

/** A durable store that throws once a chosen call is reached, as a process that dies there would. */
function crashingStore(inner: EffectStore, when: (call: "begin" | "settle", record: EffectRecord) => boolean) {
  let armed = true;
  const crash = () => {
    armed = false;
    return new Error("process crashed");
  };
  const store: EffectStore = {
    begin: async (record) => {
      if (armed && when("begin", record)) throw crash();
      return inner.begin(record);
    },
    takeOver: (record) => inner.takeOver(record),
    settle: async (record) => {
      if (armed && when("settle", record)) throw crash();
      return inner.settle(record);
    },
    get: (key) => inner.get(key),
  };
  return store;
}

test("a crash after step 2 of 3, resumed in a new process, repeats no step and finishes the plan", async () => {
  const durable = memoryEffectStore();
  const first = await setup({ store: durable });
  // The process dies as it records step c's write, after steps a and b settled.
  const dying = crashingStore(durable, (call, record) => call === "begin" && record.scope.toolCallId === "plan_1:c");
  await assert.rejects(first.run({ store: dying }), /process crashed/);
  assert.deepEqual(first.system.ops(), ["a", "b"]);

  // A new process: a new fake system object would hold no counts, so this one shares the first's, as an API would.
  const outcome = status(await first.run(), "completed");
  assert.equal(outcome.effects.length, 6);
  assert.deepEqual(first.system.ops(), ["a", "b", "c", "p", "r", "s"], "a and b were not sent again");
  assert.equal(new Set(first.system.keysSent()).size, first.system.keysSent().length, "no key was sent twice");
});

test("a crash while undoing resumes the unwind without undoing any step twice or retrying the failed step", async () => {
  const durable = memoryEffectStore();
  const first = await setup({ store: durable });
  first.system.answer("c", async () => notApplied("do_c"));
  const dying = crashingStore(
    durable,
    (call, record) => call === "begin" && record.scope.toolCallId === "plan_1:a:compensate",
  );
  await assert.rejects(first.run({ store: dying }), /process crashed/);
  assert.deepEqual(first.system.ops(), ["a", "b", "c", "undo_b"]);

  // Even if c would apply now, the plan decided to unwind, so c is not tried again.
  first.system.answer("c", async () => applied("do_c"));
  const outcome = status(await first.run(), "failed_compensated");
  assert.deepEqual(outcome.undone, ["b: Do b", "a: Do a"]);
  assert.deepEqual(first.system.ops(), ["a", "b", "c", "undo_b", "undo_a"]);
});

test("a compensation that crashed before it settled is checked by its reconcile hook, not sent blind", async () => {
  const durable = memoryEffectStore();
  const first = await setup({ store: durable });
  first.system.answer("c", async () => notApplied("do_c"));
  first.system.reconcile("undo_b", async () => applied("undo_b"));
  const dying = crashingStore(
    durable,
    (call, record) => call === "settle" && record.scope.toolCallId === "plan_1:b:compensate",
  );
  await assert.rejects(first.run({ store: dying }), /process crashed/);
  // The undo of b was sent, and its record is still started. Its lease must lapse before another process takes over.
  first.clock.at += 10 * 60 * 1000;
  const outcome = status(await first.run(), "failed_compensated");
  assert.deepEqual(outcome.undone, ["b: Do b", "a: Do a"]);
  assert.equal(first.system.ops().filter((op) => op === "undo_b").length, 1, "the undo of b was not sent twice");
});

test("a stale approval found before step 1 runs nothing and returns stale_approval", async () => {
  const { system, run } = await setup();
  system.state[0] = 0;
  const outcome = status(await run(), "stale_approval");
  assert.match(outcome.reason, /changed/);
  assert.deepEqual(system.ops(), []);
});

test("a stale approval found after step 1 and before the pivot undoes step 1, and the pivot never runs", async () => {
  const { system, run } = await setup();
  system.answer("a", async () => {
    // Step a's own effect changes a value that the plan was computed from.
    system.state[0] = 0;
    return applied("do_a");
  });
  const outcome = status(await run(), "failed_compensated");
  assert.equal(outcome.reason, "STALE_APPROVAL");
  assert.equal(outcome.failedStep, "b");
  assert.deepEqual(outcome.undone, ["a: Do a"]);
  assert.deepEqual(system.ops(), ["a", "undo_a"]);
});

test("an approval that lapses before step 1 returns expired, and one that lapses mid-plan undoes what ran", async () => {
  const early = await setup();
  early.clock.at = APPROVED_AT.getTime() + 16 * 60 * 1000;
  status(await early.run(), "expired");
  assert.deepEqual(early.system.ops(), []);

  const mid = await setup();
  mid.system.answer("a", async () => {
    mid.clock.at += 20 * 60 * 1000;
    return applied("do_a");
  });
  const outcome = status(await mid.run(), "failed_compensated");
  assert.equal(outcome.reason, "EXPIRED");
  assert.deepEqual(mid.system.ops(), ["a", "undo_a"]);
});

test("a cancel before the pivot undoes the steps that ran, and a cancel after the pivot is ignored", async () => {
  const early = await setup();
  const controller = new AbortController();
  early.system.answer("b", async () => {
    controller.abort();
    return applied("do_b");
  });
  const cancelled = status(await early.run({ signal: controller.signal }), "failed_compensated");
  assert.equal(cancelled.reason, "CANCELLED");
  assert.equal(cancelled.failedStep, "c");
  assert.deepEqual(early.system.ops(), ["a", "b", "undo_b", "undo_a"]);

  const late = await setup();
  const after = new AbortController();
  late.system.answer("p", async () => {
    after.abort();
    return applied("do_p");
  });
  status(await late.run({ signal: after.signal }), "completed");
  assert.deepEqual(late.system.ops(), ["a", "b", "c", "p", "r", "s"], "the plan ran forward past the cancel");
});

test("a value the plan's state leaves out is a known miss: a change to it is not caught, and the plan completes", async () => {
  const { system, approval, run } = await setup();
  assert.equal(approval.stateReads.length, 1, "the plan lists one value");
  system.answer("a", async () => {
    system.state[1] = 0;
    return applied("do_a");
  });
  status(await run(), "completed");
  assert.equal(system.state[1], 0, "the unlisted value changed, and nothing in the plan or the approval saw it");
  // The same change to the listed value is caught, so the miss is the omission and not the check.
  const listed = await setup();
  listed.system.answer("a", async () => {
    listed.system.state[0] = 0;
    return applied("do_a");
  });
  assert.equal(status(await listed.run(), "failed_compensated").reason, "STALE_APPROVAL");
});

test("a step after the pivot that the approval refuses is handed over, and the pivot is never undone", async () => {
  const { system, approval, run } = await setup();
  const steps = system.steps(approval);
  steps[4] = { ...(steps[4] as PlanStepImpl), input: { id: "r", extra: true } };
  const outcome = status(await run({ steps }), "failed_needs_human");
  assert.equal(outcome.reason, "NOT_VERIFIED");
  assert.deepEqual(outcome.held, ["a: Do a", "b: Do b", "c: Do c", "p: Do p"]);
  assert.deepEqual(outcome.outstanding, ["r: Do r (not run)", "s: Do s (not run)"]);
  assert.deepEqual(system.ops(), ["a", "b", "c", "p"], "nothing was undone and no step after the pivot ran");
  const read = planWriteOutcome(outcome);
  assert.deepEqual(read.applied, outcome.held, "the model reads the steps that still hold as applied");
});

test("a step after the pivot that times out is pending, and the next call reconciles it", async () => {
  const { system, run } = await setup();
  system.answer("r", async () => {
    throw new Error("timeout");
  });
  system.reconcile("r", async () => applied("do_r"));
  const waiting = status(await run(), "pending");
  assert.deepEqual([waiting.phase, waiting.stepId], ["running", "r"]);
  status(await run(), "completed");
  assert.deepEqual(system.ops(), ["a", "b", "c", "p", "r", "s"], "r was sent once");
});

test("a compensation that another process is still running makes the plan pending, not failed", async () => {
  const { system, run } = await setup();
  system.answer("c", async () => notApplied("do_c"));
  system.answer("undo_b", async () =>
    writeOutcome({
      kind: "unknown",
      operation: "undo_b",
      reason: "IN_PROGRESS",
      retry: "same_key",
      effectKey: "k",
      next: "Wait.",
    }),
  );
  const waiting = status(await run(), "pending");
  assert.deepEqual([waiting.phase, waiting.stepId], ["running", "b"]);
});

test("a plan undoes only the steps it ran: one that another plan applied under the same business key is left alone", async () => {
  const first = await setup();
  status(await first.run(), "completed");
  // A second plan shares every business key but b's, so a, c and the rest return the first plan's stored outcomes.
  const fields: PlanFields = {
    ...FIELDS,
    steps: FIELDS.steps.map((step) => (step.id === "b" ? { ...step, businessKey: "biz:b2" } : step)),
  };
  const second = await signPlan(fields, first.signer, { generateId: () => "plan_2", now: () => APPROVED_AT });
  first.system.answer("b", async () => notApplied("do_b"));
  const outcome = status(
    await first.run({ approval: second, steps: first.system.steps(second) }),
    "failed_compensated",
  );
  assert.equal(outcome.failedStep, "b");
  assert.deepEqual(outcome.undone, [], "a was applied by the first plan, so the second does not undo it");
  assert.ok(!first.system.ops().includes("undo_a"));
});

test("a forged approval, or a step whose input differs from the signed one, runs nothing", async () => {
  const { system, approval, run } = await setup();
  const forged = { ...approval, expiresAt: "2099-01-01T00:00:00.000Z" };
  const refusedForgery = status(await run({ approval: forged }), "rejected");
  assert.equal(refusedForgery.planId, "unknown");
  const steps = system.steps(approval);
  steps[0] = { ...(steps[0] as PlanStepImpl), input: { id: "a", extra: true } };
  const refusedInput = status(await run({ steps }), "rejected");
  assert.match(refusedInput.reason, /tampered/);
  assert.deepEqual(system.ops(), []);
});

test("steps that are not the signed ones, or a compensable step with no compensate, are refused as invalid_plan", async () => {
  const { system, approval, run } = await setup();
  await assert.rejects(run({ steps: system.steps(approval).slice(1) }), assertSafetyError("invalid_plan"));
  const swapped = system.steps(approval);
  swapped[0] = { ...(swapped[0] as PlanStepImpl), step: { ...(swapped[0] as PlanStepImpl).step, id: "z" } };
  await assert.rejects(run({ steps: swapped }), assertSafetyError("invalid_plan"));
  const bare = system.steps(approval).map((impl, index) => {
    const { compensate: _drop, ...rest } = impl;
    return index === 0 ? (rest as PlanStepImpl) : impl;
  });
  await assert.rejects(run({ steps: bare }), assertSafetyError("invalid_plan"));
  const undoable = system.steps(approval);
  undoable[3] = { ...(undoable[3] as PlanStepImpl), compensate: async () => applied("undo_p") };
  await assert.rejects(run({ steps: undoable }), assertSafetyError("invalid_plan"));
  assert.deepEqual(system.ops(), []);
});

test("an approval is verified again on a resume, so a forged one can't finish a plan that already ran", async () => {
  const { system, approval, run } = await setup();
  status(await run(), "completed");
  const forged = { ...approval, stateHash: "0".repeat(64) };
  status(await run({ approval: forged }), "rejected");
  assert.equal(system.ops().length, 6);
});

test("each plan outcome maps onto the write outcome kind it stands for, and renders for the model", () => {
  const cases: [PlanOutcome, string, string][] = [
    [{ status: "completed", planId: "p1", effects: ["a: Do a"] }, "applied", "never"],
    [
      {
        status: "failed_compensated",
        planId: "p1",
        failedStep: "c",
        reason: "STEP_FAILED",
        undone: ["a: Do a"],
        next: "Tell them.",
      },
      "compensated",
      "new_operation_only",
    ],
    [
      {
        status: "failed_needs_human",
        planId: "p1",
        failedStep: "c",
        reason: "COMPENSATION_FAILED",
        undone: [],
        held: ["a: Do a"],
        outstanding: ["a: Do a"],
        avoid: "Do not retry.",
      },
      "partial",
      "never",
    ],
    [{ status: "pending", planId: "p1", phase: "pivot_unknown", stepId: "p" }, "unknown", "reconcile_first"],
    [{ status: "pending", planId: "p1", phase: "running", stepId: "r" }, "unknown", "never"],
    [{ status: "stale_approval", planId: "p1", reason: "changed" }, "not_applied", "new_operation_only"],
    [{ status: "expired", planId: "p1", reason: "lapsed" }, "not_applied", "new_operation_only"],
    [{ status: "rejected", planId: "p1", reason: "forged" }, "not_applied", "new_operation_only"],
  ];
  for (const [outcome, kind, retry] of cases) {
    const mapped = planWriteOutcome(outcome);
    assert.deepEqual([mapped.kind, mapped.retry], [kind, retry], outcome.status);
    const rendered = renderPlanOutcome(outcome);
    assert.equal(rendered.payload.kind, kind);
    assert.equal(rendered.isError, kind !== "applied");
  }
  assert.match(renderPlanOutcome(cases[3]?.[0] as PlanOutcome).text, /Do not say that it happened or that it failed/);
});

test("an ai agent that calls a plan tool reads the rendered outcome in its next request", async () => {
  const { system, approval, store, ledger, signer } = await setup();
  system.answer("c", async () => notApplied("do_c"));
  const plan = tool({
    description: "Run the approved plan",
    inputSchema: jsonSchema<Record<string, never>>({ type: "object" }),
    execute: async () =>
      planWriteOutcome(
        await runPlan({
          approval,
          steps: system.steps(approval),
          store,
          scope: SCOPE,
          signer,
          ledger,
          readState: system.readState,
          now: () => new Date(APPROVED_AT.getTime() + 60_000),
        }),
      ),
    toModelOutput: ({ output }) => toAiToolResult(output),
  });
  const requests: LanguageModelV4CallOptions[] = [];
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  };
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      requests.push(options);
      const answered = options.prompt.some((message) => message.role === "tool");
      return {
        content: answered
          ? [{ type: "text", text: "Done." }]
          : [{ type: "tool-call", toolCallId: "call_1", toolName: "run_plan", input: "{}" }],
        finishReason: { unified: answered ? "stop" : "tool-calls", raw: undefined },
        usage,
        warnings: [],
      };
    },
  });
  await generateText({ model, prompt: "Refund order 4417.", tools: { run_plan: plan }, stopWhen: isStepCount(2) });
  const result = requests
    .flatMap((request) => request.prompt.flatMap((message) => (message.role === "tool" ? message.content : [])))
    .find((part) => part.type === "tool-result");
  assert.ok(result?.type === "tool-result" && result.output.type === "error-json");
  const value = result.output.value as { kind: string; message: string; reverted: string[] };
  assert.equal(value.kind, "compensated");
  assert.deepEqual(value.reverted, ["b: Do b", "a: Do a"]);
  expect(value.message).toContain("took effect and was then undone");
});
