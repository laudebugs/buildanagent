# P4: Review all three plans together, and fix the findings

| Field | Value |
| --- | --- |
| ID | `P4` |
| Status | `ready` |
| Plan | [Implementation plans §3](../../plans/implementation-plans.md#3-the-review-p4) |
| Round / milestone | Round P (plans), M4 |
| Depends on | [P1](../done/P1-plan-sdk.md), [P2](../ongoing/P2-plan-harness.md), [P3](../ready/P3-plan-agent.md) |
| Size | M |

## Goal

Review the SDK, harness and agent plans together for consistency, coverage, buildability and prose, fix every finding, and close the phase.

## Context

- The three plans
- The [review checklist](../../plans/implementation-plans.md#3-the-review-p4)

## Scope

**In scope**

- `docs/plans/reviews/plan-review.md` with findings and fixes

**Out of scope** (and which todo covers it)

- Building (next phase)

## Tasks

- [ ] Check that the harness plan uses the SDK plan's APIs as written, and the agent plan the harness plan's
- [ ] Check every guide recommendation is covered
- [ ] Check every todo is buildable and sized right
- [ ] Run `/anthropic-skills:writing-review` on each plan
- [ ] Fix every finding, or record the owner's acceptance
- [ ] Push, and mark M4 done in the roadmap

## Acceptance criteria

- [ ] Every finding is fixed or accepted by the owner
- [ ] The roadmap marks M4 done

## Tests

None.

## Docs to update

The roadmap; the plans README.

## Risks and open questions

The owner decides any finding left open.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
