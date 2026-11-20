import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  type ApprovalSigner,
  canonicalInputHash,
  hmacSigner,
  isSafetyError,
  lintPlan,
  memoryPlanLedger,
  type PlanApproval,
  type PlanFields,
  type PlanLedger,
  type PlanStepCall,
  pendingPayload,
  planCard,
  type StateRead,
  type StateValue,
  signPending,
  signPlan,
  stateHash,
  type VerifyPlanStepOptions,
  verifyPlanBeforeStep,
  verifyResolution,
} from "@buildanagent/agent-safety";
import { testSigner } from "@buildanagent/agent-safety/testing";
import { test } from "vitest";

const KEY_A = new Uint8Array(32).fill(0xa1);
const KEY_B = new Uint8Array(32).fill(0xb2);
const APPROVED_AT = new Date("2026-11-20T12:00:00.000Z");
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const FIXED = { generateId: () => "plan_1", now: () => APPROVED_AT };

// The sagas report's example: mark the order, refund it (the pivot), then email the customer and close the order.
const INPUTS = {
  mark: { orderId: 4417, status: "refund_pending" },
  refund: { orderId: 4417, amountCents: 2500, currency: "usd" },
  email: { to: "ada@example.com", subject: "Your refund", body: "We refunded $25.00 to your card." },
  close: { orderId: 4417, status: "refunded" },
} as const;

const STATE: readonly StateValue[] = [
  { source: "orders", key: "order:4417:refundable_cents", value: 2500 },
  { source: "payments", key: "order:4417:refunded_cents", value: 0 },
];

const PLAN: PlanFields = {
  steps: [
    {
      id: "mark",
      tool: "order_update",
      class: "compensable",
      input: INPUTS.mark,
      summary: "Mark order 4417 as refund_pending",
    },
    {
      id: "refund",
      tool: "refund_create",
      class: "pivot",
      input: INPUTS.refund,
      businessKey: "refund:4417",
      summary: "Refund $25.00 to the card on order 4417",
    },
    {
      id: "email",
      tool: "send_email",
      class: "retryable",
      input: INPUTS.email,
      businessKey: "email:4417:refund",
      summary: "Tell ada@example.com the refund is on its way",
    },
    {
      id: "close",
      tool: "order_update",
      class: "retryable",
      input: INPUTS.close,
      summary: "Mark order 4417 as refunded",
    },
  ],
  state: STATE,
  expiresInMs: FIFTEEN_MINUTES,
};

const CALLS: Record<keyof typeof INPUTS, PlanStepCall> = {
  mark: { stepId: "mark", tool: "order_update", input: INPUTS.mark },
  refund: { stepId: "refund", tool: "refund_create", input: INPUTS.refund },
  email: { stepId: "email", tool: "send_email", input: INPUTS.email },
  close: { stepId: "close", tool: "order_update", input: INPUTS.close },
};

/** A fake system of record whose values a test can change, and which counts its reads. */
function world(values: readonly unknown[] = STATE.map((entry) => entry.value)) {
  const current = [...values];
  let reads = 0;
  return {
    set(index: number, value: unknown) {
      current[index] = value;
    },
    get reads() {
      return reads;
    },
    async readState(stateReads: readonly StateRead[]) {
      reads++;
      return stateReads.map((_, index) => current[index]);
    },
  };
}

function options(
  extra: Partial<VerifyPlanStepOptions> & { readState?: VerifyPlanStepOptions["readState"] } = {},
): VerifyPlanStepOptions {
  return {
    signer: testSigner(),
    ledger: memoryPlanLedger(),
    readState: world().readState,
    now: () => new Date(APPROVED_AT.getTime() + 60_000),
    ...extra,
  };
}

async function approved(signer: ApprovalSigner = testSigner()): Promise<PlanApproval> {
  return signPlan(PLAN, signer, FIXED);
}

function assertSafetyError(code: string) {
  return (error: unknown) => {
    assert.ok(isSafetyError(error), `expected a SafetyError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  };
}

// --- lintPlan ---

test("lintPlan accepts compensable steps, then one pivot, then retryable steps", () => {
  assert.deepEqual(lintPlan(PLAN.steps), { ok: true });
  assert.deepEqual(
    lintPlan([
      { id: "a", class: "compensable" },
      { id: "b", class: "pivot" },
    ]),
    { ok: true },
  );
  assert.deepEqual(lintPlan([{ id: "only", class: "pivot" }]), { ok: true });
  assert.deepEqual(lintPlan([{ id: "a", class: "compensable" }]), { ok: true }, "a plan may have no pivot");
});

test("lintPlan rejects a compensable step after the pivot", () => {
  const lint = lintPlan([
    { id: "refund", class: "pivot" },
    { id: "mark", class: "compensable" },
  ]);
  assert.equal(lint.ok, false);
  assert.ok(!lint.ok && lint.problems.some((p) => p.includes(`"mark" is compensable but comes after the pivot`)));
});

test("lintPlan rejects two pivots", () => {
  const lint = lintPlan([
    { id: "refund", class: "pivot" },
    { id: "charge", class: "pivot" },
  ]);
  assert.ok(!lint.ok && lint.problems.includes(`the plan has two pivots: "refund" and "charge"`));
});

test("lintPlan rejects a retryable step before the pivot, and one in a plan with no pivot", () => {
  const before = lintPlan([
    { id: "email", class: "retryable" },
    { id: "refund", class: "pivot" },
  ]);
  assert.ok(!before.ok && before.problems.includes(`step "email" is retryable but comes before the pivot`));
  const noPivot = lintPlan([
    { id: "mark", class: "compensable" },
    { id: "email", class: "retryable" },
  ]);
  assert.ok(!noPivot.ok && noPivot.problems.includes(`step "email" is retryable but the plan has no pivot`));
});

test("lintPlan rejects an empty plan, a shared or blank id and an unknown class, listing every problem", () => {
  assert.deepEqual(lintPlan([]), { ok: false, problems: ["a plan needs at least one step"] });
  const lint = lintPlan([
    { id: "a", class: "compensable" },
    { id: "a", class: "compensable" },
    { id: "", class: "compensable" },
    { id: "b", class: "undoable" as never },
  ]);
  assert.ok(!lint.ok);
  assert.deepEqual(lint.problems, [
    `two steps share the id "a"`,
    "step 3 needs a non-empty, well-formed id",
    `step "b" has the class "undoable"`,
  ]);
});

test("lintPlan describes a missing or non-string class without converting it to a string", () => {
  const lint = lintPlan([
    { id: "a", class: undefined as never },
    { id: "b", class: Object.create(null) as never },
  ]);
  assert.deepEqual(lint, {
    ok: false,
    problems: [`step "a" has no class`, `step "b" has a class that is a object`],
  });
});

// --- stateHash ---

test("stateHash ignores key order inside a value and changes with any value, read or order", async () => {
  const base = await stateHash([{ source: "orders", key: "o", value: { a: 1, b: 2 } }]);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(await stateHash([{ source: "orders", key: "o", value: { b: 2, a: 1 } }]), base);
  assert.notEqual(await stateHash([{ source: "orders", key: "o", value: { a: 1, b: 3 } }]), base);
  assert.notEqual(await stateHash([{ source: "orders", key: "p", value: { a: 1, b: 2 } }]), base);
  assert.notEqual(await stateHash([{ source: "payments", key: "o", value: { a: 1, b: 2 } }]), base);
  const two = await stateHash(STATE);
  assert.notEqual(await stateHash([...STATE].reverse()), two, "the order of the reads counts");
});

test("stateHash is never a tool input hash of the same values", async () => {
  const state = [{ source: "orders", key: "o", value: 1 }];
  assert.notEqual(await stateHash(state), await canonicalInputHash(state));
  assert.notEqual(await stateHash(state), await canonicalInputHash([["orders", "o", 1]]));
});

test("stateHash rejects an undefined value, a read listed twice and a read without a source", async () => {
  await assert.rejects(
    stateHash([{ source: "orders", key: "o", value: undefined }]),
    assertSafetyError("invalid_input"),
  );
  await assert.rejects(
    stateHash([
      { source: "orders", key: "o", value: 1 },
      { source: "orders", key: "o", value: 2 },
    ]),
    assertSafetyError("invalid_plan"),
  );
  await assert.rejects(stateHash([{ source: "", key: "o", value: 1 }]), assertSafetyError("invalid_plan"));
});

// --- signPlan ---

test("signPlan stores each input's hash and the state's hash, never the inputs or the values", async () => {
  const approval = await approved();
  assert.equal(approval.planId, "plan_1");
  assert.equal(approval.expiresAt, "2026-11-20T12:15:00.000Z");
  assert.equal(approval.keyId, "test-fixed-key");
  assert.equal(approval.stateHash, await stateHash(STATE));
  assert.deepEqual(approval.stateReads, [
    { source: "orders", key: "order:4417:refundable_cents" },
    { source: "payments", key: "order:4417:refunded_cents" },
  ]);
  assert.deepEqual(
    approval.steps.map((step) => [step.id, step.class, step.businessKey]),
    [
      ["mark", "compensable", undefined],
      ["refund", "pivot", "refund:4417"],
      ["email", "retryable", "email:4417:refund"],
      ["close", "retryable", undefined],
    ],
  );
  assert.equal(approval.steps[1]?.inputHash, await canonicalInputHash(INPUTS.refund));
  const json = JSON.stringify(approval);
  assert.ok(!json.includes("We refunded"), "the email's body is not stored");
  assert.ok(!json.includes("2500"), "the state's values are not stored");
});

test("signPlan refuses steps out of order, a bad expiry, a blank field and an input with no JSON form", async () => {
  const signer = testSigner();
  const [mark, refund] = PLAN.steps as [PlanFields["steps"][0], PlanFields["steps"][0]];
  await assert.rejects(
    signPlan({ ...PLAN, steps: [refund, mark] }, signer, FIXED),
    (error: unknown) => assertSafetyError("invalid_plan")(error) && String(error).includes("compensable"),
  );
  for (const expiresInMs of [0, 0.4, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
    await assert.rejects(signPlan({ ...PLAN, expiresInMs }, signer, FIXED), assertSafetyError("invalid_plan"));
  }
  await assert.rejects(
    signPlan({ ...PLAN, steps: [{ ...mark, tool: "" }] }, signer, FIXED),
    assertSafetyError("invalid_plan"),
  );
  await assert.rejects(
    signPlan({ ...PLAN, steps: [{ ...mark, businessKey: "" }] }, signer, FIXED),
    assertSafetyError("invalid_plan"),
  );
  await assert.rejects(signPlan(PLAN, signer, { ...FIXED, generateId: () => "" }), assertSafetyError("invalid_plan"));
  await assert.rejects(
    signPlan({ ...PLAN, steps: [{ ...mark, input: { at: new Date() } }] }, signer, FIXED),
    assertSafetyError("invalid_input"),
  );
});

test("the same plan, id and clock sign to the same record, and it still verifies after a JSON round trip", async () => {
  const first = await approved();
  assert.deepEqual(await approved(), first);
  const stored = JSON.parse(JSON.stringify(first));
  assert.equal(await verifyPlanBeforeStep(stored, CALLS.mark, options()), "ok");
});

// --- verifyPlanBeforeStep: the acceptance criteria ---

/** Runs the plan's steps in order the way a harness would: each step only when its check is "ok". */
async function runSteps(approval: PlanApproval, calls: readonly PlanStepCall[], verify: VerifyPlanStepOptions) {
  const ran: string[] = [];
  for (const call of calls) {
    const check = await verifyPlanBeforeStep(approval, call, verify);
    if (check !== "ok") return { ran, stoppedAt: call.stepId, check };
    ran.push(call.stepId);
  }
  return { ran, stoppedAt: undefined, check: "ok" as const };
}

test("a state change between approval and the first step returns stale_approval, and no step runs", async () => {
  const approval = await approved();
  const system = world();
  system.set(1, 1000); // someone refunded $10.00 by hand after the person approved
  const result = await runSteps(approval, Object.values(CALLS), options({ readState: system.readState }));
  assert.deepEqual(result, { ran: [], stoppedAt: "mark", check: "stale_approval" });
});

test("a state change between step 1 and the pivot returns stale_approval before the pivot", async () => {
  const approval = await approved();
  const system = world();
  const verify = options({ readState: system.readState });
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "ok");
  system.set(0, 1500); // the refundable balance dropped while step 1 ran
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, verify), "stale_approval");
});

test("a step whose input or tool differs from the signed one returns tampered", async () => {
  const approval = await approved();
  const edited = { ...CALLS.mark, input: { ...INPUTS.mark, status: "cancelled" } };
  assert.equal(await verifyPlanBeforeStep(approval, edited, options()), "tampered");
  const otherTool = { ...CALLS.mark, tool: "order_delete" };
  assert.equal(await verifyPlanBeforeStep(approval, otherTool, options()), "tampered");
  const noForm = { ...CALLS.mark, input: { at: new Date() } };
  assert.equal(await verifyPlanBeforeStep(approval, noForm, options()), "tampered");
});

test("a step id that isn't in the plan returns step_not_in_plan", async () => {
  const approval = await approved();
  const call = { stepId: "refund_twice", tool: "refund_create", input: INPUTS.refund };
  assert.equal(await verifyPlanBeforeStep(approval, call, options()), "step_not_in_plan");
});

test("an approval past expiresAt returns expired for every step up to and including the pivot", async () => {
  const approval = await approved();
  const atExpiry = () => new Date("2026-11-20T12:15:00.000Z");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ now: atExpiry })), "expired");
  const ledger = memoryPlanLedger();
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ ledger })), "ok");
  const later = () => new Date("2026-11-20T13:00:00.000Z");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, options({ ledger, now: later })), "expired");
  const invalidClock = () => new Date(Number.NaN);
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ now: invalidClock })), "expired");
});

test("after the pivot, a changed state or a passed expiry still returns ok, and a changed input still returns tampered", async () => {
  const approval = await approved();
  const system = world();
  const ledger = memoryPlanLedger();
  const verify = options({ ledger, readState: system.readState });
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "ok");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, verify), "ok");
  const readsBeforeAfterPivot = system.reads;
  system.set(1, 2500); // the pivot itself refunded the order
  const afterExpiry = { ...verify, now: () => new Date("2026-11-21T00:00:00.000Z") };
  const editedEmail = { ...CALLS.email, input: { ...INPUTS.email, body: "We refunded $250.00." } };
  assert.equal(await verifyPlanBeforeStep(approval, editedEmail, afterExpiry), "tampered");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.email, afterExpiry), "ok");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.close, afterExpiry), "ok");
  assert.equal(system.reads, readsBeforeAfterPivot, "steps after the pivot never re-read the state");
});

// --- domain separation from the pending request ---

test("a plan signature does not verify as a tool approval, and a tool approval does not verify as a plan", async () => {
  const signer = testSigner();
  const approval = await approved(signer);
  const pending = await signPending(
    { kind: "approval", callId: "plan_1", tool: "refund_create", input: INPUTS.refund },
    signer,
    { generateId: () => "plan_1", now: () => APPROVED_AT },
  );
  // A tool approval carrying the plan's key and signature fails its own check.
  const forgedPending = { ...pending, keyId: approval.keyId, signature: approval.signature };
  const call = { callId: "plan_1", tool: "refund_create", input: INPUTS.refund };
  const asTool = await verifyResolution(forgedPending, { requestId: "plan_1", decision: "allow" }, { signer, call });
  assert.deepEqual(asTool, { ok: false, cause: "signature_invalid" });
  // A plan carrying a tool approval's signature fails too.
  const forgedPlan = { ...approval, keyId: pending.keyId, signature: pending.signature };
  assert.equal(await verifyPlanBeforeStep(forgedPlan, CALLS.mark, options({ signer })), "tampered");
  // The two payloads start with different tags, so no bytes are both.
  const tag = new TextDecoder().decode(pendingPayload(pending)).slice(0, 30);
  assert.equal(tag, `["buildanagent.pending.v1","pl`);
});

// --- tamper tests: every signed field ---

type Mutable = { -readonly [K in keyof PlanApproval]: unknown };

const TAMPERS: Record<string, (a: PlanApproval) => Mutable> = {
  "a changed step tool": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 0 ? { ...s, tool: "order_delete" } : s)),
  }),
  "a changed step input hash": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 1 ? { ...s, inputHash: "0".repeat(64) } : s)),
  }),
  "a changed step class": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 3 ? { ...s, class: "compensable" } : s)),
  }),
  "a changed step summary": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 1 ? { ...s, summary: "Refund $2.50" } : s)),
  }),
  "a changed business key": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 1 ? { ...s, businessKey: "refund:4418" } : s)),
  }),
  "a removed business key": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 1 ? { ...s, businessKey: undefined } : s)),
  }),
  "an added step": (a) => ({ ...a, steps: [...a.steps, { ...(a.steps[3] as object), id: "close_again" }] }),
  "a removed step": (a) => ({ ...a, steps: a.steps.slice(0, 3) }),
  "reordered steps": (a) => ({ ...a, steps: [a.steps[0], a.steps[1], a.steps[3], a.steps[2]] }),
  "a changed state hash": (a) => ({ ...a, stateHash: "f".repeat(64) }),
  "a changed state read": (a) => ({
    ...a,
    stateReads: a.stateReads.map((r, i) => (i === 0 ? { ...r, key: "order:4418:refundable_cents" } : r)),
  }),
  "a removed state read": (a) => ({ ...a, stateReads: a.stateReads.slice(1) }),
  "reordered state reads": (a) => ({ ...a, stateReads: [...a.stateReads].reverse() }),
  "an extended expiry": (a) => ({ ...a, expiresAt: "2026-11-27T12:15:00.000Z" }),
  "a changed plan id": (a) => ({ ...a, planId: "plan_2" }),
  "an unknown key id": (a) => ({ ...a, keyId: "someone-else" }),
  "a flipped signature": (a) => ({
    ...a,
    signature: `${a.signature.slice(0, 5)}${a.signature[5] === "A" ? "B" : "A"}${a.signature.slice(6)}`,
  }),
  "a missing signature": (a) => ({ ...a, signature: undefined }),
  "an expiry that isn't canonical ISO 8601": (a) => ({ ...a, expiresAt: "2026-11-20T12:15:00Z" }),
  "a malformed input hash": (a) => ({
    ...a,
    steps: a.steps.map((s, i) => (i === 0 ? { ...s, inputHash: s.inputHash.toUpperCase() } : s)),
  }),
  "steps that aren't an array": (a) => ({ ...a, steps: { 0: a.steps[0], length: 1 } }),
};

for (const [name, tamper] of Object.entries(TAMPERS)) {
  test(`an approval with ${name} returns tampered and claims nothing`, async () => {
    const approval = await approved();
    const ledger = memoryPlanLedger();
    // Every step's call is refused, because the signature is checked before anything the record says is trusted.
    for (const call of Object.values(CALLS)) {
      const check = await verifyPlanBeforeStep(tamper(approval), call, options({ ledger }));
      assert.equal(check, "tampered", call.stepId);
    }
    assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ ledger })), "ok", "nothing was claimed");
  });
}

test("a record that isn't an object, or lacks fields, returns tampered", async () => {
  for (const record of [null, undefined, "plan", 42, [], {}]) {
    assert.equal(await verifyPlanBeforeStep(record, CALLS.mark, options()), "tampered");
  }
});

test("an approval signed with another key, or by a ring that lacks its key, returns tampered", async () => {
  const signerA = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const signerB = hmacSigner({ keys: { a: KEY_B }, current: "a" });
  const approval = await approved(signerA);
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ signer: signerB })), "tampered");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ signer: testSigner() })), "tampered");
});

test("an approval signed under a rotated-out current key still verifies while the ring holds that key", async () => {
  const approval = await approved(hmacSigner({ keys: { old: KEY_A }, current: "old" }));
  const rotated = hmacSigner({ keys: { old: KEY_A, new: KEY_B }, current: "new" });
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ signer: rotated })), "ok");
});

// --- replay and order ---

test("a step that already passed returns replayed, and a step ahead of its turn returns out_of_order", async () => {
  const approval = await approved();
  const verify = options();
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, verify), "out_of_order");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "ok");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "replayed");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.email, verify), "out_of_order");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, verify), "ok");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, verify), "replayed", "the pivot never passes twice");
});

test("a second check of a step before the pivot meets the changed state first, and still never passes", async () => {
  const approval = await approved();
  const system = world();
  const verify = options({ readState: system.readState });
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "ok");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.refund, verify), "ok");
  system.set(1, 2500); // the refund ran
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "stale_approval", "not replayed: see README");
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.email, verify), "ok");
});

test("two checks of one step that arrive together pass once between them", async () => {
  const approval = await approved();
  const verify = options();
  const checks = await Promise.all([
    verifyPlanBeforeStep(approval, CALLS.mark, verify),
    verifyPlanBeforeStep(approval, CALLS.mark, verify),
  ]);
  assert.deepEqual(checks.sort(), ["ok", "replayed"]);
});

test("a ledger answer outside its type counts as a refusal", async () => {
  const approval = await approved();
  const odd: PlanLedger = { claim: async () => "yes" as never };
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ ledger: odd })), "out_of_order");
});

test("a stale check claims nothing, so the same step passes once the state is back", async () => {
  const approval = await approved();
  const system = world();
  const verify = options({ readState: system.readState });
  system.set(0, 0);
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "stale_approval");
  system.set(0, 2500);
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "ok");
});

// --- readState ---

test("readState that returns too few values, too many or one with no JSON form counts as stale", async () => {
  const approval = await approved();
  for (const values of [[2500], [2500, 0, 1], [2500, undefined], [2500, Number.NaN], "2500,0"]) {
    const verify = options({ readState: async () => values as readonly unknown[] });
    assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, verify), "stale_approval", JSON.stringify(values));
  }
});

test("readState receives a copy of the signed reads, and its rejection reaches the caller with nothing claimed", async () => {
  const approval = await approved();
  const ledger = memoryPlanLedger();
  let seen: readonly StateRead[] = [];
  const failing = options({
    ledger,
    readState: async (reads) => {
      seen = reads;
      throw new Error("orders database unavailable");
    },
  });
  await assert.rejects(verifyPlanBeforeStep(approval, CALLS.mark, failing), /orders database unavailable/);
  assert.deepEqual(seen, approval.stateReads);
  assert.notEqual(seen, approval.stateReads);
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ ledger })), "ok");
});

// --- keys stay out of records, errors and logs ---

test("no plan record, error or signer view holds a key's bytes", async () => {
  const signer = hmacSigner({ keys: { a: KEY_A }, current: "a" });
  const approval = await approved(signer);
  const hex = Buffer.from(KEY_A).toString("hex");
  const base64 = Buffer.from(KEY_A).toString("base64url");
  const views = [JSON.stringify(approval), inspect(approval, { depth: 10 }), inspect(signer, { depth: 10 })];
  try {
    await signPlan({ ...PLAN, expiresInMs: 0 }, signer, FIXED);
  } catch (error) {
    views.push(String(error), inspect(error));
  }
  for (const view of views) {
    assert.ok(!view.includes(hex) && !view.includes(base64), "a key leaked");
  }
});

// --- planCard ---

test("planCard lists every step's exact input with the hash signPlan signs, and marks the pivot", async () => {
  const card = await planCard(PLAN);
  const approval = await approved();
  assert.equal(card.pivot, "refund");
  assert.deepEqual(
    card.steps.map((step) => [step.position, step.id, step.isPivot]),
    [
      [1, "mark", false],
      [2, "refund", true],
      [3, "email", false],
      [4, "close", false],
    ],
  );
  assert.deepEqual(card.steps[2]?.input, INPUTS.email);
  assert.equal(card.steps[1]?.businessKey, "refund:4417");
  assert.ok(!("businessKey" in (card.steps[0] ?? {})));
  assert.deepEqual(
    card.steps.map((step) => step.inputHash),
    approval.steps.map((step) => step.inputHash),
  );
  assert.deepEqual(card.state, STATE);
  assert.deepEqual(JSON.parse(JSON.stringify(card)), card, "the card is plain JSON data");
});

test("planCard copies the inputs, so a later change to the plan's objects doesn't reach the card", async () => {
  const input = { orderId: 4417, status: "refund_pending", note: undefined };
  const card = await planCard({
    steps: [{ id: "mark", tool: "order_update", class: "compensable", input, summary: "Mark" }],
    state: [],
  });
  input.status = "cancelled";
  assert.deepEqual(card.steps[0]?.input, { orderId: 4417, status: "refund_pending" });
  assert.equal(card.pivot, null);
});

test("planCard reads each input once, so the card shows exactly the input its hash covers", async () => {
  let reads = 0;
  const input = {
    get amountCents() {
      reads++;
      return reads === 1 ? 2500 : 25000;
    },
  };
  const state = { source: "orders", key: "o", value: { status: "open" } };
  const pending = planCard({
    steps: [{ id: "refund", tool: "refund_create", class: "pivot", input, summary: "Refund" }],
    state: [state],
  });
  state.value.status = "closed"; // changed while the hashes are pending
  const card = await pending;
  assert.equal(reads, 1);
  assert.deepEqual(card.steps[0]?.input, { amountCents: 2500 });
  assert.equal(card.steps[0]?.inputHash, await canonicalInputHash({ amountCents: 2500 }));
  assert.deepEqual(card.state, [{ source: "orders", key: "o", value: { status: "open" } }]);
});

test("planCard refuses what signPlan refuses", async () => {
  const [mark, refund] = PLAN.steps as [PlanFields["steps"][0], PlanFields["steps"][0]];
  await assert.rejects(planCard({ steps: [refund, mark], state: STATE }), assertSafetyError("invalid_plan"));
  await assert.rejects(
    planCard({ steps: [mark], state: [{ source: "orders", key: "o", value: undefined }] }),
    assertSafetyError("invalid_input"),
  );
});

test("signPlan signs the state as it was when the call began, even if the caller changes it while hashing", async () => {
  const signer = testSigner();
  const state = STATE.map((read) => ({ ...read }));
  const pending = signPlan({ ...PLAN, state }, signer, FIXED);
  (state[0] as { value: unknown }).value = 1;
  const approval = await pending;
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options()), "ok", "the card's state still matches");
  const edited = world();
  edited.set(0, 1);
  assert.equal(
    await verifyPlanBeforeStep(approval, CALLS.mark, options({ readState: edited.readState })),
    "stale_approval",
  );
});

test("a signer whose verify throws refuses the step as tampered", async () => {
  const approval = await approved();
  const signer = {
    ...testSigner(),
    verify: async (): Promise<boolean> => {
      throw new Error("key store down");
    },
  };
  assert.equal(await verifyPlanBeforeStep(approval, CALLS.mark, options({ signer })), "tampered");
});
