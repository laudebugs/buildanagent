# G1a: Deep research: building an agent SDK

| Field | Value |
| --- | --- |
| ID | `G1a` |
| Status | `ongoing` |
| Plan | [Build guides §4](../../plans/build-guides.md#4-research-questions) |
| Round / milestone | Round G (build guides), M3 |
| Depends on | [K2](../done/K2-sdk-skills.md) |
| Size | L |

## Goal

Run the deep-research process on how to build an agent SDK, and record every claim with its source, so the an agent SDK guide stands on evidence.

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

- [ ] Split the plan's research questions into 4–6 subtopics
- [ ] Research each subtopic in parallel, preferring cloned source code and primary sources
- [ ] Write the notes with a source for every claim
- [ ] Synthesize, then fact-check the synthesis and log corrections
- [ ] Draft and review the synthesis prose with the writing skills
- [ ] Push

## Acceptance criteria

- [ ] Every research question in the plan has an answer with sources, or a recorded gap
- [ ] The synthesis passes review
- [ ] Corrections are logged

## Tests

None.

## Docs to update

The build guides plan; the roadmap.

## Risks and open questions

Network limits may block sources; ask the owner to allow specific hosts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
