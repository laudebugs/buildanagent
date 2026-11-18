# C2: Deep comparison, and the research-report refresh

| Field | Value |
| --- | --- |
| ID | `C2` |
| Status | `ongoing` |
| Plan | [SDK comparison §3](../../plans/sdk-comparison.md#3-the-deep-comparison-c2) |
| Round / milestone | Round C (comparison), M2 |
| Depends on | [C1](../done/C1-feature-table.md) |
| Size | L |

## Goal

Write `docs/comparison/deep-comparison.md`, comparing the four SDKs as designs through their triage-agent capstones, with lessons for our own stack. Refresh the research report with what the references found.

## Context

- C1's table
- The four capstone examples
- The [research report](../../research/agent-sdks-and-harness-design.md) and its [fact-check log](../../research/fact-check-2026-11-18.md)

## Scope

**In scope**

- The deep comparison
- Research-report corrections, logged in its fact-check

**Out of scope** (and which todo covers it)

- Skills (K1, K2)

## Tasks

- [ ] Compare the four capstones side by side: lines, gating, typed output, test setup
- [ ] Write the design trade-offs and the lessons for our SDK, harness and agent
- [ ] Update the research report where the references changed a claim, and log each change
- [ ] Draft with the writing skill, review with the review skill, fix, re-check
- [ ] Push

## Acceptance criteria

- [ ] The comparison exists and passes review
- [ ] Every research-report change has a fact-check log row
- [ ] Local checks pass

## Tests

None.

## Docs to update

Root README; the research report; its fact-check log; the roadmap (M2 progress).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
