# H3: Practitioner research: synthesis and fact-check, set against G1a–G3a

| Field | Value |
| --- | --- |
| ID | `H3` |
| Status | `ready` |
| Plan | [Build guides §4b](../../plans/build-guides.md#4b-practitioner-research-from-hacker-news-round-h-added-2026-11-18) |
| Round / milestone | Round H (practitioner research), before the guides |
| Depends on | [H2](../ongoing/H2-hn-themes.md), [G3a](../ongoing/G3a-research-agent.md) |
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

- [ ] Do the work the plan section describes; cite every claim to a thread or comment link with its date
- [ ] Store only links, metadata and short attributed excerpts in the repo; keep raw dumps gitignored
- [ ] Draft prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [ ] Push

## Acceptance criteria

- [ ] Deliverables exist, every claim links to its thread, and widely held views are separated from anecdotes
- [ ] `pnpm check` passes

## Tests

None.

## Docs to update

The build guides plan; the README docs table when H3 lands.

## Risks and open questions

Sampling bias toward coding agents and strong opinions; the synthesis must name it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
