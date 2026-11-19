# T20: Chapter: The session log and context policy

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T20` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T7](T7-book-isometric-figures.md), [T26](T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "The session log and context policy" (`the-session-log-and-context`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and an analogy for each core concept, and ends with an exercise the reader can run offline. **Research question:** Why should a harness keep one append-only tree of entries, and how does context policy stay reversible?

## Context

- [Harness guide §2 and §3](../../guides/agent-harness.md)
- ADRs [0013](../../decisions/0013-log-entry-per-content-block.md) and [0014](../../decisions/0014-session-writer-lock.md)
- [Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Main report](../../research/agent-sdks-and-harness-design.md): external state artifacts as memory for long-running work
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/book/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/book/src/content/chapters/the-session-log-and-context.md`, with `switchTo: [N2–N10]` and `opening: analogy` in its front matter
- Sections: One append-only tree of typed entries, with HEAD, forks and a writer lock; Five context layers, cheapest first, with visible and reversible compaction; Progress files and feature lists for long-running work (Anthropic's long-running harness; main report)
- Listings and at least one replay from: `verify/pi/examples/05-session-tree.ts`, `verify/pi/examples/06-compaction.ts`, `verify/cloudflare-agents/examples/08-hibernation.ts`
- Figures: an isometric centerpiece of the session log as an exact technical tree of entries with HEAD, a fork and a compaction; a flat figure of five context layers, cheapest first; a flat analogy illustration of the desk with limited space
- Exercise: Fork a session, compact one branch, and show the other is unchanged.
- `apps/book/fact-checks/the-session-log-and-context.md`, the chapter's claims log

**Opening:** analogy (the previous chapter in the outline opens with question).

**Analogies** (BK22: one per core concept, distinct across the book; vet each before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| session log tree | a choose-your-own-adventure book that keeps every path taken | forks come from the harness and the user, and every path stays readable | none |
| context window | a desk with limited space | the model cannot open the drawer; only the harness decides what goes on the desk | flat |
| compaction | a TV show's "previously on" recap | the recap is written by a model and can drop facts, so the original entries stay in the log and a later turn can reread them | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (N2–N10) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` markers and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19), so if one misleads or `analogies.json` already uses it, propose a replacement to the owner instead of changing it.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/book/fact-checks/the-session-log-and-context.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Open each core concept with its analogy from the table above, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note; register every analogy in `apps/book/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, an analogy for every core concept, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/book/fact-checks/the-session-log-and-context.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline and the centerpiece with T7's, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] The centerpiece prints `audit passed` and `line ends: 0` in `figures:audit`
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/book/fact-checks/the-session-log-and-context.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
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
