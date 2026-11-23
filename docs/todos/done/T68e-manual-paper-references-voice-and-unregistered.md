# T68e: Research-paper references for the voice papers and the unregistered names

| Field | Value |
| --- | --- |
| ID | `T68e` |
| Status | `done` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | `T68a` |
| Size | S (four register entries and four new ones, two chapters) |

## Goal

Apply the owner's rule for research papers to the four voice papers and to the research names the audit finds in chapters with no register entry. Each paper gets a `short` name and a fact-checked `blurb`, and every mention in a chapter becomes `[[paper:id]]`.

## Context

- `apps/manual/README.md`, "How to cite a research paper".
- `apps/manual/src/data/papers-pending.json` and `sources.json`.
- `pnpm --filter @buildanagent/manual audit:papers`.

## Scope

**In scope**

- `full-duplex-bench`, `robot-turn-taking`, `stivers-turn-taking` and `tau-voice`: `short`, `blurb`, entry fixes, chapter mentions in Chapter 15.
- Each unregistered research name the audit lists, registered with a checked URL and blurb (DPR, TAS-B, Contriever, the Mem0 paper), or skipped with a reason (BM25, PaLM, LoCoMo, SWE-bench).

**Out of scope**

- The other pending papers and the audit's four "probably belongs to a registered paper" hints (T68b, T68c and T68d).
- Changing any claim of a chapter.

## Tasks

- [x] Read each paper in full and log each blurb claim in the book plan's fact-check log
- [x] Fill the four register entries and empty their pending ids
- [x] Convert Chapter 15's and Chapter 12's mentions
- [x] Register the audit's unregistered research names and convert their mentions
- [x] Report the audit's counts before and after

## Acceptance criteria

- [x] `check:book`, the manual's tests, the book build, `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass

## Outcome

- Five blurbs and four new register entries (`karpukhin-dpr`, `hofstatter-tas-b`, `izacard-contriever`, `chhikara-mem0`), each checked against the full paper (rows T68e-1 to T68e-15 of the book plan's fact-check log).
- Two chapter claims were wrong and were corrected in place, the only deliberate claim changes: Chapter 15's 85% and 31 to 51% sentence, and its 208 ms sentence (rows T68e-10 and T68e-11).
- BM25, PaLM, LoCoMo and SWE-bench stay unregistered, and LoCoMo and SWE-bench go to the owner as open questions.

## Review outcome

- **First round, Opus high:** 7 findings, all fixed.

## Definition of done

- [x] Claimed: the first commit moved this file into `ongoing/`
- [x] Moved to `done/` before the pull request was reviewed
