# T36: Chapter: Retrieval and long-term memory

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T36` |
| Status | `done` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U18](../done/U18-research-retrieval-and-long-term-memory.md), [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md), [T41](../done/T41-example-retrieval.md), [T43](../done/T43-example-store-recall-expire.md), [T44](../done/T44-example-context-memory.md) |
| Size | M |

## Goal

Write the chapter "Retrieval and long-term memory" (`retrieval-and-long-term-memory`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** Set by research todo U18: when should an agent retrieve instead of carrying context, and how should memory that outlives a task be written, recalled and forgotten?

## Context

- [U18's report](../../research/memory/retrieval-and-memory.md) and its [fact-check](../../research/memory/fact-check-retrieval-and-memory.md), whose plan changes 1–4 the owner approved on 2026-11-19
- [Main report](../../research/agent-sdks-and-harness-design.md): layer 5 and the memory paragraph
- [OWASP Top 10 for LLM applications 2025](https://genai.owasp.org/llm-top-10/): LLM08 Vector and Embedding Weaknesses
- [Agent research papers](../../research/papers/agent-research-papers.md) (U22), which U18 does not cover: Reflexion (arXiv 2303.11366) stores a verbal lesson from each failed attempt rather than its transcript, and Voyager (2305.16291) stores skills as reusable code, two primary answers to "what to store" ([architectures section](../../research/papers/agent-research-papers.md#our-loop-already-is-a-react-loop-later-papers-add-layers-around-it-not-a-rival-architecture)). GUARD (2611.23476, [self-improvement section](../../research/papers/agent-research-papers.md#a-regression-gate-not-a-grader-is-what-makes-recursive-self-improvement-safe-to-try-and-the-values-in-the-harness-decide-what-the-agent-becomes)) accepts a memory edit only when its gains outweigh its regressions, which bears on "writes need rules". Cite them through U22's fact-check, rows 4–5, 9–10 and 113–116.
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- T43's example, `verify/langchain/examples/11-store-recall-expire.ts`, has the listing regions `remember`, `recall`, `recall-run` and `session-log`, with `book:note` ids `record`, `expire`, `after-expiry` and `log`, and a committed transcript. It builds no `index`, so the docs' `index: { embed, dims }` form is not exercised; its fact-check log is [fact-check-langchain-store-example.md](../../plans/reviews/fact-check-langchain-store-example.md)
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/retrieval-and-long-term-memory.md`, with `switchTo: [N23]` and `opening: scenario` in its front matter
- Sections: Just-in-time retrieval through tools versus pre-loaded context; Vector and keyword search, their failure modes (OWASP LLM08), and measuring retrieval: recall@k on 20 to 50 labelled queries, some of which should return nothing; Long-term memory across runs: what to store, when to recall, when to forget, and checking a recalled record against its source before acting on it; When to buy a memory service (main report) and when a file is enough
- Listings and at least one replay from: `verify/langchain/examples/09-long-term-store.ts`, `verify/cloudflare-agents/examples/02-sql.ts`, `verify/vercel-ai-sdk/examples/17-keyword-retrieval.ts` from [T41](../done/T41-example-retrieval.md), the store, recall and expiry example `verify/langchain/examples/11-store-recall-expire.ts` from [T43](../done/T43-example-store-recall-expire.md), the context-memory example from [T44](../done/T44-example-context-memory.md)
- The retrieval example, `verify/vercel-ai-sdk/examples/17-keyword-retrieval.ts` ([T41](../done/T41-example-retrieval.md)), has regions `bm25`, `search-tool` and `planted`, with notes `filter-first` and `planted`, and a transcript for a replay. Three limits carry into the prose. First, the scripted model's second turn is defined to repeat the first search result, so the planted-document check shows that ranking decides what the model reads, not that a real model follows it; cite PoisonedRAG and BadRAG for the measured attacks. Second, the paraphrase miss is one hand-picked query, not a measured recall. Third, the example has no vector search and no hybrid variant, so the fusion section (RRF at k = 60) has no listing from it ([fact-check](../../plans/reviews/fact-check-keyword-retrieval-example.md), rows T41-10, T41-11 and T41-14).
- The context-memory example is `verify/cloudflare-agents/examples/11-context-memory.ts`, with regions `context-blocks`, `scripts` and `evict-and-recall`, `// book:note` markers `frozen` and `tools`, and a transcript. FTS5 ran in local workerd, but the search is keyword-only (Porter stemming); Vectorize and Workers AI have no local simulation, and `agents/context` is experimental as of November 2026.
- Figures: a flat analogy illustration of the reference librarian; Flat figures as U18's findings require
- Exercise: Store a fact in one run, recall it in the next, then expire it and show it is gone from recall but still in the session log.
- `apps/manual/fact-checks/retrieval-and-long-term-memory.md`, the chapter's claims log

**Opening:** scenario (the previous chapter in the outline opens with analogy).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| retrieval | a reference librarian who fetches the few books you need | the librarian's choice is a search ranking, and a wrong ranking looks just as confident | flat |
| long-term memory | a card file of contacts updated after every meeting | a model may write a wrong card and later trust it, so writes need rules | none |
| forgetting | an office shredding schedule | deleting a fact from memory does not delete it from logs or caches unless the harness does | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N23) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [x] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [x] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [x] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [x] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [x] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [x] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/retrieval-and-long-term-memory.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [x] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/retrieval-and-long-term-memory.md`.
- [x] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [x] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [x] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [x] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [x] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [x] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [x] Every version the prose names says "as of <month year>"
- [ ] `apps/manual/fact-checks/retrieval-and-long-term-memory.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
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
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Chapter 12, [`retrieval-and-long-term-memory.md`](../../../apps/manual/src/content/chapters/retrieval-and-long-term-memory.md), opens with a scenario and has four sections, each drafted with `/anthropic-skills:writing` and fact-checked into [its log](../../../apps/manual/fact-checks/retrieval-and-long-term-memory.md) before the next was drafted (BK21):

1. *Carry a small, stable core, and fetch everything else through a tool when a step needs it.*
2. *Rank with keywords first, filter by tenant before ranking, and measure the retriever on labelled queries.*
3. *Store a lasting fact as a sourced record, check it before acting on it, and let it expire unless a check renews it.*
4. *A directory of files is enough for one agent and one user; buy a memory service on one of three signals.*

The chapter has twelve listings from T41's, T43's and T44's examples, `09-long-term-store.ts` and `02-sql.ts` (one new `notes-agent` region, which changes no result), three replays and one tab block, and three flat figures: the reference librarian's analogy illustration, the tenant filter before ranking, and a memory record's life. It uses all three planned analogies, each registered with its break note. The fact-check log holds 118 rows: 107 ✅, 1 ✏️ and 10 ⚠️, the ⚠️ rows being our own rules, inferences or an absence claim, each marked as such in the text. PoisonedRAG, BadRAG, NoLiMa, BEIR, LIMIT, the RRF paper, MINJA, Reflexion and Voyager were each read in full before the section citing them was drafted. As the owner and the todo required, the fusion paragraph cites its paper and says no example shows it, the planted-document run is described as showing what the model reads rather than what a model does, and the paraphrase miss is called one hand-picked query.

The writing review, its fixes and re-check rows, and both code-review rounds remain for the pull request.
