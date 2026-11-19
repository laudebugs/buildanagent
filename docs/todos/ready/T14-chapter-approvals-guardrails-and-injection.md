# T14: Chapter: Asking before acting: approvals, guardrails and prompt injection

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T14` |
| Status | `ready` |
| Plan | [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T6](T6-book-flat-figures.md), [T26](T26-book-checked-inline-code.md) |
| Size | M |

## Goal

Write the chapter "Asking before acting: approvals, guardrails and prompt injection" (`approvals-guardrails-and-injection`) for Part I, whose reader is a developer who has called a model API but never built an agent. It answers one research question from the sources below, section by section, with checked listings, figures and an analogy for each core concept, and ends with an exercise the reader can run offline. **Research question:** How does an agent pause for a person's approval and resume safely from a saved session, and why is an approval only one gate of several?

## Context

- [SDK guide §7](../../guides/agent-sdk.md)
- [Deep comparison §2](../../comparison/deep-comparison.md): safety defaults
- [OpenAI, A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf): guardrail types and tool risk ratings
- [OWASP Top 10 for LLM applications 2025](https://genai.owasp.org/llm-top-10/): LLM01 Prompt Injection, LLM06 Excessive Agency
- [Agent guide §5](../../guides/agent.md): "Prompt injection cannot be prevented, only contained"
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/book/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/book/src/content/chapters/approvals-guardrails-and-injection.md`, with `switchTo: [B15, E3]` and `opening: fact` in its front matter
- Sections: Approvals as a pause in a saved session (after the memory chapter); Approvals are one gate of several: guardrails on input and output (the OpenAI guide's guardrail types); Prompt injection basics: it cannot be prevented, only contained (OWASP LLM01 and LLM06; agent guide §5)
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/03-tool-approval.ts`, `verify/openai-agents-sdk/examples/05-approval-resume.ts`, `verify/langchain/examples/03-human-in-the-loop.ts`, `verify/openai-agents-sdk/examples/04-guardrails.ts`, the injection guardrail in `verify/openai-agents-sdk/examples/09-triage-agent.ts`
- Figures: a flat figure of a paused run as saved state, resumed by an approval; a flat analogy illustration of the second signature
- Exercise: Change the tool's input between pause and approval, and say what a safe SDK should do; then add an input guardrail and watch it trip.
- `apps/book/fact-checks/approvals-guardrails-and-injection.md`, the chapter's claims log

**Opening:** fact (the previous chapter in the outline opens with analogy).

**Analogies** (BK22: one per core concept, distinct across the book; vet each before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| approval | a bank's second signature on a large payment | the signer must see exactly what will run, so a changed input voids the signature | flat |
| guardrails | smoke detectors in several rooms | some guardrails can halt a run, which a detector cannot; and none of them makes the building fireproof | none |
| prompt injection | a forged memo slipped into the in-tray | a model has no way to check who wrote any text, so every input can act as an instruction | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (B15, E3) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` markers and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19), so if one misleads or `analogies.json` already uses it, propose a replacement to the owner instead of changing it.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/book/fact-checks/approvals-guardrails-and-injection.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Open each core concept with its analogy from the table above, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note; register every analogy in `apps/book/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, an analogy for every core concept, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/book/fact-checks/approvals-guardrails-and-injection.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/book/fact-checks/approvals-guardrails-and-injection.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [ ] Every core concept opens with its analogy and has a "Where the analogy breaks" note; every analogy is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [ ] The front matter's `opening` is `fact`, and `check:book` passes its opening-rotation check
- [ ] The pull request records the writing review's 5C scores and its voice scores, before and after
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job; the harness tests for any example whose markers changed.

## Docs to update

- The plan's §4 row if the chapter's sources or examples change
- The glossary, the source register and the analogy register

## Risks and open questions

- A source may not answer the research question; record the gap as a follow-up research todo instead of answering from memory.
- An analogy can mislead a newcomer more than no analogy; the vetting task and the "where it breaks" note are there to catch it, and a weak analogy goes back to the owner with a proposed replacement, not forced.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
