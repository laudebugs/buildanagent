# T13: Chapter: Stopping: caps, stop conditions and structured output

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T13` |
| Status | `done` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "Stopping: caps, stop conditions and structured output" (`stopping-and-structured-output`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** When does an agent stop, who decides, and how does a program get a typed answer out of it?

## Context

- [SDK guide §3](../../guides/agent-sdk.md)
- [Feature table](../../comparison/feature-table.md): the loop-control and output rows
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/stopping-and-structured-output.md`, with `switchTo: [B11, B14]` and `opening: question` in its front matter
- Sections: Step and turn caps, and their defaults across the SDKs; Stop conditions and stop reasons; Structured output and what a schema does not guarantee
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts`, `verify/claude-agent-sdk/examples/04-max-turns.ts`, `verify/langchain/examples/06-recursion-limit.ts`, `verify/vercel-ai-sdk/examples/05-structured-output.ts`
- Figures: a flat figure of the SDKs' default caps on one scale, from one step to 500 model calls; a flat analogy illustration of the jelly mould
- Exercise: Set a cap one step below what the task needs and read the stop reason.
- `apps/manual/fact-checks/stopping-and-structured-output.md`, the chapter's claims log

**Opening:** question (the previous chapter in the outline opens with incident).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| step cap | a bus ticket good for a fixed number of stops | SDKs count steps, turns and model calls differently, so the same number means different things | none |
| structured output | a jelly mould | a schema fixes the shape of the answer, never its truth | flat |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (B11, B14) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/stopping-and-structured-output.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/stopping-and-structured-output.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/stopping-and-structured-output.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `question`, and `check:book` passes its opening-rotation check
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
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The chapter.** `apps/manual/src/content/chapters/stopping-and-structured-output.md` opens with the planned question, how many times an agent may call its model before something stops it, and answers it with the eight SDKs' defaults, from one call to five hundred, while Pi and the Claude Agent SDK set none and the Copilot SDK exposes none. Three sections follow, each fact-checked and committed with its rows before the next was drafted:
  1. *A cap ends the run wherever it is, and each SDK counts it in its own unit:* the bus ticket, three capped loops as tabs (AI SDK, LangChain, Claude Agent SDK) with notes, the units each SDK counts, a table of defaults and what each does at the cap, the default-caps figure, the Copilot timeout that is no cap, our cap-sizing recommendation and the Claude Agent SDK's post-response spend cap.
  2. *A run has two stop reasons: why the model stopped writing, and why the loop stopped calling it:* the finish reason against the run's outcome, how each SDK reports a cap (a result subtype, a throw, or nothing for an explicit AI SDK cap), and a done tool with `hasToolCall`, listed with notes and a replay.
  3. *A schema fixes the shape of the answer, never its truth:* the jelly mould and its illustration, the AI SDK's triage schema and `Output.object` with notes and a replay, the rejected and the wrong-but-valid answers, the step an answer needs under a cap, a table of what each SDK does with an answer that breaks the schema, the limits of Anthropic's constrained decoding, and three habits. A closing paragraph restates the three answers.
  The exercises cap the done-tool run one step short and read its stop reason, give a structured answer the step it needs, and write a refund agent's stop policy on paper. The first two were followed exactly as written and restored with `git checkout`.
- **Listings.** Six file listings: a tabs block of three (`#cap-ai`, `#cap-langchain`, `#cap-claude`, the last two with notes), `#stop-on-done` with two notes and a replay, `#triage-schema`, and `#triage-output` with two notes and a replay. New `// book:note` markers on existing lines of the four examples, so no transcript line moved: each harness's `pnpm test` passes and `results-drift.mjs` reports no drift. Biome moves a marker that ends a line with an open brace or parenthesis, so markers sit on lines that end a statement or a property. The Claude Agent SDK listing has no replay, because its harness records no transcript until T49.
- **Figures.** `figures/stopping-and-structured-output/default-caps.ts` puts six default caps on one logarithmic scale of model calls (1, 10, 10, 13, 20 and 500) with a box below for Pi and the Claude Agent SDK, which set no default cap, and the Copilot SDK, which exposes none, each value checked in its pinned package; `jelly-mould.ts` is the analogy illustration, drawn from the example's own answers. `test/figures.test.ts` lists both.
- **Analogies.** Both planned analogies are used and registered: the bus ticket (step cap, no illustration) and the jelly mould (structured output, illustrated). The mould's break note adds that most SDKs check after the model writes, which the todo's note left out.
- **Registers.** Seven new sources, each verified in the chapter's log: the AI SDK's Loop Control and Generating Structured Data pages, LangChain's Graph API overview, the OpenAI Agents SDK's Running Agents guide at `v0.21.0`, the Claude Agent SDK's agent-loop and structured-output pages, and Anthropic's structured-outputs page. Two new glossary terms, `stop-reason` and `structured-output`; the chapter tags five.
- **Fact-check.** `apps/manual/fact-checks/stopping-and-structured-output.md` opens with the research question's answer and holds 82 rows: one block per section, one for the writing review's re-checks, one for the exercises and one for the code reviews' fixes (rows 76–82). They tally 75 ✅, 4 ✏️ (rows 7, 38, 46 and 65) and 3 ⚠️ (rows 26, 63 and 81), each ⚠️ a recommendation marked as ours. No source measures how often real agents hit a default cap, so the chapter claims no rate.
- **Writing review** (5Cs, then BK22's voice check), before → after: coherence 4 → 5, continuity 4 → 5, clarity 4 → 5, concision 4 → 5, cadence 4 → 5. Voice: opening 5 → 5, a concrete example in every section 5 → 5, cadence and second person 4 → 5, no stock phrasing 3 → 5. The review found 14 issues: one factual slip (row 65), six sentence frames already used in Chapters 1–3, a citation covering numbers its source does not state, an over-long paragraph, three heads that over-promised or pointed backwards, and four emphatic "at all"s.
- **Follow-up.** B11 and B14, the chapter's `switchTo` todos, are done, and `book:switch-report` prints "Chapter 4 (stopping-and-structured-output): B11 done, B14 done; ready for tabs on our own packages." As BK8 asks, this todo opens [T54](../done/T54-chapter-stopping-on-our-sdk.md), which depends on T50's widened listing rule.
- **Open questions for the owner.**
  1. The Claude Agent SDK listing cannot replay until T49 records its transcripts; should T49 add a replay to `#cap-claude` when it lands?
  2. The default-caps figure shows Cloudflare Think's `maxSteps` and leaves out `AIChatAgent`, whose cap is whatever the caller passes to `streamText`; is that the right representative for Cloudflare Agents?

