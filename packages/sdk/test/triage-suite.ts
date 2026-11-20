// The triage capstone's conformance suite: the cases every implementation of the loop must pass on the support-triage
// agent. `triageSuite()` takes the loop's `run` and `continueRun`, so the reference loop can run the same cases. It also
// takes a list of backends, and the SDK's loop runs the cases on the scripted model and on both mock transports. The
// cases assert only what a loop without observers can show, because the reference loop has none. capstone.test.ts
// checks the audit trail.
import assert from "node:assert/strict";
import type { Model } from "@buildanagent/gateway";
import type { AgentEvent, Context, continueRun, Resolution, run } from "@buildanagent/sdk";
import { testSigner } from "@buildanagent/sdk/testing";
import { test } from "vitest";
import {
  BUDGET_USD,
  MAX_STEPS,
  SYSTEM_PROMPT,
  type Triage,
  type TriageDeps,
  triageOptions,
} from "../examples/triage-agent.js";
import { pendingOf, roundTrip } from "./resume-helpers.js";
import { drive } from "./run-helpers.js";
import type { Backend, Fixture, ScriptedCall, Turn } from "./triage-backends.js";

/** The two functions a loop must provide: the SDK's own, or the reference loop's. */
export interface Loop {
  readonly run: typeof run;
  readonly continueRun: typeof continueRun;
}

/** The only tools a request may offer: the two the agent defines and its output tool. */
export const TRIAGE_TOOLS = ["escalate", "lookup_customer", "submit_triage"];

export const TICKET = "user@example.com says checkout fails with a 500. Triage it.";
export const REASON = "Checkout returns 500 for every pro customer.";
export const LOOKUP: ScriptedCall = { name: "lookup_customer", input: { email: "user@example.com" } };
export const ESCALATE: ScriptedCall = { name: "escalate", input: { reason: REASON } };
export const BUG: Triage = { category: "bug", priority: "high", summary: "Checkout returns 500 for a pro customer." };
const QUESTION: Triage = { category: "question", priority: "low", summary: "A pro customer asked about checkout." };
export const submit = (input: unknown): ScriptedCall => ({ name: "submit_triage", input });

/** One process's systems: what the tools did, and the audit trail. */
export function world() {
  const seen = { lookups: [] as string[], escalations: [] as string[], audit: [] as string[] };
  const deps = (model: Model): TriageDeps => ({
    model,
    signer: testSigner(),
    findCustomer: async (email) => {
      seen.lookups.push(email);
      return { plan: "pro", openTickets: 2 };
    },
    escalate: async (reason) => {
      seen.escalations.push(reason);
    },
    audit: (line) => seen.audit.push(line),
  });
  return { seen, deps };
}

/** Every request a fixture received offered exactly the agent's three tools. */
function assertSurface(...fixtures: Fixture[]): void {
  for (const fixture of fixtures) {
    for (const names of fixture.toolNames()) assert.deepEqual([...names].sort(), TRIAGE_TOOLS);
  }
}

/** Runs the agent in a first process over `turns`. */
async function start(loop: Loop, backend: Backend, turns: Turn[]) {
  const fixture = backend.fixture(turns, "a");
  const process = world();
  const options = { ...triageOptions(process.deps(fixture.model)), system: SYSTEM_PROMPT, input: TICKET };
  return { ...(await drive(loop.run(options))), fixture, process };
}

/** The first process: triage the ticket until the model asks to escalate, and the run pauses. */
async function pauseForEscalation(loop: Loop, backend: Backend) {
  const first = await start(loop, backend, [{ calls: [LOOKUP] }, { calls: [ESCALATE] }]);
  assert.equal(first.result.stopReason, "awaiting_approval");
  first.fixture.assertComplete();
  assert.deepEqual(first.process.seen.lookups, ["user@example.com"]);
  assert.deepEqual(first.process.seen.escalations, [], "nothing escalates before a person answers");
  const [request] = pendingOf(first.result);
  assert.ok(request);
  return { ...first, request };
}

/** The second process: its own model, tools and signer, resuming from `context` as stored JSON. */
async function resume(loop: Loop, backend: Backend, turns: Turn[], context: Context, answers: Resolution[]) {
  const fixture = backend.fixture(turns, "b");
  const process = world();
  const options = { ...triageOptions(process.deps(fixture.model)), resolutions: answers };
  const driven = await drive(loop.continueRun(roundTrip(context), options));
  return { ...driven, fixture, process };
}

function outputOf(result: { stopReason: string; output?: unknown }): unknown {
  return result.stopReason === "done" ? result.output : undefined;
}

function rejection(events: readonly AgentEvent[]): string | undefined {
  const event = events.find((e) => e.type === "resolution_rejected");
  return event?.type === "resolution_rejected" ? event.cause : undefined;
}

function approvedEscalation(loop: Loop, backend: Backend) {
  test(`${backend.name}: an approved escalation runs once in a second process and ends with a typed result`, async () => {
    const first = await pauseForEscalation(loop, backend);
    const allow: Resolution = { requestId: first.request.id, decision: "allow", by: "on-call lead" };
    const second = await resume(loop, backend, [{ calls: [submit(BUG)] }], first.result.context, [allow]);
    second.fixture.assertComplete();
    assert.equal(second.result.stopReason, "done");
    assert.deepEqual(outputOf(second.result), BUG);
    assert.deepEqual(second.process.seen.escalations, [REASON]);
    assert.deepEqual(first.process.seen.escalations, []);
    assert.deepEqual(second.process.seen.lookups, [], "the resume does not look the customer up again");
    assertSurface(first.fixture, second.fixture);
  });
}

function rejectedEscalation(loop: Loop, backend: Backend) {
  test(`${backend.name}: a rejected escalation never runs and the model answers without it`, async () => {
    const first = await pauseForEscalation(loop, backend);
    const deny: Resolution = { requestId: first.request.id, decision: "deny", reason: "not an outage" };
    const second = await resume(loop, backend, [{ calls: [submit(QUESTION)] }], first.result.context, [deny]);
    second.fixture.assertComplete();
    assert.equal(second.result.stopReason, "done");
    assert.deepEqual(outputOf(second.result), QUESTION);
    assert.deepEqual(second.process.seen.escalations, []);
    const denial = second.result.messages.find((m) => m.role === "tool" && m.callId === first.request.callId);
    assert.equal(denial?.role === "tool" && denial.isError, true);
    assert.match(JSON.stringify(denial), /denied: not an outage/);
    assertSurface(first.fixture, second.fixture);
  });
}

function invalidResult(loop: Loop, backend: Backend) {
  test(`${backend.name}: a result that fails its schema goes back to the model, not to the caller`, async () => {
    const wrong = submit({ category: "outage", priority: "high", summary: "Checkout is down." });
    const { result, fixture } = await start(loop, backend, [
      { calls: [LOOKUP] },
      { calls: [wrong] },
      { calls: [submit(BUG)] },
    ]);
    fixture.assertComplete();
    assert.equal(result.stopReason, "done");
    assert.deepEqual(outputOf(result), BUG);
    const errors = result.messages.filter((m) => m.role === "tool" && m.isError);
    assert.equal(errors.length, 1, "exactly the invalid submission failed");
    assert.match(JSON.stringify(errors[0]), /category/);
    assertSurface(fixture);
  });
}

function forgedSignature(loop: Loop, backend: Backend) {
  test(`${backend.name}: a forged signature runs nothing, calls no model and pauses again`, async () => {
    const first = await pauseForEscalation(loop, backend);
    const { request } = first;
    const pending = [{ ...request, signature: `${request.signature.slice(1)}A` }];
    const forged = { ...roundTrip(first.result.context), pending };
    const allow: Resolution = { requestId: request.id, decision: "allow", by: "attacker" };
    const second = await resume(loop, backend, [], forged, [allow]);
    second.fixture.assertComplete();
    assert.equal(second.result.stopReason, "awaiting_approval");
    assert.equal(rejection(second.events), "signature_invalid");
    assert.deepEqual(second.process.seen.escalations, []);
    assert.deepEqual(second.process.seen.lookups, []);
    assert.deepEqual(second.fixture.toolNames(), [], "no model call was made");
  });
}

function changedInput(loop: Loop, backend: Backend) {
  test(`${backend.name}: a stored input that no longer matches its signature runs nothing`, async () => {
    const first = await pauseForEscalation(loop, backend);
    const { request } = first;
    const pendingInputs = { [request.id]: { reason: "drop the table" } };
    const context = { ...roundTrip(first.result.context), pendingInputs };
    const second = await resume(loop, backend, [], context, [{ requestId: request.id, decision: "allow" }]);
    second.fixture.assertComplete();
    assert.equal(second.result.stopReason, "awaiting_approval");
    assert.equal(rejection(second.events), "input_changed");
    assert.deepEqual(second.process.seen.escalations, []);
  });
}

function stepCapAndBudget(loop: Loop, backend: Backend) {
  test(`${backend.name}: the step cap ends a run that never submits`, async () => {
    const turns = Array.from({ length: MAX_STEPS }, () => ({ calls: [LOOKUP] }));
    const { result, fixture } = await start(loop, backend, turns);
    fixture.assertComplete();
    assert.equal(result.stopReason, "max_steps");
    assert.equal(result.steps, MAX_STEPS);
    assertSurface(fixture);
  });

  test(`${backend.name}: the budget ends a run before the call it could not afford`, async () => {
    const { result, fixture } = await start(loop, backend, [{ calls: [LOOKUP], inputTokens: 1_000_000 }]);
    fixture.assertComplete();
    assert.equal(result.stopReason, "budget");
    assert.equal(result.stopReason === "budget" ? result.budgetUsd : undefined, BUDGET_USD);
    assert.ok(result.cost.total !== null && result.cost.total > BUDGET_USD);
    assert.equal(result.steps, 1);
  });
}

/** Registers the capstone's cases, for each backend, against `loop`. */
export function triageSuite(loop: Loop, backends: readonly Backend[]): void {
  for (const backend of backends) {
    approvedEscalation(loop, backend);
    rejectedEscalation(loop, backend);
    invalidResult(loop, backend);
    forgedSignature(loop, backend);
    changedInput(loop, backend);
    stepCapAndBudget(loop, backend);
  }
}
