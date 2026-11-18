# C1: Feature table for the four SDKs

| Field | Value |
| --- | --- |
| ID | `C1` |
| Status | `ready` |
| Plan | [SDK comparison §2](../../plans/sdk-comparison.md#2-the-feature-table-c1) |
| Round / milestone | Round C (comparison), M2 |
| Depends on | [S4b](../ready/S4b-vercel-reference.md) |
| Size | M |

## Goal

Write `docs/comparison/feature-table.md`: one row per feature, one column per SDK, every cell linked to the reference fact behind it and marked **[verified]** or **[documented]**.

## Context

- The four references' guides and fact-checks
- The row groups in the [comparison plan §2](../../plans/sdk-comparison.md#2-the-feature-table-c1)

## Scope

**In scope**

- The table and a short reading guide above it

**Out of scope** (and which todo covers it)

- The deep comparison (C2)

## Tasks

- [ ] List every row from the plan, and add rows the references surfaced
- [ ] Fill each cell from a reference, with a link
- [ ] Mark each cell [verified] or [documented]
- [ ] Draft the reading guide with `/anthropic-skills:writing`; review with `/anthropic-skills:writing-review`
- [ ] Re-check every cell against its source after fixes
- [ ] Push

## Acceptance criteria

- [ ] Every cell has a source link
- [ ] No cell contradicts a reference
- [ ] Review fixes applied

## Tests

None.

## Docs to update

Root README docs table; the comparison plan.

## Risks and open questions

Unequal depth between references; the [verified]/[documented] marks make it visible.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
