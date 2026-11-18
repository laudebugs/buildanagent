# C6: Add Strands to the feature table, the deep comparison and the TypeScript gap report

| Field | Value |
| --- | --- |
| ID | `C6` |
| Status | `ready` |
| Plan | [SDK comparison §4](../../plans/sdk-comparison.md#4-todos) |
| Round / milestone | M2d (added 2026-11-18) |
| Depends on | [S9b](S9b-strands-reference.md) |
| Size | M |

## Goal

Extend `docs/comparison/feature-table.md` (through its generator), `deep-comparison.md` and `typescript-gaps.md` from eight SDKs to nine.

## Context

- The Strands reference from S9b
- The generator `scripts/comparison/build-feature-table.py` and its source

## Scope

**In scope**

- A Strands column and capstone, its parity row, and a Strands section in the gap report

**Out of scope** (and which todo covers it)

- The skill (K5)

## Tasks

- [ ] Add Strands to the generator and every table, citing the reference
- [ ] Add its capstone to the deep comparison and update the trade-off sections
- [ ] Add the TypeScript–Python comparison to the gap report
- [ ] Draft with `/anthropic-skills:writing` and review whole with `/anthropic-skills:writing-review`

## Acceptance criteria

- [ ] Every new cell cites the Strands reference; the link check passes

## Tests

The link check.

## Docs to update

Root README rows for the comparison docs.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, fact-checked, and reviewed whole with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; delivered through its own pull request, squash-merged after CI passes
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
