# T25: Chapter: Evals, observability and release

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T25` |
| Status | `ready` |
| Plan | [Book plan §4.2](../../plans/build-book.md#42-part-ii-in-depth-for-experienced-builders) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [T6](../done/T6-book-flat-figures.md), [T26](../done/T26-book-checked-inline-code.md), [T34](../done/T34-example-tracing-and-llm-judge.md) |
| Size | M |

## Goal

Write the chapter "Evals, observability and release" (`evals-observability-and-release`) for Part II, whose reader is a builder who has shipped an agent on some SDK and wants the design reasons. It answers one research question from the sources below, section by section, with checked listings, figures and analogies where they make a concept clearer, and ends with an exercise the reader can run offline. **Research question:** How do you know an agent got better, what should every run record, and how do you release it safely?

## Context

- [Harness guide §9–§11](../../guides/agent-harness.md)
- [Agent guide §6 and §7](../../guides/agent.md)
- [Anthropic, How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system): the LLM judge
- ADR [0017](../../decisions/0017-telemetry-convention-pin-and-cost-attributes.md)
- [Agent research papers](../../research/papers/agent-research-papers.md) (U22): its [evals section](../../research/papers/agent-research-papers.md#a-trustworthy-eval-suite-needs-its-own-fresh-tasks-and-a-baseline-agent-because-the-published-benchmarks-grade-too-loosely-to-gate-a-release) shows that published scores can reflect memorization (arXiv 2506.12286) or a weak grader (2507.02825: τ-bench counted an empty response as a pass). It also shows that cost should be reported beside pass rate (2611.24324). Its [provenance section](../../research/papers/agent-research-papers.md#trustworthy-agent-provenance-needs-a-replayable-transaction-log-per-criterion-verifiers-the-generator-cannot-see-and-a-staged-gate-before-any-demo-based-score-counts) and closing paragraph bear on the LLM-judge and release sections: the halo effect in holistic scoring (2611.24039), many-criterion verifiers (VFM, 2611.23074; Gandalf, 2611.22841), a deterministic log check that catches cheats a judge misses and the reverse (Truthgate, 2611.23335), and a 43-day shadow-mode deployment (2611.23142). The provenance papers' rows were ⚠️ (secondary summary) and were re-read in full on 2026-11-22 (issue #167: rows `fix/167-reread-papers-N` in the papers log), which narrowed the halo-effect and verifier claims; read those rows before citing.
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted): the per-section workflow and the voice rules
- `apps/manual/README.md` (from T3–T7 and T26): front matter, citations, listings, notes, tabs, replays, checked inline code, figures and the analogy register

## Scope

**In scope**

- `apps/manual/src/content/chapters/evals-observability-and-release.md`, with `switchTo: [N31, N36, N38]` and `opening: analogy` in its front matter
- Sections: pass@k and pass^k, and why the capstones' scripted failures are synthetic; LLM-as-judge: a rubric, a 0.0–1.0 score and a starting set of about 20 queries (Anthropic); Tracing: spans projected from the session log; Release: four stages behind a graded kill switch, and handing off to people (agent guide §7)
- Listings and at least one replay from: the triage capstones' `check()` assertions, read as eval-shaped tests, `verify/vercel-ai-sdk/examples/16-tracing-and-judge.ts` from [T34](../done/T34-example-tracing-and-llm-judge.md)
- Figures: a flat figure of pass@k versus pass^k on the same results; a flat figure of a run's spans projected from its session log; a flat analogy illustration of the bridge that must hold every crossing
- Exercise: Run a capstone five times with a scripted failure, compute pass^5, and grade one answer with the scripted judge.
- `apps/manual/fact-checks/evals-observability-and-release.md`, the chapter's claims log

**Opening:** analogy (the previous chapter in the outline opens with code).

**Analogies** (BK22: an approved pool, distinct across the book; use an analogy where it makes its concept clearer, drop it where plain explanation works better, and vet each one before drafting):

| Concept | Analogy | Where the analogy breaks | Illustration |
| --- | --- | --- | --- |
| pass^k | a bridge that must hold every crossing, not just one | an agent's failures are not independent across runs the way a bridge's loads roughly are | flat |
| LLM judge | a teaching assistant grading against a rubric | the judge can be wrong in systematic ways, so its grades are checked against a person's | none |
| tracing | a parcel's tracking history | spans also carry cost and token counts, which a tracking page does not | none |
| staged rollout | a play's preview performances before opening night | the audience here is real users from the first stage, so the first stage is shadow mode | none |
| graded kill switch | a circuit breaker with several settings | the switch must stop new side effects without losing the log of ones in flight | none |

**Out of scope** (and which todo covers it)

- Adding our own packages' listings as tabs beside the third-party ones: a follow-up todo once the chapter's `switchTo` todos (N31, N36, N38) are done (BK8)
- New research: a gap becomes a follow-up research todo

## Tasks

- [ ] Answer the research question in a short note at the top of the fact-check file, from the sources above only, before drafting.
- [ ] Add register entries for every source the chapter cites, each pointing at the fact-check log that verified it; add a fact-check row first for any source no log covers.
- [ ] Add `// #region` and `// book:note` markers to the examples the chapter uses, and confirm each harness's `pnpm test` and the results-drift check still pass.
- [ ] Vet each planned analogy: say what it explains and check it does not imply anything false. The owner approved the analogies (2026-11-19). If one misleads or `analogies.json` already uses it, drop it or propose a replacement to the owner; a new or swapped-in analogy needs the owner's approval.
- [ ] Outline the chapter's sections, each with a one-line head, and note the planned opening type.
- [ ] For each section, in order: draft it with `/anthropic-skills:writing`; then fact-check every claim it makes against its primary source into `apps/manual/fact-checks/evals-observability-and-release.md` as ✅, ✏️ or ⚠️, before drafting the next section; commit the section and its rows together (BK21).
- [ ] Use an analogy from the table above where it makes a concept clearer: open the concept with it, follow it at once with the precise mechanism, and add its "Where the analogy breaks" note. Where plain explanation works better, drop the planned analogy. Register every analogy the chapter uses in `apps/manual/src/content/analogies.json` (BK22).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter, with the voice check: a vivid opening of the planned type that differs from the previous chapter's, a concrete example or scenario in every section, varied cadence, second person where it helps, and no stock phrasing repeated from earlier chapters (BK22).
- [ ] Fix every finding with `/anthropic-skills:writing`, re-check every claim a fix touched, and log the re-checks in `apps/manual/fact-checks/evals-observability-and-release.md`.
- [ ] Draw the figures and analogy illustrations with T6's pipeline, each with alt text and a caption that cites the register.
- [ ] Tag the chapter's glossary terms and add missing entries.

## Acceptance criteria

- [ ] The chapter builds with no unknown citation, reference or glossary term, and every listing comes from a checked file
- [ ] Every API identifier in the chapter's inline code resolves to a listing, a transcript or a pinned `.d.ts`, or carries a hand-checked marker citing a ✅ or ✏️ row of the chapter's fact-check log (BK17)
- [ ] At least one listing uses a tier 1, 2 or 3 interaction, and the page reads in full with JavaScript off
- [ ] Every figure, analogy illustrations included, is generated, passes the staleness test, and has alt text, a caption and both themes
- [ ] Every version the prose names says "as of <month year>"
- [ ] `apps/manual/fact-checks/evals-observability-and-release.md` has one block of rows per section, each committed with its section before the next section's draft, plus the re-check rows for the review's fixes, with a ✅/✏️/⚠️ tally
- [ ] Every analogy the chapter uses comes from the table above or has the owner's approval, opens its concept and has a "Where the analogy breaks" note; every one is in `src/content/analogies.json`, and `check:book` passes its duplicate and reuse checks
- [ ] The front matter's `opening` is `analogy`, and `check:book` passes its opening-rotation check
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
