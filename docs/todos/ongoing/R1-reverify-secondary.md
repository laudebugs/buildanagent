# R1: Re-verify the "(secondary)" claims against primary sources

| Field | Value |
| --- | --- |
| ID | `R1` |
| Status | `ongoing` |
| Plan | [Build guides §4c](../../plans/build-guides.md#4c-re-verify-secondary-claims-against-primary-sources-r1-added-2026-11-18) |
| Round / milestone | Research, before the guides |
| Depends on | [H3](../done/H3-hn-synthesis.md) |
| Size | M |

## Goal

Re-check every claim marked "(secondary)" or sourced from a search summary against its primary source, now that most blocked hosts are reachable, and log each confirmation or correction.

## Context

- The owner's request (2026-11-18)
- About 127 marks in 22 files under `docs/research/`; see the plan section

## Scope

**In scope**

- The main report, its fact-check log, the three syntheses, the practitioner synthesis and their notes; the old working notes only where the main report relies on them

**Out of scope** (and which todo covers it)

- New research

## Tasks

- [ ] Fetch each primary source with curl; confirm, correct or mark still-unverified
- [ ] Replace confirmed secondary marks with primary citations; correct wrong claims in place
- [ ] Log every change in the matching fact-check log under "Re-verification against primary sources (R1)"
- [ ] Push

## Acceptance criteria

- [ ] Every marked claim in scope is confirmed, corrected, or explicitly still unverified with the reason
- [ ] Every change has a fact-check row

## Tests

None.

## Docs to update

The affected reports and their fact-check logs.

## Risks and open questions

openai.com and platform.openai.com return 403 to curl; claims sourced there may stay unverified.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
