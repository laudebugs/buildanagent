# T11: Chapter: Talking to a model: messages, streams, tokens, instructions and model choice

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T11` |
| Status | `ready` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T6](../ongoing/T6-book-flat-figures.md), [T26](T26-book-checked-inline-code.md), [T28](T28-example-streaming-usage.md) |
| Size | M |

## Goal

Write the chapter "Talking to a model: messages, streams, tokens, instructions and model choice" (`talking-to-a-model`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** What does a program send to a model and get back, what belongs in the system prompt, and how should a builder choose a model?

## Context

- [SDK guide §2](../../guides/agent-sdk.md)
- [Agent guide §4](../../guides/agent.md): the system prompt stays short and frozen
- [Anthropic, Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenAI, A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf), "Selecting your models"
- [Harness plan HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional): the thinking prefix check
- ADRs [0002](../../decisions/0002-first-wire-protocols.md), [0003](../../decisions/0003-token-usage-fields.md) and [0004](../../decisions/0004-cost-catalog-and-basis.md)
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/talking-to-a-model.md`, with `switchTo: [B4, B5]` and `opening: code` in its front matter
- Sections: Messages, roles and a stateless call; Streams of deltas that fold into one authoritative message; Usage, the four token classes and cost; The system prompt: short and frozen (agent guide §4); Choosing a model: start with the most capable, then try smaller ones against evals (OpenAI guide); Reasoning and thinking blocks, and why they go back unchanged (SDK guide §2; harness plan HD3)
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/01-generate-text.ts`, `verify/vercel-ai-sdk/examples/06-streaming.ts`, `verify/langchain/examples/08-streaming.ts`, `verify/copilot-sdk/examples/05-streaming.ts`, the streaming-and-usage example from [T28](T28-example-streaming-usage.md)
- Figures: a flat figure of a transcript of messages with roles; a flat figure of a stream of deltas folding into one message, with the four token classes; a flat analogy illustration of the taxi meter
- Exercise: Price a recorded run from its usage, then rerun it with a smaller model and compare the cost and the checks.
- `apps/manual/fact-checks/talking-to-a-model.md`, the chapter's claims log

**Opening:** code (the previous chapter in the outline opens with scenario).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| stateless call | a pharmacist who sees only the prescription slip in front of them | the model can be handed far more than a slip, and everything it is handed costs tokens | none |
| tokens and cost | a taxi meter that runs on both legs of the trip | cached input is billed at a discount; a taxi has no such fare | flat |
| system prompt | the briefing card a tour guide carries on every tour | the model cannot ask what the card means, and a changed card breaks the cache | none |
| streaming | a news ticker | the deltas are provisional; the message at the end is the one that counts | none |
| model choice | casting the lead with the most experienced actor, then trying understudies in the same scenes | a model does not improve with rehearsal; only the prompt and the evals do | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (B4, B5) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/talking-to-a-model.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/talking-to-a-model.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/manual/fact-checks/talking-to-a-model.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [ ] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
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
- An analogy can mislead a newcomer more than no analogy; the vetting task and the "where it breaks" note catch it. A weak analogy is dropped, or goes back to the owner with a proposed replacement, instead of being forced in.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
