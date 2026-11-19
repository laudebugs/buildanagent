# E4b: Ordered plan execution: compensable steps, the pivot, the compensation log and the outcome

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E4b` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E4a](E4a-plan-approval-record.md) |
| Size | M |

## Goal

Run an approved plan in order, compensate the steps before the pivot if anything fails, run forward after the pivot, and tell the model exactly what is true afterwards (gap 4). The sagas report found that five of six workflow engines leave these three things to the author: the order of the undo, whether a compensation failure is visible, and what the caller is told.

## Context

- [Sagas report, the harness owns order, approval and outcome](../../research/reversible-actions/sagas.md#the-harness-not-the-engine-owns-order-approval-and-outcome): the five parts a saga tool needs, including per-step `compensate` functions and a persisted compensation log.
- [Sagas report, five outcomes](../../research/reversible-actions/sagas.md#the-agent-needs-five-outcomes-and-only-masstransit-tells-compensated-from-compensation-failed): the `SagaOutcome` union and the `pivot_unknown` phase.
- [E1](../done/E1-safety-core-outcomes.md) and [E2](E2-effect-identity-crash-rule.md): the outcome kinds and the effect keys every forward and compensating call uses.

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

- [ ] Write `runPlan()` and the compensation log.
- [ ] Map `PlanOutcome` onto `WriteOutcome`, and render the model text with E1's `renderOutcome`.
- [ ] Write the four failure tests below with fake tools.

## Acceptance criteria

- [ ] A failure in a compensable step compensates the earlier steps in reverse order, never runs the pivot, and returns `failed_compensated`.
- [ ] A compensation that itself fails returns `failed_needs_human` with that effect in `outstanding`, never `failed_compensated`.
- [ ] A pivot whose call times out returns `pending` with `pivot_unknown`; the plan neither compensates nor retries with a fresh key, and a later `reconcile` that finds the effect continues forward.
- [ ] A crash after step 2 of 3, resumed in a new process, compensates or continues from the log without repeating any step (a fake system counts requests per key).
- [ ] A stale approval found before step 1 runs nothing and returns `stale_approval`; one found after step 1 and before the pivot compensates step 1 and returns `failed_compensated`.
- [ ] A plan whose `stateReads` omits a value its arguments were computed from is caught by the README's rule check or recorded as a known miss (E4a's open question).
- [ ] An `ai` 7.0.162 agent that calls a plan tool reads the rendered outcome in its next request to `MockLanguageModelV4`.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/run-plan.test.ts` and a crash case in `test/crash.test.ts`.

## Docs to update

The package README (the refund-then-email walk-through, and the cancel rules).

## Risks and open questions

- A plan step that is long-running belongs on a wake, not in one request. This todo runs plans inside one host process or Durable Object. Waits that outlive the process are out of scope until a host provides a wake (N41) and plan state persists somewhere; E7 provides neither. *(Corrected in plan review 2, 2026-11-19: this line first said long waits come with E7.)*
- The rewind report advises no saga machinery for the deferred triage agent's v1, because it has no money-moving step yet ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#triage-needs-undo-windows-for-t1-approval-for-anything-that-leaves-the-org-and-a-saga-only-once-money-moves)). This todo builds the machinery for the package; an agent without a pivot need not use it, and each component stays removable.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
