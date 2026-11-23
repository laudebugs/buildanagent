# T68e: Research-paper references for the voice papers and the unregistered names

| Field | Value |
| --- | --- |
| ID | `T68e` |
| Status | `ongoing` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | `T68a` |
| Size | S (four register entries, one chapter, one new entry) |

## Goal

Apply the owner's rule for research papers to the four voice papers and to the research names the audit finds in chapters with no register entry. Each paper gets a `short` name and a fact-checked `blurb`, and every mention in a chapter becomes `[[paper:id]]`.

## Context

- `apps/manual/README.md`, "How to cite a research paper".
- `apps/manual/src/data/papers-pending.json` and `sources.json`.
- `pnpm --filter @buildanagent/manual audit:papers`.

## Scope

**In scope**

- `full-duplex-bench`, `robot-turn-taking`, `stivers-turn-taking` and `tau-voice`: `short`, `blurb`, entry fixes, chapter mentions in Chapter 15.
- Each unregistered research name the audit lists, registered with a checked URL and blurb, or skipped with a reason.

**Out of scope**

- The other pending papers and the audit's four "probably belongs to a registered paper" hints (T68b, T68c and T68d).
- Changing any claim of a chapter.

## Tasks

- [ ] Read each paper in full and log each blurb claim in the book plan's fact-check log
- [ ] Fill the four register entries and empty their pending ids
- [ ] Convert Chapter 15's mentions
- [ ] Register the audit's unregistered research names and convert their mentions
- [ ] Report the audit's counts before and after

## Acceptance criteria

- [ ] `check:book`, the manual's tests, the book build, `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass

## Definition of done

- [x] Claimed: the first commit moved this file into `ongoing/`
