# T15: Chapter: Memory within a task: sessions, threads and resuming

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T15` |
| Status | `done` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "Memory within a task: sessions, threads and resuming" (`memory-and-sessions`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** Where does an agent's memory live between turns and between runs, and what does each SDK keep for you?

## Context

- [Harness guide §2](../../guides/agent-harness.md)
- [Feature table](../../comparison/feature-table.md): the state rows
- [Deep comparison](../../comparison/deep-comparison.md): "State lives in eight places"
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/memory-and-sessions.md`, with `switchTo: [N3, N6]` and `opening: analogy` in its front matter
- Sections: Sessions and threads; Saving and resuming a run, which the next chapter's approvals depend on; Where state lives in each SDK; long-term memory is a later chapter
- Listings and at least one replay from: `verify/openai-agents-sdk/examples/06-session.ts`, `verify/claude-agent-sdk/examples/06-resume-session.ts`, `verify/langchain/examples/05-thread-memory.ts`, `verify/google-adk/examples/04-sessions-state.ts`, `verify/cloudflare-agents/examples/01-state.ts`
- Figures: a flat figure of eight places state can live, one per SDK; a flat analogy illustration of the patient's chart
- Exercise: Resume a session in a fresh process and list what came back and what did not.
- `apps/manual/fact-checks/memory-and-sessions.md`, the chapter's claims log

**Opening:** analogy (the previous chapter in the outline opens with question).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| session | a patient's chart that travels with them between shifts | the model rereads the whole chart on every turn, and pays for every page | flat |
| resume | a bookmark | a resumed run must also restore pending approvals and tool state, not only the place in the text | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N3, N6) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/memory-and-sessions.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/memory-and-sessions.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/memory-and-sessions.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `analogy`, and `check:book` passes its opening-rotation check
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
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The chapter.** `apps/manual/src/content/chapters/memory-and-sessions.md` opens with the planned analogy: a night nurse who knows the day's fever, dose and allergy because the patient's chart travels between shifts, with its flat illustration. Four sections follow, each fact-checked and committed with its rows before the next was drafted:
  1. *A session keeps the conversation between runs, and a thread id names it:* what a run and a session are, two OpenAI runs on one `MemorySession` and two LangChain calls on one thread, each with notes and a replay. The LangChain replay also shows a new thread starting empty, and a call with no `thread_id` that reaches the model and only then throws. The chart's break note (the model rereads, and pays for, the whole session).
  2. *Saving and resuming a run: the saved state comes back, and your code supplies the rest:* the bookmark; when each SDK saves; the Claude Agent SDK's resume in a fresh CLI process, with notes; the two acts of resuming, continuing a conversation and continuing a paused run (OpenAI's `RunState`, LangChain's interrupt), which Chapter 6 builds on; a table of what a resume brings back in five SDKs; who may use a session id (LangChain, Claude and Cloudflare find a session by id alone, ADK by user and id) and four rules of ours; and what a resumed run trusts, including OpenAI's warning that `RunState.fromString()` "does not authenticate the snapshot or the person submitting it" and Cloudflare's client-side `setState`.
  3. *State lives in eight places, one per SDK:* the three-in-the-morning restart, a flat figure of the eight default stores in three bands, a table of default store, durable option, who makes the id and whether lookups are scoped by user, each checked in the pinned package, and ADK's state prefixes and Cloudflare's per-agent state as tabs with notes.
  4. *Long-term memory needs a different store, and a later chapter:* LangChain's checkpointer-and-store line, and pointers to Chapters 11, 12 and 6.
  The exercises resume an OpenAI session from saved items as a fresh process would, resume a Claude session that was never saved, and check that ADK refuses another user's session id before designing the same check for LangChain. Each was followed as written in a scratch copy, which was then discarded.
- **Listings.** Six file listings from the five examples the todo names: `#session-openai` (three notes, replay), `#thread-langchain` (three notes, replay), `#resume-claude` (two notes; the Claude Agent SDK has no transcript until T49), and a `::::tabs` block of `#state-adk` (four notes) and `#state-cloudflare` (three notes). The `// book:note` markers moved no line: every harness's `pnpm test` passes, no transcript changed, and `results-drift.mjs` reports no drift. Biome moves a marker that follows an opening brace, so Cloudflare's `on-change` marker sits on the hook's first body line.
- **Figures.** `figures/memory-and-sessions/patients-chart.ts` (the analogy illustration) and `state-places.ts` (the eight default stores, labelled from the pinned packages); `test/figures.test.ts` lists both.
- **Analogies.** Both planned analogies are used and registered: the patient's chart (session, illustrated) and a bookmark (resume). The bookmark's break note says "some SDKs", not the todo's implied "most", because the chapter's own table shows OpenAI, LangChain and Cloudflare bringing back more than the conversation.
- **Registers.** Nine new sources, each verified in the chapter's log: OpenAI's sessions and human-in-the-loop guides at `v0.21.0`, LangChain's persistence and checkpointers pages at `9d9747d`, the Claude Agent SDK's sessions and hosting pages, ADK's state page at `ff7a5f5`, and Cloudflare's state and routing pages at `agents@0.33.0`. Two new glossary terms, `session` and `checkpointer`; the chapter also tags `trusted-context`, `prompt-injection` and `approval`.
- **Fact-check.** `apps/manual/fact-checks/memory-and-sessions.md` opens with the research question's answer, the outline and the analogy vetting, then holds 93 rows: one block per section, one for the exercises and one for the writing review's re-checks. They tally 87 ✅, 3 ✏️ (rows 87–89) and 3 ⚠️ (rows 42, 45 and 74), each ⚠️ a recommendation or reading marked as ours.
- **Writing review** (5Cs, then BK22's voice check), before → after: coherence 4 → 5, continuity 4 → 5, clarity 4 → 5, concision 4 → 5, cadence 4 → 5. Voice: opening 5 → 5, a concrete example in every section 5 → 5, cadence and second person 4 → 5, no stock phrasing 3 → 5. The review caught one factual overreach ("most SDKs bring back the conversation alone"), a heading that undersold OpenAI's `RunState`, and three frames reused from Chapters 2 and 3.
- **Follow-up.** The chapter's `switchTo` todos, N3 and N6, are not done on `main`, and `book:switch-report` prints "N3 not done, N6 not done", so this todo opens no tabs todo. When both are done, their pull request opens one (BK8, ADR 0057).
- **Open questions for the owner.**
  1. The ownership section has no listing, because none of the five named examples checks a session's owner. A small example that refuses another user's thread, for LangChain or the Claude Agent SDK, would let the chapter show the four rules in code.
  2. Our SDK's session store (N3) could file sessions by user and id, as ADK does, so the check cannot be forgotten. Should N3's interface take the user?
  3. The Claude resume has no replay until T49 records Claude transcripts.
