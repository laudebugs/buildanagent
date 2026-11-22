# T24: Chapter: Durable and portable agents, and how work reaches them

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T24` |
| Status | `done` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md), [T33](../done/T33-example-durability.md) |
| Size | M |

## Goal

Write the chapter "Durable and portable agents, and how work reaches them" (`durable-and-portable-agents`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** What does it take for an agent to sleep, wake and run on Cloudflare, AWS or Vercel with one code base, and how do triggers reach it once?

## Context

- [Portable agents report](../../research/deployment/portable-agents.md) ("Seven seams") and the [storage-and-wake note](../../research/deployment/storage-and-wake.md)
- ADR [0033](../../decisions/0033-three-deployment-targets.md) (seven seams) and ADR [0043](../../decisions/0043-standalone-safety-core.md) (`EffectStore`, the eighth)
- [12-factor agents](../../research/external-designs/twelve-factor-agents.md): the ingress gap
- [Coding agent plan](../../plans/build-coding-agent.md) CA3 and CA7
- [Agent-building platforms](../../research/deployment/agent-building-platforms.md)
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/durable-and-portable-agents.md`, with `switchTo: [N41–N48]` and `opening: code` in its front matter
- Sections: Durability: state, wake and resume on Cloudflare (the only target `verify/` runs); The seven seams of ADR 0033 plus `EffectStore` from ADR 0043, and what AWS and Vercel need; Ingress and triggers: one design, deduplicated by id (12-factor agents, factor 11; coding agent plan CA7)
- Listings and at least one replay from: `verify/cloudflare-agents/examples/02-sql.ts`, `verify/cloudflare-agents/examples/03-scheduling.ts`, `verify/cloudflare-agents/examples/08-hibernation.ts`, `verify/cloudflare-agents/examples/10-durable-wake.ts` from [T33](../done/T33-example-durability.md), which evicts an agent and lets its scheduled alarm wake it (the AWS and Vercel durability behaviours are not runnable in `verify/`; N47a and N48a add them to our own packages)
- Figures: a flat figure of the seven seams plus `EffectStore`, and their implementation on each target; a flat analogy illustration of shipping containers
- Exercise: Schedule a wake, hibernate, and list what the agent must reload; then send the same trigger twice and show one task starts.
- `apps/manual/fact-checks/durable-and-portable-agents.md`, the chapter's claims log

**Opening:** code (the previous chapter in the outline opens with incident).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| durable wake | an alarm clock with a note on the bedside table saying where you left off | alarms can fire twice, so the note must make a second wake harmless | none |
| portable seams | standard shipping containers that fit any ship, crane and truck | each port still needs its own crane: every target needs its own adapter | flat |
| ingress deduplication | a mailroom that stamps each letter's number and bins duplicates | the number must come from the sender, such as a webhook's delivery id | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N41–N48) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/durable-and-portable-agents.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/durable-and-portable-agents.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/durable-and-portable-agents.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `code`, and `check:book` passes its opening-rotation check
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
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
