# T10: Chapter: Use the least autonomy that works: a call, a workflow, then a loop

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T10` |
| Status | `done` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T7](../done/T7-book-isometric-figures.md), [T26](../done/T26-book-checked-inline-code.md) |
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

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/call-workflow-loop.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/call-workflow-loop.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline and the centerpiece with T7's, each with alt text and a caption that cites the register. Name the centerpiece `figures/call-workflow-loop/loop-bench.ts`, or change the id in `GallerySamples.astro`: the component gallery shows that figure once per theme as its isometric sample and leaves the item out until it exists (T7).
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] The centerpiece prints `audit passed` and `line ends: 0` in `figures:audit`
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/call-workflow-loop.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `scenario`, and `check:book` passes its opening-rotation check
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
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step (not pushed: the coordinating session pushes)
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The chapter.** `apps/manual/src/content/chapters/call-workflow-loop.md` opens with the planned scenario, three support requests on a Monday, and has six sections, each fact-checked and committed with its rows before the next was drafted:
  1. *Start with one model call, and stop there if it does the job:* one `generateText` call with three notes and a replay.
  2. *When you know the steps in advance, write them down as a workflow:* a writer-then-reviewer chain on ADK's `SequentialAgent`, with notes, a replay and the 2.5.0 deprecation dated November 2026.
  3. *The loop: a model calls tools until a stop condition holds:* Anthropic's five-step tool-use cycle, the ticket-rail illustration, the isometric bench, the AI SDK weather tool and tool loop with notes and a replay, and `stopWhen` with its one-step default.
  4. *A harness keeps the session and brings its own tools:* what Pi adds around the loop that `generateText` lacks, its context assembly, default tools and session, shown in Pi's `session.prompt()` listing with notes and a replay.
  5. *Choose the shape by asking who decides the next step:* the who-decides figure, a table of the three shapes, our four questions, and our recommendation to combine the shapes.
  6. *How these examples run without a key:* the todo's box, written as a short section because the book has no box component; it lists the AI SDK `scripted` helper from `examples/lib/check.ts`.
  The exercises turn the ADK workflow into a `LoopAgent` with predicted call counts, give the AI SDK loop a second lookup under two caps, and sort three tasks.
- **Listings.** Six file listings, five of them interactive: notes on four, replays on four (`01-generate-text`, `02-workflow-agents`, `02-tool-loop`, `01-hello-session`). New `// book:note` markers in those four examples; each harness's `pnpm test` passes and `results-drift.mjs` reports no drift, so no transcript changed. The first code review's fix rewrapped the marked lines that ran past 120 columns, which moved the `line` fields of two transcripts, `01-generate-text` and `02-workflow-agents`; their runs are otherwise unchanged.
- **Figures.** The kitchen ticket rail moved from the fixture book into `figures/call-workflow-loop/ticket-rail.ts` unchanged, and both fixtures now re-export it. The new centerpiece `figures/call-workflow-loop/loop-bench.ts` is a bench with a context rack, a model call, a tool and two trays, labelled context, append, model call, tool, `tool_result` and answer, and it lights six steps in the order of the AI SDK loop's transcript. It prints `audit passed` and `line ends: 0` in both themes. `who-decides` is reused, its workflow column redrawn after the first code review to show the chapter's writer and reviewer. The gallery now shows the book's own bench.
- **Analogies.** All three planned analogies are used and registered: the kitchen ticket rail (agent loop, illustrated), the assembly line (fixed workflow) and the flight simulator (mock model). The ticket rail's break note says "context" where the todo said "transcript", the chapter's term for the same thing. None was dropped and none needs the owner.
- **Registers.** Five new sources, each verified in the chapter's log: the AI SDK `generateText` reference and testing page, ADK's sequential-agent page (now on adk.dev), Anthropic's "How tool use works" and Pi's "How Pi Works" at `v1.5.2`. Two new glossary terms, `stop-condition` and `mock-model`; the chapter tags six.
- **Fact-check.** `apps/manual/fact-checks/call-workflow-loop.md` opens with the research question's answer and holds 99 rows in eight blocks, the last two the re-checks after the writing review and after the first code review: 88 ✅, 7 ✏️ and 4 ⚠️, each ⚠️ an opinion marked as ours in the text. The sources measure no workflow against a loop on one task with the model held fixed, so the chapter claims no measured gain for either.
- **Writing review** (5Cs, then BK22's voice check), before → after: coherence 4 → 5, continuity 4 → 5, clarity 4 → 5, concision 4 → 5, cadence 4 → 5. Voice: opening 5 → 5, a concrete example in every section 5 → 5, cadence and second person 4 → 5, no stock phrasing 3 → 5.
- **Checks.** `pnpm check`, `pnpm typecheck`, the manual's build, test (300 tests) and `check:book`, `figures:build` with no stale figure, `figures:audit` and the three touched harnesses' `pnpm test` pass. `pnpm -r --no-bail test` passes for every package except `verify/copilot-sdk`, which needs Linux's `unshare` here as on `main`. Its first run timed out the manual's real-book `check:book` test at Vitest's 5-second default, because that test now renders this chapter; the test now takes 60 seconds, as the figure tests do. A trial merge with `main` at `afc9ea2` (T27, T28 and #88) merged cleanly and passed `check:book` and the manual's 305 tests.
