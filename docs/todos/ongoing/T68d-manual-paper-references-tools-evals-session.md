# T68d: Name the research papers of the tools, session, shape and evals chapters

| Field | Value |
| --- | --- |
| ID | `T68d` |
| Status | `ongoing` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | [T68a](../done/T68a-manual-paper-references-tooling.md) |
| Size | M (eleven register entries and about twenty mentions in nine chapters) |

## Goal

Apply the owner's rule on research papers to eleven papers that the tools, permissions, session, shape, evals and testing chapters cite. Each gets a short name and a blurb that a full reading of the paper supports, and every mention in the book becomes `[[paper:id]]`, so the first one per chapter describes the paper and later ones link.

## Context

- [T68a](../done/T68a-manual-paper-references-tooling.md): the syntax, the checks and the pending list.
- [`apps/manual/README.md`](../../../apps/manual/README.md#how-to-cite-a-research-paper): the rules for blurbs and mentions.
- Other content todos (T68b, T68c, T68e) cover the other pending papers in parallel.

## Scope

**In scope**

- `guirao-agent-cards`, `kumar-name-collision`, `santra-acam`, `hou-messy-middle`, `swe-agent-observation-masking`, `wong-governed-ml`, `liu-what-does-a-harness-buy`, `del-rosario-plan-then-execute`, `yao-react`, `abc-agentic-benchmark-checklist` and `tau-bench`: `short`, `blurb`, `aliases` and any incomplete `publisher`, removed from `papers-pending.json`.
- Every mention of these papers in the chapters, converted without changing a claim.
- One fact-check row per blurb claim in the book plan's log.

**Out of scope**

- The other pending papers (T68b, T68c, T68e), and any change to a chapter's claims.

## Tasks

- [ ] Read each paper in full and log its blurb claims
- [ ] Fill the register entries and empty their pending ids
- [ ] Convert the mentions in the chapters
- [ ] Run the checks and open the pull request

## Acceptance criteria

- [ ] `pnpm --filter @buildanagent/manual check:book`, the manual's tests and the book build pass
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass

## Tests

The existing `check:book` rules and the manual's tests.

## Docs to update

The book plan's todo table and its fact-check log.

## Outcome

To fill in when the work is done.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
