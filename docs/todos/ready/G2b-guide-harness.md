# G2b: Guide: building an agent harness

| Field | Value |
| --- | --- |
| ID | `G2b` |
| Status | `ready` |
| Plan | [Build guides §3](../../plans/build-guides.md#3-how-each-research-round-works) |
| Round / milestone | Round G (build guides), M3 |
| Depends on | [G2a](../done/G2a-research-harness.md), [G1b](../ready/G1b-guide-agent-sdk.md) |
| Size | L |

## Goal

Write `docs/guides/<layer>.md`, the guide to building an agent harness, from the research, ending with a reference architecture and the decisions it leaves for Round P.

## Context

- The matching research synthesis
- The plan's layer definitions in [§2](../../plans/build-guides.md#2-the-three-layers-defined)

## Scope

**In scope**

- The guide

**Out of scope** (and which todo covers it)

- The implementation plan (Round P)

## Tasks

- [ ] Draft with `/anthropic-skills:writing`
- [ ] Fact-check every claim against the research notes
- [ ] Review with `/anthropic-skills:writing-review`, fix, and re-check changed claims
- [ ] List the open decisions for Round P at the end
- [ ] Push

## Acceptance criteria

- [ ] The guide exists, passes review, and ends with a reference architecture and open decisions

## Tests

None.

## Docs to update

Root README docs table; the build guides plan.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
