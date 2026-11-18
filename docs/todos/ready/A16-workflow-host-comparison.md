# A16: The workflow-host comparison (AD1's settling test)

| Field | Value |
| --- | --- |
| ID | `A16` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 3](../../plans/build-agent.md#43-stage-3-runs-the-three-roles-as-linked-turns-and-proves-the-workflow-in-a-capstone) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A15](A15-agent-capstone.md) |
| Size | S |

## Goal

Build a test-only variant of the reader and drafter on `Model.complete()` and compare it with the loop-run version on code size, log shape and shadow replay, to confirm or revise AD1.

## Context

- [AD1](../../plans/build-agent.md#ad1-the-product-composes-the-workflow-from-three-linked-harness-turns-and-code-runs-every-side-effect-through-the-pipeline-provisional): the provisional check
- [ADR 0022](../../decisions/0022-workflow-composed-from-linked-turns.md)

## Scope

**In scope**

- A test-only `complete()` variant under `test/host-comparison/`
- A note with lines of code, entries per ticket and whether shadow replay works in each

**Out of scope** (and which todo covers it)

- Changing the production design (a follow-up if the variant wins)

## Tasks

- [ ] Run the synthetic classification slice through both variants.

## Acceptance criteria

- [ ] The note exists in the package README with the three measures
- [ ] ADR 0022's status reflects the result
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/host-comparison/*.test.ts`.

## Docs to update

ADR 0022; the README. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
