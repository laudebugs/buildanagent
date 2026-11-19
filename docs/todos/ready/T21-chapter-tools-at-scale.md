# T21: Chapter: Tools at scale: the registry, deferred tools, MCP and skills

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T21` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](T5-book-interactive-listings.md), [T6](T6-book-flat-figures.md), [T26](T26-book-checked-inline-code.md), [T30](T30-example-deferred-tools-and-skills.md) |
| Size | M |

## Goal

Write the chapter "Tools at scale: the registry, deferred tools, MCP and skills" (`tools-at-scale`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and an analogy for each core concept, and ends with an exercise the reader can run offline. **Research question:** How does an agent with dozens of tools stay usable, and how do MCP servers and skills fit after MCP's 2026-07-28 revision?

## Context

- [Harness guide §4 and §7](../../guides/agent-harness.md)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Source-update report](../../research/source-update-2026-11-19.md) (todo U17): MCP 2026-07-28 and what it changes in our plans
- ADR [0021](../../decisions/0021-mcp-client-base.md)
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/book/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/book/src/content/chapters/tools-at-scale.md`, with `switchTo: [N11, N21–N25]` and `opening: fact` in its front matter
- Sections: One registry that names, defers and gates every tool; Deferred tools: load a tool's definition only when needed; MCP after 2026-07-28: stateless requests, `server/discover`, multi round-trip requests (`input_required`), and the deprecation of Roots, Sampling, Logging and dynamic client registration; Skills: procedures loaded on demand; Connector OAuth and token custody moved to the permissions chapter, after the credential boundary
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/08-mcp-tools.ts`, `verify/cloudflare-agents/examples/07-mcp.ts`, `verify/copilot-sdk/examples/07-mcp-server.ts`, `verify/pi/examples/03-tool-selection.ts`, the deferred-tools and skills examples from [T30](T30-example-deferred-tools-and-skills.md)
- Figures: a flat figure of one registry naming, deferring and gating built-in, MCP and extension tools; a flat analogy illustration of the hardware store's back room
- Exercise: Defer half the tools and measure the prompt's size before and after.
- `apps/book/fact-checks/tools-at-scale.md`, the chapter's claims log

**Opening:** fact (the previous chapter in the outline opens with scenario).

**Analogies** (BK22: one per core concept, distinct across the book; vet each before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| deferred tools | a hardware store that shelves the common tools and fetches the rest from the back room | fetching a definition costs a round trip and tokens, so the shelf must hold the tools used most | flat |
| MCP | a USB port: one plug shape for many devices | plugging in an MCP server is closer to installing software than plugging in a mouse; its tools are untrusted | none |
| skills | a mechanic's service manuals, opened only when that model of car comes in | a skill read into context costs tokens every turn it stays there | none |

**Out of scope** (and which todo covers it)

- Moving the listings to our own packages: a follow-up todo once its switch todos (N11, N21–N25) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` markers and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19), so if one misleads or `analogies.json` already uses it, propose a replacement to the owner instead of changing it.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/book/fact-checks/tools-at-scale.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Open each core concept with its analogy from the table above, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note; register every analogy in `apps/book/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, an analogy for every core concept, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/book/fact-checks/tools-at-scale.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/book/fact-checks/tools-at-scale.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
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
