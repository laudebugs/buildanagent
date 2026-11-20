# T12: Chapter: Tools: schemas, validation, errors the model can read, and identity it cannot fake

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T12` |
| Status | `done` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "Tools: schemas, validation, errors the model can read, and identity it cannot fake" (`tools`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** How does a model learn what a tool does, what should it be told when a call fails, and why must a tool take identity from trusted context?

## Context

- [SDK guide §4](../../guides/agent-sdk.md)
- [Agent guide §3](../../guides/agent.md): tools, identity from trusted context
- [Anthropic, Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Agent guide](../../guides/agent.md) opening: six of the eight capstones let the model choose whose record to read
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/tools.md`, with `switchTo: [B10]` and `opening: incident` in its front matter
- Sections: Schemas, validation and errors returned as data; Few, workflow-shaped tools with clear names and token-efficient results (Anthropic, writing tools); Identity from trusted context, not from the model (agent guide §3; moved here from the side-effects chapter)
- Listings and at least one replay from: `verify/openai-agents-sdk/examples/02-function-tool.ts`, `verify/google-adk/examples/01-function-tool.ts`, `verify/pi/examples/02-custom-tool.ts`, `verify/claude-agent-sdk/examples/02-custom-tool.ts`
- Figures: a flat figure of one tool call's round trip, from schema to validated input to result; a flat analogy illustration of the vending machine's returned coin and message
- Exercise: Write a tool whose error tells the model what to try next, and watch the replay retry.
- `apps/manual/fact-checks/tools.md`, the chapter's claims log

**Opening:** incident (the previous chapter in the outline opens with code).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| tool schema | a form at a counter with labelled boxes | the model can still fill a box wrongly, so the SDK validates every field | none |
| error returned as data | a vending machine that hands back your coin with a note: exact change only | a model may ignore the note, so the error must say what to try next | flat |
| identity from trusted context | passport control: a border officer who reads your passport, not what you claim at the desk | the host reads the identity from the signed-in session, and the model never sees or carries the passport | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (B10) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/tools.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/tools.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/tools.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `incident`, and `check:book` passes its opening-rotation check
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
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step (checks pass; not pushed: the coordinating session pushes)
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The chapter.** `apps/manual/src/content/chapters/tools.md` opens with the planned incident: our own review of the eight triage capstones in November 2026 found that six let the model fill in whose record to read, and Ada's ticket shows what that costs. Four sections follow, each fact-checked and committed with its rows before the next was drafted:
  1. *The model learns a tool from its name, description and schema, and the SDK checks every argument:* the form-at-a-counter analogy, the four SDKs' tool definitions as tabs with notes, Anthropic's description advice, how each SDK validates, the OpenAI tool call with notes and a replay, and the round-trip figure.
  2. *A failed call comes back as a result the model can read, and it should say what to try next:* the vending machine and its illustration, the ADK retry with notes and a replay, a table of what each SDK sends the model on a failed call, and our recommendation to say what to try next and what not to do.
  3. *Offer a few tools shaped like the work, with clear names and results worth their tokens:* Anthropic's consolidations, our side-effect limit, namespacing with the Claude Agent SDK's `mcp__weather__get_temperature` listing, and token-efficient results.
  4. *Identity comes from the signed-in session, never from the model:* passport control, OWASP LLM06, a table of what each SDK hands a tool beside its arguments, OpenAI's `RunContext` and `isEnabled` warning, the ADK and Copilot capstones that already do it right, and a closing paragraph that restates the contract.
  The exercises add an `errorFunction` to the OpenAI tool and read the retry in its transcript, move identity out of the ADK tool's schema into session state, and redesign a set of order tools on paper. The first two answers were confirmed in scratch edits that were then restored.
- **Listings.** Seven file listings, each with notes and two with replays: a `::::tabs` block of four tool definitions, each with two notes; `#weather-run` with three notes and a replay; `#adk-retry` with two notes and a replay; and `#claude-allowed` with one note. New `// book:note` markers in the four examples, and a `retry` region in the ADK example that replaces two blank lines, so no transcript line moved: each harness's `pnpm test` passes and `results-drift.mjs` reports no drift. Biome moves a marker that follows an opening brace, so the `execute` markers sit on the body's first line.
- **Figures.** `figures/tools/tool-round-trip.ts` draws the ADK call's round trip with the transcript's own values (42, "expected string", "A-1", "order A-1 shipped"); `figures/tools/vending-machine.ts` is the analogy illustration. `test/figures.test.ts` now lists both, and every figure folder's staleness check gets the 60-second limit, because the book's folder ran past Vitest's 5-second default.
- **Analogies.** All three planned analogies are used and registered: a form at a counter (tool schema), the vending machine that hands back your coin with a note (error returned as data, illustrated) and passport control (identity from trusted context). The form's break note says what the todo's did, worded around the clerk.
- **Registers.** Four new sources, each verified in the chapter's log: Anthropic's "Writing effective tools for AI agents", the Claude Agent SDK's custom-tools page, OWASP LLM06:2025 and the OpenAI Agents SDK's context guide at `v0.21.0`. Two new glossary terms, `tool` and `trusted-context`; the chapter tags four.
- **Fact-check.** `apps/manual/fact-checks/tools.md` opens with the research question's answer and holds 90 rows: one block per section, one for the exercises, one for the writing review's re-checks and one for the code reviews' fixes (rows 75–90; row 90 is the medium review's single-message rule for a missing or someone else's order). They tally 82 ✅, 5 ✏️ (rows 26, 35, 63, 68 and 76) and 3 ⚠️ (rows 16, 36 and 45), each ⚠️ a recommendation marked as ours. No source measures how much an actionable error helps a model against a generic one, so the chapter claims no measured gain.
- **Writing review** (5Cs, then BK22's voice check), before → after: coherence 4 → 5, continuity 4 → 5, clarity 4 → 5, concision 4 → 5, cadence 4 → 5. Voice: opening 5 → 5, a concrete example in every section 5 → 5, cadence and second person 4 → 5, no stock phrasing 3 → 5. The review caught one factual slip (the tabs do not define "the same" lookup) and three analogy-break sentences and two replay walk-throughs that reused Chapter 1's sentence frames.
- **Follow-up.** B10, the chapter's only `switchTo` todo, is done, and `book:switch-report` prints "Chapter 3 (tools): B10 done; ready for tabs on our own packages." As BK8 asks, this todo opens [T52](../ready/T52-chapter-tools-on-our-sdk.md), which depends on T50's widened listing rule. T52 notes that our SDK's `ToolContext` carries no app-defined data as of B10, so our identity tab would close over the customer rather than read it from trusted context.
- **Open questions for the owner.**
  1. The identity section has no listing, because the todo names only the four tool examples and none of them reads identity from context. The ADK capstone's `lookup_customer` (`verify/google-adk/examples/08-triage-agent.ts`) shows exactly the pattern; should the chapter list it? *Answered 2026-11-19:* the owner accepted the listing ("yes, i accept these"), and the identity section now lists the tool as `#adk-identity`, with two notes and a replay (rows 91–97 of the chapter's log).
  2. Our SDK's `ToolContext` has no field for trusted, app-defined data such as the signed-in user, which the agent guide's §3 asks for. Is that a gap for a B-series todo?
  3. The Claude Agent SDK's error text for invalid arguments comes from its bundled code, not a run, because the harness has no such example; T49's HTTP transcripts could add one.
