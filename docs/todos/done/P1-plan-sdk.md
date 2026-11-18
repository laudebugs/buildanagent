# P1: Plan: our agent SDK

| Field | Value |
| --- | --- |
| ID | `P1` |
| Status | `done` |
| Plan | [Implementation plans §2](../../plans/implementation-plans.md#2-what-each-plan-contains) |
| Round / milestone | Round P (plans), M4 |
| Depends on | [G1b](../done/G1b-guide-agent-sdk.md) |
| Size | L |

## Goal

Write `docs/plans/build-sdk.md`, a plan detailed enough to build our agent SDK from, following the outline in the implementation plans.

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

- [x] Write goal and non-goals from the guide's reference architecture
- [x] Decide every open question with options, a choice and evidence; record lasting ones as ADRs in `docs/decisions/`
- [x] Sketch the package layout and public APIs as TypeScript signatures
- [x] Write rounds and todos from the template, each with tasks, acceptance criteria and tests
- [x] Write the test strategy, risks and sequence
- [x] Draft and review the prose with the writing skills, fix, and push

## Acceptance criteria

- [x] Every guide recommendation is planned, deferred with a reason, or rejected with evidence
- [x] Every todo has checkable acceptance criteria

## Tests

None.

## Docs to update

The plans README; the roadmap.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
