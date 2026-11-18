# P2: Plan: our agent harness

| Field | Value |
| --- | --- |
| ID | `P2` |
| Status | `ready` |
| Plan | [Implementation plans §2](../../plans/implementation-plans.md#2-what-each-plan-contains) |
| Round / milestone | Round P (plans), M4 |
| Depends on | [G2b](../done/G2b-guide-harness.md), [P1](../ready/P1-plan-sdk.md) |
| Size | L |

## Goal

Write `docs/plans/build-harness.md`, a plan detailed enough to build our agent harness from, following the outline in the implementation plans.

## Context

- The matching guide
- The [plan outline](../../plans/implementation-plans.md#2-what-each-plan-contains)
- The [todo template](../TEMPLATE.md)

## Scope

**In scope**

- The plan, its decisions (with ADRs where lasting), and its todos in `ready/`

**Out of scope** (and which todo covers it)

- Building anything (next phase)

## Tasks

- [ ] Write goal and non-goals from the guide's reference architecture
- [ ] Decide every open question with options, a choice and evidence; record lasting ones as ADRs in `docs/decisions/`
- [ ] Sketch the package layout and public APIs as TypeScript signatures
- [ ] Write rounds and todos from the template, each with tasks, acceptance criteria and tests
- [ ] Write the test strategy, risks and sequence
- [ ] Draft and review the prose with the writing skills, fix, and push

## Acceptance criteria

- [ ] Every guide recommendation is planned, deferred with a reason, or rejected with evidence
- [ ] Every todo has checkable acceptance criteria

## Tests

None.

## Docs to update

The plans README; the roadmap.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
