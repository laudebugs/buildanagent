# H3: Practitioner research: synthesis and fact-check, set against G1a–G3a

| Field | Value |
| --- | --- |
| ID | `H3` |
| Status | `done` |
| Plan | [Build guides §4b](../../plans/build-guides.md#4b-practitioner-research-from-hacker-news-round-h-added-2026-11-18) |
| Round / milestone | Round H (practitioner research), before the guides |
| Depends on | [H2](../done/H2-hn-themes.md), [G3a](../done/G3a-research-agent.md) |
| Size | M |

## Goal

Practitioner research: synthesis and fact-check, set against G1a–G3a, as the plan section describes.

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

`practitioner-research.md` ranks eleven views practitioners widely share and seven disputes. It compares 15 claims with the vendor and paper evidence: 10 confirm, 3 qualify and 2 contradict, and both contradictions are vendor defaults. It tracks how views shifted over the 18 months, and it touches 31 of our 49 design decisions: 16 confirmed, 13 adjusted, plus new requirements in all three layers. The main additions are progress detection beyond step caps, completion checked in code, path-based ask rules for tests and hooks, and a visible cost and quota meter. All 29 attributed quotes match their comment's text, author and date. `fact-check.md` re-checks 21 claims. Writing-review rubric before → after: coherence 4→5, continuity 3→4, clarity 4→4, concision 4→5, cadence 3→4.
