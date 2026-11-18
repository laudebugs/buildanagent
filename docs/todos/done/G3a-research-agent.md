# G3a: Deep research: building an agent

| Field | Value |
| --- | --- |
| ID | `G3a` |
| Status | `done` |
| Plan | [Build guides §4](../../plans/build-guides.md#4-research-questions) |
| Round / milestone | Round G (build guides), M3 |
| Depends on | [G2a](../done/G2a-research-harness.md) |
| Size | L |

## Goal

Run the deep-research process on how to build an agent, and record every claim with its source, so the an agent guide stands on evidence.

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

- Four research notes in `docs/research/agent/notes/`: scope and workflows, tools/prompts/skills, evals and production, and safety gates.
- The synthesis `docs/research/agent/agent-research.md` makes 17 decisions for the agent product. It sets five new requirements for the lower layers (R1 N-of-M approvals, R2 a trusted run context, R3 origin labels, R4 cross-run limits and a live policy store, R5 a shadow gate mode) and three tensions (budget timing, blocking gates, the eval baseline).
- Finding about our own examples: in all five capstones the model supplies the lookup tool's identity argument, so an injected ticket could pull another customer's record. The fix is identity taken from the authenticated ticket (decision 3).
- `fact-check.md` logs 34 checked claims. Corrections include the τ-bench retail figures, the multi-agent scaling study's numbers, the MAST category name and the OpenAI guardrail's line range.
- A fresh reviewer ran the writing review and applied it. Rubric before → after: coherence 3→5, continuity 4→4, clarity 4→4, concision 4→5, cadence 4→4. It also fixed three cross-references.
