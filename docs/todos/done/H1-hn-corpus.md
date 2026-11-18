# H1: Practitioner research: collect the Hacker News corpus (2025-05-18 to 2026-11-18)

| Field | Value |
| --- | --- |
| ID | `H1` |
| Status | `done` |
| Plan | [Build guides §4b](../../plans/build-guides.md#4b-practitioner-research-from-hacker-news-round-h-added-2026-11-18) |
| Round / milestone | Round H (practitioner research), before the guides |
| Depends on | None |
| Size | M |

## Goal

Practitioner research: collect the Hacker News corpus (2025-05-18 to 2026-11-18), as the plan section describes.

## Context

- The [build guides plan §4b](../../plans/build-guides.md#4b-practitioner-research-from-hacker-news-round-h-added-2026-11-18)
- The research syntheses in `docs/research/agent-sdk/`, `agent-harness/` and `agent/`

## Scope

**In scope**

- As named in the title; see the plan section

**Out of scope** (and which todo covers it)

- The guides (G1b–G3b)

## Tasks

- [x] Do the work the plan section describes; cite every claim to a thread or comment link with its date
- [x] Store only links, metadata and short attributed excerpts in the repo; keep raw dumps gitignored
- [x] Draft prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [x] Push

## Acceptance criteria

- [x] Deliverables exist, every claim links to its thread, and widely held views are separated from anecdotes
- [x] `pnpm check` passes

## Tests

None.

## Docs to update

The build guides plan; the README docs table when H3 lands.

## Risks and open questions

Sampling bias toward coding agents and strong opinions; the synthesis must name it.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`scripts/hn-corpus.mjs` queried the HN Algolia API with 25 queries, matching titles and URLs exactly (no typo tolerance), for 2025-05-18 to 2026-11-18. 1,052 stories had at least 50 points; the 400 most-commented threads (111,533 comments) were fetched into the gitignored `.raw/` folder, and `docs/research/practitioners/corpus.md` indexes them. Two earlier runs were discarded: one matched story text and comments, and one matched "map" and "MC03" for "MCP" through typo tolerance.
