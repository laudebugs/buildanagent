# C2: Deep comparison, and the research-report refresh

| Field | Value |
| --- | --- |
| ID | `C2` |
| Status | `done` |
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

- [x] Compare the four capstones side by side: lines, gating, typed output, test setup
- [x] Write the design trade-offs and the lessons for our SDK, harness and agent
- [x] Update the research report where the references changed a claim, and log each change
- [x] Draft with the writing skill, review with the review skill, fix, re-check
- [x] Push

## Acceptance criteria

- [x] The comparison exists and passes review
- [x] Every research-report change has a fact-check log row
- [x] Local checks pass

## Tests

None.

## Docs to update

Root README; the research report; its fact-check log; the roadmap (M2 progress).

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `docs/comparison/deep-comparison.md`: the four capstones side by side (58–87 code lines), four design trade-offs, and copy/avoid lessons for our SDK, harness and agent layers. Its main finding is that each SDK has one default that reaches outside the process.
- The research report gained five logged changes (rows 11–15 in `fact-check-2026-11-18.md`): the Vercel approval and step-cap primitives, OpenAI tracing, MCP 2026-07-28 corroboration, and the outward-reaching defaults.
- Re-checking the draft against its sources fixed four overstatements: the test-seam claim, the Vercel spend cap, the OpenAI error count, and a negative opener.
