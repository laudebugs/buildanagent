# T11: Chapter: Talking to a model: messages, streams, tokens, instructions and model choice

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T11` |
| Status | `done` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md), [T28](../done/T28-example-streaming-usage.md) |
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
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/01-generate-text.ts`, `verify/vercel-ai-sdk/examples/06-streaming.ts`, `verify/langchain/examples/08-streaming.ts`, `verify/copilot-sdk/examples/05-streaming.ts`, `verify/vercel-ai-sdk/examples/10-streaming-usage.ts` from [T28](../done/T28-example-streaming-usage.md)
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

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (B4, B5) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/talking-to-a-model.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/talking-to-a-model.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/talking-to-a-model.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
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
- **A replay cannot price a run yet.** A transcript has no usage field. Its model ids become `model-1`, `model-2`, so neither replay of T28's examples shows token classes, prices or which call used the tuned model. The exercise "Price a recorded run from its usage" therefore works from the listing and the example's `check()` lines. Propose a follow-up todo that adds each response's usage and the model's own id to the transcript format (`scripts/transcripts/` and the AI SDK's `lib/transcript.ts`); T28 leaves T5's format unchanged.
- An analogy can mislead a newcomer more than no analogy; the vetting task and the "where it breaks" note catch it. A weak analogy is dropped, or goes back to the owner with a proposed replacement, instead of being forced in.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step (checks pass; not pushed: the coordinating session pushes)
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The chapter.** `apps/manual/src/content/chapters/talking-to-a-model.md` opens with code, as planned: Anthropic's second request of a conversation, whose middle message resends the model's own "Hello!". Six sections follow, each fact-checked and committed with its rows before the next was drafted:
  1. *A call sends the whole conversation, and every message has a role:* the four AI SDK roles, the resent-history figure from the LangChain run, and the AI SDK's refusal of a `system` message inside `messages`, with notes and a replay.
  2. *A stream hands you the answer in pieces, and the message at the end is the one that counts:* the AI SDK text stream with notes and a replay, then tabs for the AI SDK, LangChain and Copilot SDK streams, and the final message as the authoritative one.
  3. *Every call runs a meter, and tokens fall into four classes with four prices:* the taxi-meter illustration, T28's usage listing with notes and a replay, the rates listing, the stream-fold figure, cache and thinking prices.
  4. *Keep the system prompt short, and freeze it for the session:* Anthropic's minimal-prompt advice, what stays off the card, and why it stays frozen (the prompt cache and the thinking prefix check).
  5. *Choose a model by starting with the most capable, then trying smaller ones against your evals:* OpenAI's method and three principles, the Claude 5.5 rate table, and our cost-per-passing-task recommendation.
  6. *Thinking comes back with a signature, and it goes back unchanged:* the thinking block, tool-use turns, the prefix check's three habits, streaming and model switches.
  The three exercises price the recorded run on Haiku 5.5, count stream deltas, and sort five changes by whether they break the prefix check; a scratch run confirmed the first two, and the prefix-check page answers the third.
- **Listings.** Nine: two `:::listing` snippets from Anthropic's docs (no file) and seven file listings, three with replays (`01-generate-text` region `system-in-messages`, `06-streaming` region `text-stream`, `10-streaming-usage` region `stream-usage`) and notes on three; one tabs block of three SDKs (`06-streaming` `stream-parts`, LangChain `08-streaming` `updates`, Copilot `05-streaming` `deltas`); and `lib/rates.ts` region `rates`. New markers: the region `system-in-messages` with three notes in `01-generate-text.ts`, which moved four `line` fields in its committed transcript; two notes in `06-streaming.ts` and one in `10-streaming-usage.ts`, which moved nothing. `10-streaming-usage.ts` now reads `result.usage`, because `ai@7.0.162` deprecates `totalUsage`; its results are unchanged. The Copilot listing has no replay, because that harness records no transcript yet (T49).
- **Figures.** Three flat figures: `resent-history` (the LangChain run's two requests), `stream-fold` (the eleven deltas, the folded message and the four priced classes) and `taxi-meter`, the analogy illustration. `figures:build` reports none stale; `figures:audit` passes (it audits only isometric figures).
- **Analogies.** Four of the five planned analogies are used and registered: the news ticker (streaming), the taxi meter (tokens and cost, illustrated), the tour guide's briefing card (system prompt) and casting with understudies (model choice). The high review dropped the pharmacist's slip (stateless call), because it restated Chapter 1's point that a call is stateless; analogies are optional (BK22), so the first section now opens on the request itself, and the slip's register entry is gone. The approved table above keeps it. None was swapped.
- **Registers.** Thirteen new sources, each verified in the chapter's log: Anthropic's Messages API guide, pricing, thinking, prompt caching, prefix checks, preserved thinking and glossary pages; Anthropic's "Effective context engineering"; the AI SDK's prompts, generating-text and `streamText` pages; LangChain's streaming page; and the Copilot SDK's streaming-events page at `v1.0.31`. The chapter also cites two existing sources. Five new glossary terms, all tagged: token, system prompt, delta, prompt cache and thinking block.
- **Fact-check.** `apps/manual/fact-checks/talking-to-a-model.md` opens with the research question's answer and holds 121 rows in ten blocks: one per section, the exercises, the glossary, the re-checks after the writing review and the re-checks after the high review. The tally is 108 ✅, 9 ✏️ (rows 12, 17, 24, 38, 49, 91, 93, 103 and 108) and 4 ⚠️ (rows 16, 31, 57 and 75), each ⚠️ a recommendation marked as ours in the text. The sources give no measured comparison of a large and a small model on one agent task, so the chapter prices the scripted usage and leaves quality to the reader's evals.
- **Writing review** (5Cs, then BK22's voice check), before → after: coherence 4 → 5, continuity 4 → 5, clarity 4 → 5, concision 4 → 5, cadence 4 → 5. Voice: opening 5 → 5, a concrete example in every section 5 → 5, cadence and second person 4 → 5, no stock phrasing 3 → 5 (four frames shared with Chapter 1 replaced).
- **Checks.** Each of these passes: `pnpm check`, `pnpm typecheck`, the manual's build, test (342 Vitest and 154 script tests) and `check:book`, `figures:build` with no stale figure, `figures:audit`, the AI SDK's and LangChain's `pnpm test`, `scripts/ci/results-drift.mjs`, `pnpm fact-check-logs` and the link checker. The Copilot SDK's harness, whose example the chapter lists unchanged, needs Linux's `unshare` and was not run here.
- **Follow-ups.** B4 and B5, the chapter's `switchTo` todos, are done on `main`, and `book:switch-report` prints "Chapter 2 (talking-to-a-model): B4 done, B5 done; ready for tabs on our own packages." As BK8 asks, this todo opens [T51](../ready/T51-chapter-talking-to-a-model-on-our-sdk.md). This todo's risk on replays stands: a transcript records no usage and names models `model-N`, so the usage replay shows the counts only in its check messages. We propose a follow-up todo that adds each response's usage and model id to the transcript format (`scripts/transcripts/` and the AI SDK's `lib/transcript.ts`); it needs the owner's go-ahead. Section T39 should switch `11-tuned-vs-cached.ts` to `result.usage` too.

