# T35: Chapter: Agents people can watch: UIs, browsers and taking over

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T35` |
| Status | `done` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md), [T40](../done/T40-example-computer-use.md) |
| Size | M |

## Goal

Write the chapter "Agents people can watch: UIs, browsers and taking over" (`agents-people-can-watch`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** How should a person see, steer and take over an agent, in a UI and in a browser, when prompt injection makes the network and the credential the boundary?

## Context

- [Agent UI research](../../research/agent-ui/agent-ui-research.md)
- [Undo agent edits](../../research/agent-ui/undo-agent-edits.md)
- [Browser use](../../research/browser-use/browser-use.md), including its watch-and-take-over section ([U16](../done/U16-watch-and-take-over-the-browser.md))
- The computer-use example, `verify/openai-agents-sdk/examples/13-computer-use-approval.ts` ([T40](../done/T40-example-computer-use.md)), has regions `fake-computer`, `computer-tool`, `script`, `pause` and `resume`, with notes `consequential`, `batch`, `pay`, `save` and `pause`, and a transcript for a replay. Two limits carry into the prose. First, the computer is an in-memory fake and the model is scripted, so the example shows the SDK's computer-tool loop and approval flow, not how a real model or browser behaves; the browser reports and the real-browser change stay separate. Second, an action that throws gives the model an empty screenshot instead of an error, so a chapter that teaches failure handling must check the computer's own record ([fact-check](../../plans/reviews/fact-check-openai-computer-use-example.md), rows T40-9 for the empty screenshot, T40-10 for the not-a-real-browser limit, T40-13 for the rejection result and T40-15 for the recorder).
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/agents-people-can-watch.md`, with `switchTo: [N44]` and `opening: question` in its front matter
- Sections: Agent UIs render an event log, not a chat (agent UI research); Undo for agent edits; Browser use: accessibility snapshots, hosted browsers and vendor computer-use tools; Watching and taking over the browser (U16); Why the network and the credential are the browser's boundary
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/06-streaming.ts` read as a UI event stream, `verify/cloudflare-agents/examples/04-chat-agent.ts`, the computer-use example from [T40](../done/T40-example-computer-use.md)
- Figures: a flat figure of one event log feeding a chat view, a plan view and a review view; a flat analogy illustration of the dual-control car
- Exercise: Replay a run's event log into two different views and show they agree.
- `apps/manual/fact-checks/agents-people-can-watch.md`, the chapter's claims log

**Opening:** question (the previous chapter in the outline opens with incident).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| UI as a view of the event log | an election-results board driven by the official count | a UI can also send events back, such as an approval, which a results board never does | none |
| browser takeover | a driving instructor's dual controls | the agent must pause and record that a person took over, or it will fight the person for the wheel | flat |
| accessibility snapshot | describing a room by its labelled objects instead of sending a photo | labels can be missing or wrong, so some pages still need a screenshot | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N44) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/agents-people-can-watch.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/agents-people-can-watch.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/agents-people-can-watch.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `question`, and `check:book` passes its opening-rotation check
- [x] The pull request records the writing review's 5C scores and its voice scores, before and after
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job; the harness tests for any example whose markers changed.

> **Scope note (2026-11-22):** the chapter does not list `verify/cloudflare-agents/examples/04-chat-agent.ts`, because that example has no region markers and the event-log section already shows a typed stream with the AI SDK's `stream-parts` region. A listing of the Cloudflare chat agent is a candidate for the follow-up that adds our packages' tabs.

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
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
