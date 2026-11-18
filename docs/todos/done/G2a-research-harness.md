# G2a: Deep research: building an agent harness

| Field | Value |
| --- | --- |
| ID | `G2a` |
| Status | `done` |
| Plan | [Build guides §4](../../plans/build-guides.md#4-research-questions) |
| Round / milestone | Round G (build guides), M3 |
| Depends on | [G1a](../done/G1a-research-agent-sdk.md) |
| Size | L |

## Goal

Run the deep-research process on how to build an agent harness, and record every claim with its source, so the an agent harness guide stands on evidence.

## Context

- The [build guides plan §3–4](../../plans/build-guides.md#3-how-each-research-round-works)
- The four SDK references and their cloned sources
- The research report and harness teardown

## Scope

**In scope**

- Research notes in `docs/research/<layer>/notes/` and a synthesis in `docs/research/<layer>/<layer>-research.md`
- A fact-check log for the synthesis

**Out of scope** (and which todo covers it)

- The guide (the matching b todo)

## Tasks

- [x] Split the plan's research questions into 4–6 subtopics
- [x] Research each subtopic in parallel, preferring cloned source code and primary sources
- [x] Write the notes with a source for every claim
- [x] Synthesize, then fact-check the synthesis and log corrections
- [x] Draft and review the synthesis prose with the writing skills
- [x] Push

## Acceptance criteria

- [x] Every research question in the plan has an answer with sources, or a recorded gap
- [x] The synthesis passes review
- [x] Corrections are logged

## Tests

None.

## Docs to update

The build guides plan; the roadmap.

## Risks and open questions

Network limits may block sources; ask the owner to allow specific hosts.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- Five research notes in `docs/research/agent-harness/notes/`: sessions and storage (with an addendum analysing the structure of a real Claude Code transcript), context and compaction, permissions and sandboxing, interfaces and extensions, and observability and evals.
- The synthesis `docs/research/agent-harness/agent-harness-research.md` makes 18 design decisions and 6 revisions to the 8-layer architecture. It names three tensions with the SDK synthesis (token convention, blocking approval gate, budget timing) and leaves nine questions for Round P.
- `fact-check.md` logs 38 checked claims, nine of them corrected. The Codex `untrusted` correction to `harness-architectures.md` is logged as row 17 of `fact-check-2026-11-18.md`.
- A fresh reviewer ran the writing review and applied it. Rubric before → after: coherence 3→5, continuity 4→4, clarity 4→4, concision 4→5, cadence 4→4. I fixed one cross-reference the review left open.
