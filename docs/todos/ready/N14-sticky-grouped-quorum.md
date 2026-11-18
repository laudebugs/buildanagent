# N14: Sticky allowances, grouped approvals and the quorum hook

| Field | Value |
| --- | --- |
| ID | `N14` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-tools-and-permissions) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N13](N13-signed-approvals.md) |
| Size | M |

## Goal

Cut approval fatigue without widening trust: allow sticky approvals scoped to a run or session that refuse interpreter prefixes and secrets, group equivalent calls into one decision, and give P3 a quorum hook.

## Context

- [HD12](../../plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback): the decision and its evidence
- [harness guide §5](../../guides/agent-harness.md#5-the-permission-pipeline-should-be-ordered-deny-first-and-fail-closed-and-its-approvals-should-be-signed-entries): sticky approvals, interpreter prefixes, grouped calls
- [build-harness.md §3.7](../../plans/build-harness.md#37-what-the-agent-plan-gets-from-the-harness): R1

## Scope

**In scope**

- `sticky: "run" | "session"` on `approval_resolved`, matched by tool and `canonicalInputHash` or by a command prefix
- A refusal list of interpreter prefixes (`bash -c`, `sh -c`, `sh -lc`, `zsh -c`, `node -e`, `python -c`, `bun run`, `npx`, `uvx`)
- A secret check that refuses a sticky pattern containing any value the credential store knows
- Grouped approvals: requests in one step with the same tool and normalised command share a `groupId`
- `QuorumPolicy` with a default of one resolution, and a check that rejects an approver equal to the requester

**Out of scope** (and which todo covers it)

- Quorum rules and roles (P3)

## Tasks

- [ ] Show grouped requests in one `approval/request` (the `group` field, wired in N28).

## Acceptance criteria

- [ ] A session-sticky allowance skips the prompt for the same call in a later turn and never in a new session
- [ ] Each listed interpreter prefix is refused as a sticky pattern
- [ ] A quorum policy of two keeps the call pending after one resolution and runs it after the second distinct approver
- [ ] An approver equal to `requesterId` is rejected
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/permissions/sticky.test.ts`, `grouped.test.ts`, `quorum.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

P3 may need quorum expiry; the policy interface takes a clock so it can add one.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
