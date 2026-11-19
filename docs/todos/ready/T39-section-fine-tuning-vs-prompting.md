# T39: Section: fine-tuning versus prompting in Chapter T11

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T39` |
| Status | `ready` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U21](U21-research-fine-tuning-vs-prompting.md), [T11](T11-chapter-talking-to-a-model.md) |
| Size | S |

## Goal

Add one section to Chapter T11 ("Talking to a model: messages, streams, tokens, instructions and model choice") from research todo [U21](U21-research-fine-tuning-vs-prompting.md)'s report. It is a section, not a chapter: the question arises the moment a reader chooses a model, which Chapter T11 teaches.

## Context

- [U21](U21-research-fine-tuning-vs-prompting.md)'s report and fact-check
- Chapter T11's todo, [T11](T11-chapter-talking-to-a-model.md), and its fact-check file `apps/book/fact-checks/talking-to-a-model.md`
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)

## Scope

**In scope**

- One section in `apps/book/src/content/chapters/talking-to-a-model.md`
- Listings, if the report recommends an example and a later todo writes it
- Rows for the section in `apps/book/fact-checks/talking-to-a-model.md`

**Analogy** (BK22): fine-tuning versus prompting, as sending an employee on a year-long course versus handing a skilled contractor a clear brief. Where the analogy breaks: a fine-tuned model also needs the brief; tuning changes defaults, not the need for instructions. Use it only if it makes the concept clearer than plain explanation. No illustration unless the section needs one.

**Out of scope** (and which todo covers it)

- The research itself (the research todo)
- Rewriting the rest of the chapter

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`. If the analogy makes the concept clearer, open with it, then the mechanism and a "Where the analogy breaks" note, and register it in `analogies.json`; otherwise explain the concept plainly.
- [ ] Fact-check every claim in the section against its primary source into `apps/book/fact-checks/talking-to-a-model.md` before any further edit, and commit the section together with its fact-check rows (BK21).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.

## Acceptance criteria

- [ ] The chapter still builds with every check passing, the analogy check included
- [ ] `apps/book/fact-checks/talking-to-a-model.md` has the section's rows and the re-check rows, with an updated tally
- [ ] The pull request records the 5C and voice scores, before and after
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job.

## Docs to update

- The book plan's §4.3 row

## Risks and open questions

- The research may show the topic needs a chapter after all; if so, propose it to the owner instead of overfilling the section.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
