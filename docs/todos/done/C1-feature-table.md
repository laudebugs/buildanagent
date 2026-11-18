# C1: Feature table for the four SDKs

| Field | Value |
| --- | --- |
| ID | `C1` |
| Status | `done` |
| Plan | [SDK comparison §2](../../plans/sdk-comparison.md#2-the-feature-table-c1) |
| Round / milestone | Round C (comparison), M2 |
| Depends on | [S4b](../done/S4b-vercel-reference.md) |
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

- [x] List every row from the plan, and add rows the references surfaced
- [x] Fill each cell from a reference, with a link
- [x] Mark each cell [verified] or [documented]
- [x] Draft the reading guide with `/anthropic-skills:writing`; review with `/anthropic-skills:writing-review`
- [x] Re-check every cell against its source after fixes
- [x] Push

## Acceptance criteria

- [x] Every cell has a source link
- [x] No cell contradicts a reference
- [x] Review fixes applied

## Tests

None.

## Docs to update

Root README docs table; the comparison plan.

## Risks and open questions

Unequal depth between references; the [verified]/[documented] marks make it visible.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`docs/comparison/feature-table.md`: 29 rows in seven groups, 116 cells, each marked (V), (D) or —, and each linked to a guide section, a fact-check or a mirrored reference page. Re-checking the cells against their sources moved four Vercel cells to the reference pages and downgraded one Claude MCP cell from (V) to (D). The check also surfaced Vercel's `experimental_steering`, which matches Pi's steer and follow-up model.
