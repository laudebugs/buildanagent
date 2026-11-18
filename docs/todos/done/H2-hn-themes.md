# H2: Practitioner research: analyse six themes in parallel

| Field | Value |
| --- | --- |
| ID | `H2` |
| Status | `done` |
| Plan | [Build guides §4b](../../plans/build-guides.md#4b-practitioner-research-from-hacker-news-round-h-added-2026-11-18) |
| Round / milestone | Round H (practitioner research), before the guides |
| Depends on | [H1](../done/H1-hn-corpus.md) |
| Size | L |

## Goal

Practitioner research: analyse six themes in parallel, as the plan section describes.

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

Six theme notes in `docs/research/practitioners/notes/`: what works, what fails, harnesses and SDKs, docs and DX, reliability/evals/cost, and security plus build-vs-buy. Each counts distinct authors and threads behind every claim, records counter-views and shifts over time, and ends with design implications. A mechanical check matched all 330 attributed quotes against the raw comments: 326 verbatim, and 4 with cosmetic edits (a dropped footnote marker, a typo fixed, an elided clause). One fabricated quote in an earlier draft of `what-works.md` was caught by its author and replaced with a paraphrase before this commit.
