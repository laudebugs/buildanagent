# C3: Add LangChain to the feature table and the deep comparison

| Field | Value |
| --- | --- |
| ID | `C3` |
| Status | `done` |
| Plan | [SDK comparison §4](../../plans/sdk-comparison.md#4-todos) |
| Round / milestone | Round C (comparison), M2b |
| Depends on | [S5b](../done/S5b-langchain-reference.md) |
| Size | M |

## Goal

Add a LangChain column to `docs/comparison/feature-table.md`, add the LangChain capstone to `docs/comparison/deep-comparison.md`, and revise the lessons where LangChain changes them.

## Context

- The LangChain reference (S5b)
- The existing comparison documents

## Scope

**In scope**

- Both comparison documents; research-report corrections, logged

**Out of scope** (and which todo covers it)

- The skill (K3)

## Tasks

- [x] Fill every row for LangChain, with links and (V)/(D) marks
- [x] Add the capstone to the side-by-side table and revise the trade-offs and lessons
- [x] Draft with the writing skill, review with the review skill, fix and re-check
- [x] Push

## Acceptance criteria

- [x] Every new cell has a source link
- [x] Review fixes applied

## Tests

None.

## Docs to update

Root README; the comparison plan.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The feature table gained a LangChain.js column (29 cells, each linked and marked). The deep comparison gained the LangChain capstone (67 code lines) and LangChain's checkpoint-based pause. LangChain changed its headline: LangSmith tracing is opt-in, so four of the five SDKs, not all of them, have a default that reaches outside the process. A middleware lesson joined the harness section.
