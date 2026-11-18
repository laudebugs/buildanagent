# A8: Role-based quorum, the approver directory and fail-closed expiry (AD3)

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A8` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 2](../../plans/build-agent.md#42-stage-2-compiles-the-tier-table-into-the-pipeline-and-adds-the-kill-switch-the-quorum-and-the-taint-rule) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A6](A6-tier-table.md), [N14](N14-sticky-grouped-quorum.md) |
| Size | M |

## Goal

Fill the harness's quorum hook with role-based rules per tier and amount band, an `ApproverDirectory` interface with a fake, and fail-closed expiry, so a refund above the cap needs two distinct, authorised people.

## Context

- [AD3](../../plans/build-agent.md#ad3-a-role-based-quorum-per-tier-and-amount-band-bound-to-the-host-signed-pause-and-expiring-on-age-or-policy-change-accepted-with-sdk-d5-and-hd5): the decision, the rule table and the fail-closed cases
- [build-agent.md §3.3](../../plans/build-agent.md#33-policy-tiers-store-quorum-and-taint): `QuorumRule`, `ApproverDirectory`, `quorumPolicy()`, `ApprovalQuorum`
- [ADR 0024](../../decisions/0024-role-based-quorum.md)
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): need AH5, now in harness N12, and `QuorumPolicy` from N14

## Scope

**In scope**

- `quorumPolicy(rules, { directory, clock, currentPolicyVersion })` for the harness's `Approvals.quorum`
- `fakeApproverDirectory()` mapping tokens to principals and roles, with `roles(principalId)` (R10)
- `Resolution.by` filled from the authenticated principal only
- The four rules of AD3's table as `DEFAULT_POLICY.quorum`

**Out of scope** (and which todo covers it)

- Real approver authentication (A24)
- Per-approver signing keys (deferred)

## Tasks

- [ ] Write one test per fail-closed case: lapsed window, changed policy version, requester as approver, approver without a counting role, the same approver twice.

## Acceptance criteria

- [ ] A T4 call above the cap stays pending after one approval and runs after a second distinct `billing` approver
- [ ] A partial quorum fails closed after a policy-version change
- [ ] A client-supplied `by` value is ignored
- [ ] `quorumPolicy().evaluate()` counts a resolution only when `directory.roles(by)` holds a counting role
- [ ] A sticky or grouped resolution on a T3 `support_send_reply` call is refused, and the next reply still asks (R8)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/policy/quorum.test.ts`.

## Docs to update

The package README's "Approvals" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

The owner names the real roles (AD3); the role names are placeholders until then.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
