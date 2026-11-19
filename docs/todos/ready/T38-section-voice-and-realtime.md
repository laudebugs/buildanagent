# T38: Section: voice and realtime agents in Chapter T35

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T38` |
| Status | `ready` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U20](U20-research-voice-and-realtime.md), [T35](T35-chapter-agents-people-can-watch.md) |
| Size | S |

## Goal

Add one section to Chapter T35 ("Agents people can watch: UIs, browsers and taking over") from research todo [U20](U20-research-voice-and-realtime.md)'s report. It is a section, not a chapter: voice and realtime change how a person interacts with a running agent, which is Chapter T35's subject.

## Context

- [U20](U20-research-voice-and-realtime.md)'s report and fact-check
- Chapter T35's todo, [T35](T35-chapter-agents-people-can-watch.md), and its fact-check file `apps/book/fact-checks/agents-people-can-watch.md`
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)

## Scope

**In scope**

- One section in `apps/book/src/content/chapters/agents-people-can-watch.md`
- Listings, if the report recommends an example and a later todo writes it
- Rows for the section in `apps/book/fact-checks/agents-people-can-watch.md`

**Analogy** (BK22): voice interruption, as a phone call where either side can cut in. Where the analogy breaks: the agent must cancel speech and tool calls already in flight when the person cuts in. Use it only if it makes the concept clearer than plain explanation. No illustration unless the section needs one.

**Out of scope** (and which todo covers it)

- The research itself (the research todo)
- Rewriting the rest of the chapter

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`. If the analogy makes the concept clearer, open with it, then the mechanism and a "Where the analogy breaks" note, and register it in `analogies.json`; otherwise explain the concept plainly.
- [ ] Fact-check every claim in the section against its primary source into `apps/book/fact-checks/agents-people-can-watch.md` before any further edit, and commit the section together with its fact-check rows (BK21).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.

## Acceptance criteria

- [ ] The chapter still builds with every check passing, the analogy check included
- [ ] `apps/book/fact-checks/agents-people-can-watch.md` has the section's rows and the re-check rows, with an updated tally
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
