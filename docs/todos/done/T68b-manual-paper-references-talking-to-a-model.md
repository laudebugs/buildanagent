# T68b: Name the research papers of Chapters 2 and 4 with a link and a description

| Field | Value |
| --- | --- |
| ID | `T68b` |
| Status | `done` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | [T68a](../done/T68a-manual-paper-references-tooling.md) |
| Size | S (nine register entries and two chapters) |

## Goal

Apply the owner's rule on research papers to the nine papers of the model-talking chapter and the structured-output chapter: no paper stays bare text, a chapter's first mention describes the paper, and every later mention links to its entry on the Sources page.

## Context

- [`apps/manual/README.md`](../../../apps/manual/README.md#how-to-cite-a-research-paper): the `[[paper:id]]` syntax and the `check:book` rules.
- [T68a](../done/T68a-manual-paper-references-tooling.md): the tooling this todo uses.

## Scope

**In scope**

- `short` and `blurb` for `fireact`, `gekhman-new-knowledge`, `gepa`, `map-measuring-agents`, `medprompt`, `ovadia-knowledge-injection`, `qi-fine-tuning-safety`, `swe-rl` and `ghosh-truthgate`, each fact-checked against the whole paper, and their removal from `papers-pending.json`.
- Every mention of them in `talking-to-a-model.md` and `stopping-and-structured-output.md` converted, with no claim changed.

**Out of scope** (and which todo covers it)

- The other pending papers: T68c, T68d and T68e.

## Tasks

- [x] Claim: this file in `ongoing/` and a plan row
- [x] Read each paper in full and log one row per claim in the build-book fact-check log
- [x] Write the nine register entries and empty their pending ids
- [x] Convert the chapter mentions

## Acceptance criteria

- [x] `check:book`, the manual's tests and the book build pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass

## Tests

The existing `check:book` rules and register tests cover the entries.

## Docs to update

The book plan's todo table.

## Risks and open questions

A blurb restating a chapter's number must agree with the paper; a disagreement is reported, not fixed silently.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes
