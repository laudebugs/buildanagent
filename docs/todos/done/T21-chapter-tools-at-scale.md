# T21: Chapter: Tools at scale: the registry, deferred tools, MCP and skills

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T21` |
| Status | `done` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md), [T30](../done/T30-example-deferred-tools-and-skills.md) |
| Size | M |

## Goal

Write the chapter "Tools at scale: the registry, deferred tools, MCP and skills" (`tools-at-scale`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** How does an agent with dozens of tools stay usable, and how do MCP servers and skills fit after MCP's 2026-07-28 revision?

## Context

- [Harness guide §4 and §7](../../guides/agent-harness.md)
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [Source-update report](../../research/source-update-2026-11-19.md) (todo U17): MCP 2026-07-28 and what it changes in our plans
- ADR [0021](../../decisions/0021-mcp-client-base.md)
- [Agent research papers, tool-security section](../../research/papers/agent-research-papers.md#our-permission-pipeline-checks-what-a-tool-call-asks-to-do-but-not-what-the-tools-code-or-a-loaded-skill-actually-does) (U22): SkillCFI (arXiv 2611.24185) found that none of 53 public skill packages was accepted as written (28 stopped at inventory, the other 25 were rejected, and the authors adapted seven of those 25), and that runtime enforcement blocked all 80 abnormal targets under each of three refusal messages where a plain allowlist admitted any request in a skill's vocabulary. ACaM (arXiv 2611.23507) found hundreds of structurally vulnerable paths in 43 real agents, and showed tool code that reaches beyond its description ("capability laundering", a term it credits to earlier work) on injected variants of 24 annotated agents, not on a real agent. Use them in the skills and registry sections and in the MCP analogy's break note, and Voyager (arXiv 2305.16291, [architectures section](../../research/papers/agent-research-papers.md#our-loop-already-is-a-react-loop-later-papers-add-layers-around-it-not-a-rival-architecture)) for skills stored as executable code in a vector database, which our file-based layout adapts. The checks both papers imply are U22 proposals 1 and 2, not adopted, so teach the gap without claiming our registry closes it.
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/tools-at-scale.md`, with `switchTo: [N11, N21–N25]` and `opening: fact` in its front matter
- Sections: One registry that names, defers and gates every tool; Deferred tools: load a tool's definition only when needed; MCP after 2026-07-28: stateless requests, `server/discover`, multi round-trip requests (`input_required`), and the deprecation of Roots, Sampling, Logging and dynamic client registration; Skills: procedures loaded on demand; Connector OAuth and token custody moved to the permissions chapter, after the credential boundary
- Listings and at least one replay from: `verify/vercel-ai-sdk/examples/08-mcp-tools.ts`, `verify/cloudflare-agents/examples/07-mcp.ts`, `verify/copilot-sdk/examples/07-mcp-server.ts`, `verify/pi/examples/03-tool-selection.ts`, the deferred-tools and skills examples from [T30](../done/T30-example-deferred-tools-and-skills.md)
- Figures: a flat figure of one registry naming, deferring and gating built-in, MCP and extension tools; a flat analogy illustration of the hardware store's back room
- Exercise: Defer half the tools and measure the prompt's size before and after.
- `apps/manual/fact-checks/tools-at-scale.md`, the chapter's claims log

**Opening:** fact (the previous chapter in the outline opens with scenario).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| deferred tools | a hardware store that shelves the common tools and fetches the rest from the back room | fetching a definition costs a round trip and tokens, so the shelf must hold the tools used most | flat |
| MCP | a USB port: one plug shape for many devices | plugging in an MCP server is closer to installing software than plugging in a mouse; its tools are untrusted | none |
| skills | a mechanic's service manuals, opened only when that model of car comes in | a skill read into context costs tokens every turn it stays there | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N11, N21–N25) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/tools-at-scale.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [x] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [x] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/tools-at-scale.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [x] `apps/manual/fact-checks/tools-at-scale.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [x] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [x] The front matter's `opening` is `fact`, and `check:book` passes its opening-rotation check
- [x] The pull request records the writing review's 5C scores and its voice scores, before and after
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
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

The chapter is `apps/manual/src/content/chapters/tools-at-scale.md` (Chapter 13), with its claims log in `apps/manual/fact-checks/tools-at-scale.md` (102 rows: 93 ✅, 4 ✏️ and 5 ⚠️, each section committed with its rows; the ✏️ rows 22, 91, 97 and 98 correct earlier claims after the first review). It has five sections: the registry, deferred tools, MCP after 2026-07-28, skills, and a short pointer that leaves connector OAuth and token custody to the permissions chapter. Two flat figures (`one-registry` and the hardware store's `back-room` illustration) and three exercises complete it. Three analogies are registered (`hardware-store-back-room` with its illustration, `usb-port` and `service-manuals`, each with its break note), plus the sources, the glossary terms `tool-registry`, `deferred-tool` and `skill`, and region and note markers in the Vercel AI SDK, Cloudflare Agents, Copilot SDK, Pi and Claude Agent SDK examples (three transcripts regenerated because lines moved).

Three things differ from the plan:

- The front matter lists `switchTo: [N11, N21, N22, N23, N24, N25]`, because the schema takes single todo ids, not the range `N21–N25`.
- Every MCP 2026-07-28 claim (stateless requests, `server/discover`, `input_required`, the deprecations) was confirmed against the specification's changelog, deprecated-features, versioning, discovery and multi round-trip pages, so none is marked unverified. Only the analogies, one comparison with Voyager and an exercise's framing are ⚠️.
- N21 to N25 are still `ready`, so the chapter describes the MCP client, extension loader and skill loader as design and shows no listing from our own packages. Only the registry (N11) is built, and the chapter cites its source for behaviour and never lists it.

The writing review and its fixes, the code-review rounds and the pull request's rubric scores are still to do.
