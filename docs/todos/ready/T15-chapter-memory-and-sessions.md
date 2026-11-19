# T15: Chapter: Memory within a task: sessions, threads and resuming

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T15` |
| Status | `ready` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T6](T6-book-flat-figures.md), [T26](T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "Memory within a task: sessions, threads and resuming" (`memory-and-sessions`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and an analogy for each core concept, and ends with an exercise the reader can run offline. **Research question:** Where does an agent's memory live between turns and between runs, and what does each SDK keep for you?

## Context

- [Harness guide §2](../../guides/agent-harness.md)
- [Feature table](../../comparison/feature-table.md): the state rows
- [Deep comparison](../../comparison/deep-comparison.md): "State lives in eight places"
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/book/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/book/src/content/chapters/memory-and-sessions.md`, with `switchTo: [N3, N6]` and `opening: analogy` in its front matter
- Sections: Sessions and threads; Saving and resuming a run, which the next chapter's approvals depend on; Where state lives in each SDK; long-term memory is a later chapter
- Listings and at least one replay from: `verify/openai-agents-sdk/examples/06-session.ts`, `verify/claude-agent-sdk/examples/06-resume-session.ts`, `verify/langchain/examples/05-thread-memory.ts`, `verify/google-adk/examples/04-sessions-state.ts`, `verify/cloudflare-agents/examples/01-state.ts`
- Figures: a flat figure of eight places state can live, one per SDK; a flat analogy illustration of the patient's chart
- Exercise: Resume a session in a fresh process and list what came back and what did not.
- `apps/book/fact-checks/memory-and-sessions.md`, the chapter's claims log

**Opening:** analogy (the previous chapter in the outline opens with question).

**Analogies** (BK22: one per core concept, distinct across the book; vet each before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| session | a patient's chart that travels with them between shifts | the model rereads the whole chart on every turn, and pays for every page | flat |
| resume | a bookmark | a resumed run must also restore pending approvals and tool state, not only the place in the text | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (N3, N6) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` markers and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19), so if one misleads or `analogies.json` already uses it, propose a replacement to the owner instead of changing it.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/book/fact-checks/memory-and-sessions.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Open each core concept with its analogy from the table above, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note; register every analogy in `apps/book/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, an analogy for every core concept, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/book/fact-checks/memory-and-sessions.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/book/fact-checks/memory-and-sessions.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [ ] Every core concept opens with its analogy and has a "Where the analogy breaks" note; every analogy is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [ ] The front matter's `opening` is `analogy`, and `check:book` passes its opening-rotation check
- [ ] The pull request records the writing review's 5C scores and its voice scores, before and after
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job; the harness tests for any example whose markers changed.

## Docs to update

- The plan's §4 row if the chapter's sources or examples change
- The glossary, the source register and the analogy register

## Risks and open questions

- A source may not answer the research question; record the gap as a follow-up research todo instead of answering from memory.
- An analogy can mislead a newcomer more than no analogy; the vetting task and the "where it breaks" note are there to catch it, and a weak analogy goes back to the owner with a proposed replacement, not forced.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
