# T68c: Paper references in the retrieval and choosing-the-shape chapters

| Field | Value |
| --- | --- |
| ID | `T68c` |
| Status | `done` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | [T68a](../done/T68a-manual-paper-references-tooling.md) |
| Size | S (eight register entries and a few chapter sentences) |

## Goal

Apply the owner's rule that no research paper stays bare text to eight papers: Cormack's RRF paper, MINJA, NoLiMa, BEIR, LIMIT, BadRAG, PoisonedRAG and Reflexion. Each gets a short name and a fact-checked blurb in the register, leaves the pending list, and every mention in a chapter uses `[[paper:id]]`.

## Context

- [`apps/manual/README.md`](../../../apps/manual/README.md#how-to-cite-a-research-paper): the syntax and the `check:book` rules.
- [T68a](../done/T68a-manual-paper-references-tooling.md): the tooling this todo uses.
- Chapters: `retrieval-and-long-term-memory.md` and `choosing-the-shape.md` (Reflexion).

## Scope

**In scope**

- `short`, `blurb` and, where needed, `aliases` for the eight papers, with the register's authors, venue and `url` corrected from each paper.
- Cormack's `url` moves from an author PDF to the ACM SIGIR 2009 DOI.
- Every bare mention in a chapter converted, with no claim changed.

**Out of scope** (and which todo covers it)

- The other papers on the pending list: T68b, T68d and T68e.

## Tasks

- [x] Read each paper in full and log one fact-check row per blurb claim
- [x] Write the eight register entries and take them off `papers-pending.json`
- [x] Convert the chapter mentions
- [x] Run the checks and open the pull request

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/manual check:book`, the manual's tests and the book build pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass
- [x] `audit:papers` shows no bare mention of the eight papers

## Tests

The existing `check:book` rules and the register tests.

## Docs to update

The book plan's todo table and its fact-check log.

## Outcome

Eight register entries have a `short` name and a fact-checked blurb: `cormack-rrf`, `dong-minja`, `modarressi-nolima`, `thakur-beir`, `weller-limit`, `xue-badrag`, `zou-poisonedrag` and `shinn-reflexion`. Each left `papers-pending.json`, which now holds only `yao-react` (T68d). Every mention in `retrieval-and-long-term-memory.md` and `choosing-the-shape.md` uses `[[paper:id]]`, and `audit:papers` shows no bare mention of the eight. No chapter claim changed. Rows T68c-1 to T68c-9 in the plan's fact-check log record the checks. Row T68c-1 is a correction: reciprocal rank fusion almost always, not always, beats the best ranking it combines (Table 2, TREC 9). The `cormack-rrf` URL is now the paper's DOI.

## Review outcome

- Opus high found 6 and all were fixed: Reflexion's venue, blurbs that repeated their host sentences, the reciprocal rank fusion overstatement, the Cormack sentence, the author-PDF link and BadRAG's affiliations.
- Sonnet low confirmed no further code or data finding.
- The writing review found four copy findings, all fixed: the log rows had no section of their own, the BEIR blurb ordered its date differently from the others, the MINJA blurb stacked two "on"s, and the Cormack sentence put "whose authors" after a name that already means the authors.

## Risks and open questions

A blurb that restates a chapter claim could disagree with it; any disagreement goes in the pull request description.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high`, then `low` after 6 or fewer findings), with every finding fixed or explained
- [x] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description
