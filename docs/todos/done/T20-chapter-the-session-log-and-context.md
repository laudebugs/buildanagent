# T20: Chapter: The session log and context policy

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T20` |
| Status | `done` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T7](../done/T7-book-isometric-figures.md), [T26](../done/T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "The session log and context policy" (`the-session-log-and-context`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** Why should a harness keep one append-only tree of entries, and how does context policy stay reversible?

## Context

- [Harness guide §2 and §3](../../guides/agent-harness.md)
- ADRs [0013](../../decisions/0013-log-entry-per-content-block.md) and [0014](../../decisions/0014-session-writer-lock.md)
- [Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Main report](../../research/agent-sdks-and-harness-design.md): external state artifacts as memory for long-running work
- [Agent research papers, provenance section](../../research/papers/agent-research-papers.md#trustworthy-agent-provenance-needs-a-replayable-transaction-log-per-criterion-verifiers-the-generator-cannot-see-and-a-staged-gate-before-any-demo-based-score-counts) (U22): Hou et al. (arXiv 2611.23234) argue that agent-output datasets keep patches and commits but drop the failed retries, fallbacks and abandoned sessions that drive cost and reliability, a structural claim they make from related work and not a measurement of their own. Wong (arXiv 2611.23678) instead computes governance metrics from an append-only trial ledger; both bear on why the log keeps every entry. U22's rows for both papers are ⚠️ (secondary summary, rows 96–101), and both papers were re-read in full on 2026-11-22 (issue #167: the rows named `fix/167-reread-papers-N` in the papers log); Hou et al. was submitted on 11 August 2026, not in November.
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/the-session-log-and-context.md`, with `switchTo: [N2–N10]` and `opening: analogy` in its front matter
- Sections: One append-only tree of typed entries, with HEAD, forks and a writer lock; Five context layers, cheapest first, with visible and reversible compaction; Progress files and feature lists for long-running work (Anthropic's long-running harness; main report)
- Listings and at least one replay from: `verify/pi/examples/05-session-tree.ts`, `verify/pi/examples/06-compaction.ts`, `verify/cloudflare-agents/examples/08-hibernation.ts`
- Figures: an isometric centerpiece of the session log as an exact technical tree of entries with HEAD, a fork and a compaction; a flat figure of five context layers, cheapest first; a flat analogy illustration of the desk with limited space
- Exercise: Fork a session, compact one branch, and show the other is unchanged.
- `apps/manual/fact-checks/the-session-log-and-context.md`, the chapter's claims log

**Opening:** analogy (the previous chapter in the outline opens with question).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| session log tree | a choose-your-own-adventure book that keeps every path taken | forks come from the harness and the user, and every path stays readable | none |
| context window | a desk with limited space | the model cannot open the drawer; only the harness decides what goes on the desk | flat |
| compaction | a TV show's "previously on" recap | the recap is written by a model and can drop facts, so the original entries stay in the log and a later turn can reread them | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N2–N10) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/the-session-log-and-context.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/the-session-log-and-context.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline and the centerpiece with T7's, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] The centerpiece prints `audit passed` and `line ends: 0` in `figures:audit`
- [x] Every version the prose names says "as of <month year>"
- [ ] `apps/manual/fact-checks/the-session-log-and-context.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `analogy`, and `check:book` passes its opening-rotation check
- [ ] The pull request records the writing review's 5C scores and its voice scores, before and after
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job; the harness tests for any example whose markers changed.

## Docs to update

- The plan's §4 row if the chapter's sources or examples change
- The glossary, the source register and the analogy register

## Risks and open questions

- A source may not answer the research question; record the gap as a follow-up research todo instead of answering from memory.
- An analogy can mislead a newcomer more than no analogy; the vetting task and the "where it breaks" note catch it. A weak analogy is dropped, or goes back to the owner with a proposed replacement, instead of being forced in.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Written on 2026-11-22 on branch `todo/T20-the-session-log-and-context`. The chapter has five parts besides its opening and exercises: the tree of typed entries, HEAD with forks, reverts and the writer lock, the five context layers with compaction as an entry, and progress files with feature lists. Its three listings come from `verify/pi/examples/05-session-tree.ts`, `06-compaction.ts` and `verify/cloudflare-agents/examples/08-hibernation.ts`, now marked with regions and notes, and the two Pi listings carry replays. It has three figures: the isometric `session-log-tree` (it prints `audit passed` and `line ends: 0`), the flat `context-layers` and the flat analogy illustration `limited-desk`. The fact-check log has 65 rows, 63 confirmed and 2 marked as our reading.

- **`switchTo` lists N2 to N10 one by one**, because the front-matter schema takes no range such as `N2–N10`. N8, N9 and N10 are not built, so `book:switch-report` says the chapter's listings still wait for our own packages.
- **The five context layers are a design**, described from the plan and the harness guide, with no code shown: `packages/harness/src/context/` is a stub as of November 2026.
- **The exercise** forks a Pi session, compacts one branch and shows the other unchanged, offline. It was run in a scratch file that was not committed (fact-check rows 62 and 63).
- **Left for the writing review and the code reviews** (unticked above): the whole-chapter `/anthropic-skills:writing-review` with its fixes and re-check rows, the rubric scores in the pull request description and the two code-review rounds.
