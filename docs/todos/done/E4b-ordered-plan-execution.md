# E4b: Ordered plan execution: compensable steps, the pivot, the compensation log and the outcome

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E4b` |
| Status | `done` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E4a](../done/E4a-plan-approval-record.md) |
| Size | M |

## Goal

Run an approved plan in order, compensate the steps before the pivot if anything fails, run forward after the pivot, and tell the model exactly what is true afterwards (gap 4). The sagas report found that five of six workflow engines leave these three things to the author: the order of the undo, whether a compensation failure is visible, and what the caller is told.

## Context

- [Sagas report, the harness owns order, approval and outcome](../../research/reversible-actions/sagas.md#the-harness-not-the-engine-owns-order-approval-and-outcome): the five parts a saga tool needs, including per-step `compensate` functions and a persisted compensation log.
- [Sagas report, five outcomes](../../research/reversible-actions/sagas.md#the-agent-needs-five-outcomes-and-only-masstransit-tells-compensated-from-compensation-failed): the `SagaOutcome` union and the `pivot_unknown` phase.
- [E1](../done/E1-safety-core-outcomes.md) and [E2](../done/E2-effect-identity-crash-rule.md): the outcome kinds and the effect keys every forward and compensating call uses.

## Scope

**In scope**

- `runPlan()`: verify (E4a), run each step through `guardedWrite` (E2), and log compensations
- A per-step `compensate` function, itself a guarded write with its own key
- The `PlanOutcome` union, and its mapping onto E1's `WriteOutcome`
- Cancel rules: a cancel before the pivot compensates; a cancel after it runs forward

**Out of scope** (and which todo covers it)

- A durable engine, and long waits beyond one process. They stay out of scope until a host provides a wake (N41 for our harness) and a todo adds plan-state persistence; E7's stores and `EffectStore` (`begin`, `settle`, `get`) hold effect records, not plan state
- Compensation code for specific tools (each agent)

## Design notes

```ts
interface PlanStepImpl { step: PlanStep; run(key: string): Promise<WriteOutcome>;
  compensate?(key: string): Promise<WriteOutcome> }   // required for class "compensable"

type PlanOutcome =
  | { status: "completed"; planId: string; effects: string[] }
  | { status: "failed_compensated"; planId: string; failedStep: string; undone: string[]; next: string }
  | { status: "failed_needs_human"; planId: string; failedStep: string; outstanding: string[]; avoid: string }
  | { status: "pending"; planId: string; phase: "running" | "pivot_unknown" }
  | { status: "stale_approval" | "expired" | "rejected"; planId: string; reason: string };
```

The mapping onto E1 is fixed: `completed` → `applied`, `failed_compensated` → `compensated`, `failed_needs_human` → `partial`, `pending` → `unknown` (with `retry: "reconcile_first"` for `pivot_unknown` and `retry: "never"` for `running`), and the last three → `not_applied`. The last three mean no step ran, as in the sagas report's union. A stale approval or expiry found after a step has run is a failure of that step: the plan compensates and returns `failed_compensated`, or `failed_needs_human` if a compensation fails. The compensation log is a list of `EffectRecord` keys in run order, kept in the `EffectStore`, so a resumed plan compensates in reverse order and never twice.

## Tasks

- [x] Write `runPlan()` and the compensation log.
- [x] Map `PlanOutcome` onto `WriteOutcome`, and render the model text with E1's `renderOutcome`.
- [x] Write the four failure tests below with fake tools.

## Acceptance criteria

- [x] A failure in a compensable step compensates the earlier steps in reverse order, never runs the pivot, and returns `failed_compensated`.
- [x] A compensation that itself fails returns `failed_needs_human` with that effect in `outstanding`, never `failed_compensated`.
- [x] A pivot whose call times out returns `pending` with `pivot_unknown`; the plan neither compensates nor retries with a fresh key, and a later `reconcile` that finds the effect continues forward.
- [x] A crash after step 2 of 3, resumed in a new process, compensates or continues from the log without repeating any step (a fake system counts requests per key). Tested in `test/run-plan.test.ts` with a store that throws as a dying process would, sharing the durable store and ledger; a forked-process case in `test/crash.test.ts` is not written (see the outcome).
- [x] A stale approval found before step 1 runs nothing and returns `stale_approval`; one found after step 1 and before the pivot compensates step 1 and returns `failed_compensated`.
- [x] A plan whose `stateReads` omits a value its arguments were computed from is caught by the README's rule check or recorded as a known miss (E4a's open question).
- [x] An `ai` 7.0.162 agent that calls a plan tool reads the rendered outcome in its next request to `MockLanguageModelV4`.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/run-plan.test.ts` and a crash case in `test/crash.test.ts`.

## Docs to update

The package README (the refund-then-email walk-through, and the cancel rules).

## Risks and open questions

- A plan step that is long-running belongs on a wake, not in one request. This todo runs plans inside one host process or Durable Object. Waits that outlive the process are out of scope until a host provides a wake (N41) and plan state persists somewhere; E7 provides neither. *(Corrected in plan review 2, 2026-11-19: this line first said long waits come with E7.)*
- The rewind report advises no saga machinery for the deferred triage agent's v1, because it has no money-moving step yet ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#triage-needs-undo-windows-for-t1-approval-for-anything-that-leaves-the-org-and-a-saga-only-once-money-moves)). This todo builds the machinery for the package; an agent without a pivot need not use it, and each component stays removable.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/agent-safety` can now run an approved plan in order. `runPlan()` verifies each step with `verifyPlanBeforeStep()`, runs it as a guarded write, undoes the steps that ran if the plan fails before the pivot, runs forward after it, and returns an outcome the harness computed. The README's `runPlan()` section gives the rules and the mapping table.

The public API, in the root entry:

- `runPlan(options)` with `RunPlanOptions`, `PlanStepImpl` and `PlanScope`.
- `PlanOutcome` and `PlanFailureReason`, the outcome union and the reason codes it carries.
- `planWriteOutcome(outcome)`, which maps a plan outcome onto the five write outcomes, and `renderPlanOutcome(outcome)`, which renders it with E1's `renderOutcome()`.

What the build changed from the design notes above:

- **The step record is the compensation log, so no separate list exists.** Each step's key is fixed by the plan id and the step id, so the records read in plan order show which steps ran. The one extra record is the plan's decision to unwind, stored as a settled `EffectRecord` under its own key, so a resume reads it first and never retries the failed step while the plan is half undone.
- **`PlanStepImpl` also holds the step's input and its `dedupe` rule**, because `verifyPlanBeforeStep()` hashes the input and `guardedWrite()` needs the rule. `reconcile` and `reconcileCompensation` are optional hooks; a compensation runs with `dedupe: "idempotency_key"`.
- **`PlanOutcome` gains a `reason` code on the failed statuses and a `stepId` on `pending`**, so the model and a person can see which step stopped the plan and why. The three statuses for a plan that never ran carry a `reason` sentence.
- **A pivot that only partly took effect is handed to a person without undoing the steps before it**, because undoing them could leave the plan worse. A pivot that was rejected is undone like any failed step.
- **A resume checks the approval again**, through `checkedPlanApproval()`, so a forged approval cannot finish a plan whose steps all ran. A step this plan already recorded skips the ledger claim, which it made before it stopped.
- **A forked-process crash case in `test/crash.test.ts` is not written.** The crash tests in `test/run-plan.test.ts` share a durable store and ledger and throw from the store at the chosen call, as a process that died there would, for a crash before a step's record, before a compensation's record and before a compensation settled. A forked case would add a loopback ledger beside the loopback store; it stays a follow-up.
- **A value left out of `state` is a known miss**, as E4a's open question expected. A test shows the plan completing after an unlisted value changed, and the README says the rule in its `state` section is the only guard.
