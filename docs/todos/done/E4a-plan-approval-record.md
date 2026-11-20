# E4a: The plan approval record: exact steps, the pivot, and an input hash that expires it

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E4a` |
| Status | `done` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E2](../done/E2-effect-identity-crash-rule.md), [E3](../done/E3-signed-approvals-third-party.md) |
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

The plan signature uses its own payload, prefixed with a fixed domain tag, so a plan signature can never verify as a tool approval of D5's shape. Adding a `"plan"` kind to the SDK's `SignedPendingRequest` would change D5's kind union. The owner chose on 2026-11-19 to keep plans on their own signature for now and to revisit the question when [B15](../done/B15-signed-pauses.md) starts ([SG5](../../plans/close-sdk-gaps.md#sg5-a-plan-approval-keeps-its-own-signature-separate-from-d5s-signed-request-kinds-accepted)).

## Tasks

- [x] Write `PlanStep`, `PlanApproval`, `lintPlan()`, `stateHash()` and the signing and verification.
- [x] Write the card payload, which shows the pivot and every step's arguments.
- [x] Add tests for each verification result.

## Acceptance criteria

- [x] `lintPlan` rejects a plan with a compensable step after the pivot, two pivots, or a retryable step before the pivot.
- [x] A plan approval whose `stateHash` input changes between approval and the first step returns `stale_approval`, and no step runs.
- [x] A change between step 1 and the pivot returns `stale_approval` before the pivot.
- [x] A step whose arguments differ from the signed `inputHash` returns `tampered`, and a step id not in the plan returns `step_not_in_plan`.
- [x] An approval past `expiresAt` returns `expired` before the pivot.
- [x] After the pivot, a changed `stateHash` input or a passed `expiresAt` still returns `ok` for the next step, while a changed input hash still returns `tampered`.
- [x] A plan signature does not verify as a tool approval, and a tool approval does not verify as a plan signature.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/plan-approval.test.ts`.

## Docs to update

The package README (how to classify steps, with the refund-then-email example from the sagas report).

## Risks and open questions

- Which values belong in `stateReads` is a per-tool judgment. The README should give the rule "every value the plan's arguments were computed from", and E4b's tests should include a plan that forgets one.
- The approval and pivot rules are our synthesis following U6, not a vendor design ([sagas report](../../research/reversible-actions/sagas.md#approval-belongs-before-the-first-compensable-step-and-covers-the-whole-plan)).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` (done) and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/agent-safety` can now sign one approval for a whole plan and check it before each step. The approval binds every step's tool and input hash, the order of the steps and a hash of the state the plan was computed from. Steps up to and including the pivot stop on a changed state or a passed expiry, and steps after the pivot check only that they are the signed step. The approval and pivot rules are our synthesis following U6, not a vendor design, and the README says so. Rows E4a-1 to E4a-7 of [the plan's fact-check log](../../plans/reviews/fact-check-close-sdk-gaps.md) check the claims the code and README borrow. The code-review rounds and the writing review run on the pull request.

The public API, in the root entry:

- `PlanStep`, `StepClass`, `StateRead`, `StateValue` and `PlanApproval`, the signed record.
- `lintPlan(steps)`, which returns `{ ok: true }` or every problem with the order.
- `stateHash(state)`, the SHA-256 of the read values with their sources and keys, under its own tag.
- `signPlan(fields, signer, options?)` with `PlanFields`, `PlanStepInit` and `SignPlanOptions`.
- `verifyPlanBeforeStep(approval, call, options)` with `PlanStepCall`, `VerifyPlanStepOptions` and `PlanStepCheck`.
- `planCard(fields)` with `PlanCard` and `PlanCardStep`, and `PlanLedger` with `memoryPlanLedger()`.
- The `SafetyError` code `invalid_plan`, which the SDK's vendored `errors.ts` now carries too.

Five choices differ from the design notes above:

- **`verifyPlanBeforeStep()` takes the step as the host has it now**, `{ stepId, tool, input }`, and hashes the input itself, so a caller can't compare against a hash it computed wrongly.
- **The state comes from a `readState` callback,** not a `freshState` value, so steps after the pivot never read it. A callback that returns the wrong number of values, or a value with no canonical JSON form, counts as `stale_approval`; one that rejects makes the check reject, and the step must not run.
- **A required `PlanLedger` refuses replay and skipping.** Its claim runs after every other check, so a failed check claims nothing, and it adds two results: `replayed` for a step that already passed and `out_of_order` for one whose predecessors haven't. A host that resumes a plan in another process needs a durable ledger; E7's stores can add one.
- **The record's signature field is `signature`,** as in `SignedPendingRequest`, not `sig`. The signature also covers each step's class, business key and summary, so the card text in a stored record is authentic too.
- **`signPlan()` takes inputs and values, not hashes,** and `planCard()` builds the card from the same fields through the same code, so the card shows exactly the hashes the signature covers.

Each criterion and the test that covers it, all in `packages/agent-safety/test/plan-approval.test.ts`:

- `lintPlan` rejects a compensable step after the pivot, two pivots, or a retryable step before the pivot: "lintPlan rejects a compensable step after the pivot", "lintPlan rejects two pivots" and "lintPlan rejects a retryable step before the pivot, and one in a plan with no pivot".
- A state change before the first step returns `stale_approval` and no step runs: "a state change between approval and the first step returns stale_approval, and no step runs".
- A change between step 1 and the pivot: "a state change between step 1 and the pivot returns stale_approval before the pivot".
- `tampered` and `step_not_in_plan`: "a step whose input or tool differs from the signed one returns tampered" and "a step id that isn't in the plan returns step_not_in_plan".
- `expired` before the pivot: "an approval past expiresAt returns expired for every step up to and including the pivot".
- After the pivot: "after the pivot, a changed state or a passed expiry still returns ok, and a changed input still returns tampered".
- Domain separation: "a plan signature does not verify as a tool approval, and a tool approval does not verify as a plan".
- Tamper cases for every signed field, an added, removed or reordered step, changed or reordered state reads, an extended expiry, an unknown key and a malformed record, each claiming nothing; replay, order and concurrent claims; and no key in a record, error or signer view.

The open question stays open for E4b: no check can find a value missing from `state`, so E4b's tests should include a plan that forgets one, as its criteria say.

