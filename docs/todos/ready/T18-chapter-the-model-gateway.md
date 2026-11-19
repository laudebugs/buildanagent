# T18: Chapter: The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T18` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T6](T6-book-flat-figures.md), [T26](T26-book-checked-inline-code.md), [T29](T29-example-retries-caching-budget.md) |
| Size | M |

## Goal

Write the chapter "The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost" (`the-model-gateway`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and an analogy for each core concept, and ends with an exercise the reader can run offline. **Research question:** What belongs between the loop and a provider, and why do retries, caching, reasoning replay and cost accounting all sit there?

## Context

- [SDK guide §2](../../guides/agent-sdk.md)
- [SDK plan](../../plans/build-sdk.md) D2–D4 and D9
- ADRs [0002](../../decisions/0002-first-wire-protocols.md)–[0004](../../decisions/0004-cost-catalog-and-basis.md) and [0009](../../decisions/0009-pre-emptive-budget.md)
- [Agent guide §8](../../guides/agent.md): the cached preamble
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog): deterministic `tools/list` order "to improve LLM prompt cache hit rates"
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/book/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/book/src/content/chapters/the-model-gateway.md`, with `switchTo: [B4, B5, B8, B9]` and `opening: code` in its front matter
- Sections: One streaming method over two wire protocols; Retries and their limits; Prompt caching: a stable prefix, and MCP's request for a deterministic `tools/list` order; Replaying reasoning across providers: drop foreign signatures (SDK guide §2); Cost accounting and the pre-call budget (the evals chapter no longer carries cost)
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/04-prepare-step.ts`, `verify/vercel-ai-sdk/examples/06-streaming.ts`, the retries, caching and budget example from [T29](T29-example-retries-caching-budget.md)
- Figures: a flat figure of one gateway method under two wire protocols; a flat figure of a pre-call budget check against a projected cost; a flat analogy illustration of the printer's letterhead plate
- Exercise: Project the cost of the next call from a transcript, decide whether the budget allows it, and see the cache-read tokens on a repeated prefix.
- `apps/book/fact-checks/the-model-gateway.md`, the chapter's claims log

**Opening:** code (the previous chapter in the outline opens with fact).

**Analogies** (BK22: one per core concept, distinct across the book; vet each before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| model gateway | a switchboard operator who connects any call and logs its minutes | the gateway also rewrites messages between protocols, which an operator never does | none |
| retries | redialling a busy line, waiting longer each time | some failures are not busy signals: a rejected request will fail every time | none |
| prompt caching | a printer that keeps the letterhead plate set between jobs | any change in the prefix, even a reordered tool, resets the plate | flat |
| pre-call budget | a prepaid card checked before each purchase | the price of a call is projected, not known, until it returns | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (B4, B5, B8, B9) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` markers and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains, check it does not imply anything false, and replace it if it does or if `analogies.json` already uses it.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/book/fact-checks/the-model-gateway.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Open each core concept with its analogy from the table above, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note; register every analogy in `apps/book/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, an analogy for every core concept, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/book/fact-checks/the-model-gateway.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/book/fact-checks/the-model-gateway.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
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
