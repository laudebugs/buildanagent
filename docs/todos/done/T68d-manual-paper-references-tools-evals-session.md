# T68d: Name the research papers of the tools, session, shape and evals chapters

| Field | Value |
| --- | --- |
| ID | `T68d` |
| Status | `done` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | [T68a](../done/T68a-manual-paper-references-tooling.md) |
| Size | M (eleven register entries and about twenty mentions in seven chapters) |

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

- [x] Read each paper in full and log its blurb claims
- [x] Fill the register entries and empty their pending ids
- [x] Convert the mentions in the chapters
- [x] Run the checks and open the pull request

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/manual check:book`, the manual's tests and the book build pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass

## Tests

The existing `check:book` rules and the manual's tests.

## Docs to update

The book plan's todo table and its fact-check log.

## Outcome

- All eleven papers have a short name and a blurb checked against the whole paper (rows T68d-1 to T68d-39 of the book plan's fact-check log) and are off `papers-pending.json`.
- `τ-bench` and `tau-bench` name the paper of Yao et al. (arXiv:2406.12045). `τ²-bench` is a different paper that no chapter names, and `τ-Voice` is the separate `tau-voice` entry.
- Chapter 8 calls the pattern "the reason-act loop", which is now the `react` glossary term (shown as "Reason-act loop"), and names the ReAct paper once as the pattern's source and where it cites the paper's results (`[[paper:yao-react]]`). Chapter 12 says "reason-act agent" in plain words and does not name the paper. The chapter 8 summary and the analogy `hiker-signs-or-route` use the plain name too.
- The Hou et al. blurb dates the paper from its arXiv page (submitted August 2026) and says it was posted in November, which rests on the id prefix and is logged as ⚠️ (rows T68d-36 and T68d-38); it names no venue (row T68d-39).
- No first mention is marked `described`: each first mention shows its blurb.
- One chapter claim was not stated by its paper: Chapter 11's "each cell is one run" (row T68d-19). The sentence now says "each cell covers 500 tasks" (row T68d-35).

## Review outcome

- **First round, Opus high:** 11 findings, all fixed in `9a3a0e78`.
- **Second round, Sonnet medium:** 4 findings, all fixed in `cc19ab61`.
- **Second round, Sonnet low:** 2 findings, both fixed: this file's stale row range and "no longer lists", and the fact-check section's overstated "full PDF" claim.
- **Writing review:** the rubric rose from 21 to 23 of 25 after the fixes.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
