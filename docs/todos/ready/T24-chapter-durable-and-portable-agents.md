# T24: Chapter: Durable and portable agents, and how work reaches them

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T24` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T6](T6-book-flat-figures.md), [T26](T26-book-checked-inline-code.md), [T33](T33-example-durability.md) |
| Size | M |

## Goal

Write the chapter "Durable and portable agents, and how work reaches them" (`durable-and-portable-agents`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and an analogy for each core concept, and ends with an exercise the reader can run offline. **Research question:** What does it take for an agent to sleep, wake and run on Cloudflare, AWS or Vercel with one code base, and how do triggers reach it once?

## Context

- [Portable agents report](../../research/deployment/portable-agents.md) ("Seven seams") and the [storage-and-wake note](../../research/deployment/storage-and-wake.md)
- ADR [0033](../../decisions/0033-three-deployment-targets.md) (seven seams) and ADR [0043](../../decisions/0043-standalone-safety-core.md) (`EffectStore`, the eighth)
- [12-factor agents](../../research/external-designs/twelve-factor-agents.md): the ingress gap
- [Coding agent plan](../../plans/build-coding-agent.md) CA3 and CA7
- [Agent-building platforms](../../research/deployment/agent-building-platforms.md)
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/book/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/book/src/content/chapters/durable-and-portable-agents.md`, with `switchTo: [N41–N48]` and `opening: code` in its front matter
- Sections: Durability: state, wake and resume on Cloudflare (the only target `verify/` runs); The seven seams of ADR 0033 plus `EffectStore` from ADR 0043, and what AWS and Vercel need; Ingress and triggers: one design, deduplicated by id (12-factor agents, factor 11; coding agent plan CA7)
- Listings and at least one replay from: `verify/cloudflare-agents/examples/02-sql.ts`, `verify/cloudflare-agents/examples/03-scheduling.ts`, `verify/cloudflare-agents/examples/08-hibernation.ts`, the durability example from [T33](T33-example-durability.md)
- Figures: a flat figure of the seven seams plus `EffectStore`, and their implementation on each target; a flat analogy illustration of shipping containers
- Exercise: Schedule a wake, hibernate, and list what the agent must reload; then send the same trigger twice and show one task starts.
- `apps/book/fact-checks/durable-and-portable-agents.md`, the chapter's claims log

**Opening:** code (the previous chapter in the outline opens with incident).

**Analogies** (BK22: one per core concept, distinct across the book; vet each before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| durable wake | an alarm clock with a note on the bedside table saying where you left off | alarms can fire twice, so the note must make a second wake harmless | none |
| portable seams | standard shipping containers that fit any ship, crane and truck | each port still needs its own crane: every target needs its own adapter | flat |
| ingress deduplication | a mailroom that stamps each letter's number and bins duplicates | the number must come from the sender, such as a webhook's delivery id | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (N41–N48) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` markers and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains, check it does not imply anything false, and replace it if it does or if `analogies.json` already uses it.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/book/fact-checks/durable-and-portable-agents.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Open each core concept with its analogy from the table above, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note; register every analogy in `apps/book/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, an analogy for every core concept, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/book/fact-checks/durable-and-portable-agents.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/book/fact-checks/durable-and-portable-agents.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [ ] Every core concept opens with its analogy and has a "Where the analogy breaks" note; every analogy is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [ ] The front matter's `opening` is `code`, and `check:book` passes its opening-rotation check
- [ ] The pull request records the writing review's 5C scores and its voice scores, before and after
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job; the harness tests for any example whose markers changed.

## Docs to update

- The plan's §4 row if the chapter's sources or examples change
- The glossary, the source register and the analogy register

## Risks and open questions

- A source may not answer the research question; record the gap as a follow-up research todo instead of answering from memory.
- An analogy can mislead a newcomer more than no analogy; the vetting task and the "where it breaks" note are there to catch it, and a weak analogy is dropped, not forced.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
