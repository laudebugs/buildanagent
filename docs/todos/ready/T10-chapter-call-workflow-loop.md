# T10: Chapter: Use the least autonomy that works: a call, a workflow, then a loop

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T10` |
| Status | `ready` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T7](../done/T7-book-isometric-figures.md), [T26](T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "Use the least autonomy that works: a call, a workflow, then a loop" (`call-workflow-loop`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** When does a single model call do the job, when does a fixed workflow, and what makes a task need an agent loop?

## Context

- [Agent guide §2](../../guides/agent.md): choose the least autonomy the task allows
- [Anthropic, Building effective agents](https://www.anthropic.com/engineering/building-effective-agents): "finding the simplest solution possible, and only increasing complexity when needed"; workflows versus agents; five workflow patterns
- [Feature table](../../comparison/feature-table.md), its opening: "a model calls tools in a loop until a stop condition holds"
- [SDK guide §1 and §3](../../guides/agent-sdk.md): the loop's contract and its stop reasons
- The `verify/<sdk>/README.md` files: what each harness mocks
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/call-workflow-loop.md`, with `switchTo: [B11]` and `opening: scenario` in its front matter
- Sections: One model call, then a fixed workflow in code, then the loop, in that order (agent guide §2; Anthropic's workflow patterns); The loop: a model calls tools until a stop condition holds; A box, "How these examples run without a key": every listing in the book runs against a mock model, explained in full in the testing chapter
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/01-generate-text.ts` (one call), `verify/google-adk/examples/02-workflow-agents.ts` (a fixed workflow), `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, `verify/pi/examples/01-hello-session.ts`
- Figures: a flat analogy illustration of the kitchen ticket rail, placed just before the centerpiece; an isometric centerpiece of the loop as an exact technical diagram the reader steps through, with real labels (context, model call, `tool_result`, append); a flat figure of a call, a workflow and a loop side by side, with who decides the next step in each
- Exercise: Turn the fixed workflow into a loop, predict how many model calls the loop makes, then run both and compare.
- `apps/manual/fact-checks/call-workflow-loop.md`, the chapter's claims log

**Opening:** scenario.

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| agent loop | a kitchen ticket rail: the cook works one ticket, calling for ingredients, until it is done | a cook remembers yesterday's orders; a model sees only what the transcript carries | flat |
| fixed workflow | an assembly line with fixed stations | each station here is a model call that can still return something unexpected | none |
| mock model | a flight simulator | it replays only what was scripted, so it cannot surprise you the way a real model can | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (B11) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/call-workflow-loop.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/call-workflow-loop.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline and the centerpiece with T7's, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] The centerpiece prints `audit passed` and `line ends: 0` in `figures:audit`
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/manual/fact-checks/call-workflow-loop.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [ ] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [ ] The front matter's `opening` is `scenario`, and `check:book` passes its opening-rotation check
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
