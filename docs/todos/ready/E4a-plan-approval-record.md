# E4a: The plan approval record: exact steps, the pivot, and an input hash that expires it

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E4a` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E2](E2-effect-identity-crash-rule.md), [E3](../done/E3-signed-approvals-third-party.md) |
| Size | M |

## Goal

Let a person approve a whole multi-step plan once, before its first step, when one step cannot be undone, and make that approval expire if the state it was based on changes (gap 4). No pinned SDK and no plan of ours has a plan approval kind, and a per-step prompt fails here: nothing after the irreversible step may wait on a person.

## Context

- [Sagas report, approval before the first step](../../research/reversible-actions/sagas.md#approval-belongs-before-the-first-compensable-step-and-covers-the-whole-plan): why one approval must cover every step's exact arguments.
- [Sagas report, the pivot](../../research/reversible-actions/sagas.md#the-refund-is-the-pivot-so-the-email-must-come-after-it): the order rule (compensable steps, then the pivot, then steps that can be retried).
- [Rewind report, refunds as a pivot](../../research/reversible-actions/rewind-vs-rollback.md#triage-needs-undo-windows-for-t1-approval-for-anything-that-leaves-the-org-and-a-saga-only-once-money-moves): hashing the order version and amount at approval time, and failing closed if either changed ("reread values").
- [E3](../done/E3-signed-approvals-third-party.md): the signer this record reuses.

## Scope

**In scope**

- The `PlanApproval` record, its signature and its verification
- The order lint: every compensable step before the pivot, at most one pivot, retryable steps after it
- `stateHash()` over the inputs a plan was computed from, and the expiry check
- An approval card payload that lists every step's exact arguments and marks the pivot

**Out of scope** (and which todo covers it)

- Running the plan and compensating (E4b)
- A UI for the card (the agent UI research; each product)

## Design notes

```ts
type StepClass = "compensable" | "pivot" | "retryable";
interface PlanStep { id: string; tool: string; class: StepClass; inputHash: string; businessKey?: string; summary: string }

interface PlanApproval {
  planId: string; steps: PlanStep[];               // exact arguments, by hash; summaries for the card
  stateHash: string;                               // hash of the values the plan read, e.g. order version + refunded amount
  stateReads: { source: string; key: string }[];   // what to re-read before each step
  expiresAt: string;                               // a time limit as well as a state limit
  keyId: string; sig: string;
}

declare function lintPlan(steps: PlanStep[]): { ok: true } | { ok: false; problems: string[] };
declare function verifyPlanBeforeStep(a: PlanApproval, stepId: string, freshState: unknown):
  Promise<"ok" | "stale_approval" | "expired" | "tampered" | "step_not_in_plan">;
```

The harness or agent calls `verifyPlanBeforeStep` before each step. Up to and including the pivot, it re-reads `stateReads`, recomputes `stateHash`, checks `expiresAt`, and checks that the step's arguments match the signed `inputHash`. A mismatch before the pivot returns `stale_approval`, and E4b compensates the steps already run. After the pivot, it checks only the input hash and plan membership, because the pivot itself changes the state (a refund changes the refunded amount) and nothing after the pivot may stop on a person or a clock.

The plan signature uses its own payload, prefixed with a fixed domain tag, so a plan signature can never verify as a tool approval of D5's shape. Adding a `"plan"` kind to the SDK's `SignedPendingRequest` would change D5's kind union. The owner chose on 2026-11-19 to keep plans on their own signature for now and to revisit the question when [B15](B15-signed-pauses.md) starts ([SG5](../../plans/close-sdk-gaps.md#sg5-a-plan-approval-keeps-its-own-signature-separate-from-d5s-signed-request-kinds-accepted)).

## Tasks

- [ ] Write `PlanStep`, `PlanApproval`, `lintPlan()`, `stateHash()` and the signing and verification.
- [ ] Write the card payload, which shows the pivot and every step's arguments.
- [ ] Add tests for each verification result.

## Acceptance criteria

- [ ] `lintPlan` rejects a plan with a compensable step after the pivot, two pivots, or a retryable step before the pivot.
- [ ] A plan approval whose `stateHash` input changes between approval and the first step returns `stale_approval`, and no step runs.
- [ ] A change between step 1 and the pivot returns `stale_approval` before the pivot.
- [ ] A step whose arguments differ from the signed `inputHash` returns `tampered`, and a step id not in the plan returns `step_not_in_plan`.
- [ ] An approval past `expiresAt` returns `expired` before the pivot.
- [ ] After the pivot, a changed `stateHash` input or a passed `expiresAt` still returns `ok` for the next step, while a changed input hash still returns `tampered`.
- [ ] A plan signature does not verify as a tool approval, and a tool approval does not verify as a plan signature.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/plan-approval.test.ts`.

## Docs to update

The package README (how to classify steps, with the refund-then-email example from the sagas report).

## Risks and open questions

- Which values belong in `stateReads` is a per-tool judgment. The README should give the rule "every value the plan's arguments were computed from", and E4b's tests should include a plan that forgets one.
- The approval and pivot rules are our synthesis following U6, not a vendor design ([sagas report](../../research/reversible-actions/sagas.md#approval-belongs-before-the-first-compensable-step-and-covers-the-whole-plan)).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
