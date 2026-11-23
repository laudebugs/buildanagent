# T68c: Paper references in the retrieval and choosing-the-shape chapters

| Field | Value |
| --- | --- |
| ID | `T68c` |
| Status | `ongoing` |
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

- [ ] Read each paper in full and log one fact-check row per blurb claim
- [ ] Write the eight register entries and take them off `papers-pending.json`
- [ ] Convert the chapter mentions
- [ ] Run the checks and open the pull request

## Acceptance criteria

- [ ] `pnpm --filter @buildanagent/manual check:book`, the manual's tests and the book build pass
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass
- [ ] `audit:papers` shows no bare mention of the eight papers

## Tests

The existing `check:book` rules and the register tests.

## Docs to update

The book plan's todo table and its fact-check log.

## Risks and open questions

A blurb that restates a chapter claim could disagree with it; any disagreement goes in the pull request description.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed
