# T37: Section: agent-to-agent protocols (A2A) in Chapter T21

> **History:** the owner put the book's todos on hold on 2026-11-19 pending approval of the book plan, and approved the plan the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T37` |
| Status | `ready` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U19](U19-research-a2a.md), [T21](T21-chapter-tools-at-scale.md) |
| Size | S |

## Goal

Add one section to Chapter T21 ("Tools at scale: the registry, deferred tools, MCP and skills") from research todo [U19](U19-research-a2a.md)'s report. It is a section, not a chapter: A2A is an interoperability protocol beside MCP, so it belongs in the chapter that already explains MCP; one section keeps Chapter T21 from waiting on research.

## Context

- [U19](U19-research-a2a.md)'s report and fact-check
- Chapter T21's todo, [T21](T21-chapter-tools-at-scale.md), and its fact-check file `apps/book/fact-checks/tools-at-scale.md`
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)

## Scope

**In scope**

- One section in `apps/book/src/content/chapters/tools-at-scale.md`
- Listings, if the report recommends an example and a later todo writes it
- Rows for the section in `apps/book/fact-checks/tools-at-scale.md`

**Analogy** (BK22): A2A, as firms contracting through a standard purchase order. Where the analogy breaks: an A2A task can stream updates and ask for more input, which a purchase order never does. Use it only if it makes the concept clearer than plain explanation. No illustration unless the section needs one.

**Out of scope** (and which todo covers it)

- The research itself (the research todo)
- Rewriting the rest of the chapter

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`. If the analogy makes the concept clearer, open with it, then the mechanism and a "Where the analogy breaks" note, and register it in `analogies.json`; otherwise explain the concept plainly.
- [ ] Fact-check every claim in the section against its primary source into `apps/book/fact-checks/tools-at-scale.md` before any further edit, and commit the section together with its fact-check rows (BK21).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.

## Acceptance criteria

- [ ] The chapter still builds with every check passing, the analogy check included
- [ ] `apps/book/fact-checks/tools-at-scale.md` has the section's rows and the re-check rows, with an updated tally
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
