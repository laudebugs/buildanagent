# U22: Survey recent AI agent research papers

| Field | Value |
| --- | --- |
| ID | `U22` |
| Status | `done` |
| Plan | [Build guides §4d, U22](../../plans/build-guides.md#u22-survey-ai-agent-research-papers-added-2026-11-19) |
| Round / milestone | Research (added 2026-11-19) |
| Depends on | None |
| Size | L |

## Goal

The owner asked on 2026-11-19 to survey AI agent research papers, starting from [arXiv's "ai agents" search](https://arxiv.org/search/cs?query=ai+agents&searchtype=all&abstracts=show&order=-announced_date_first&size=50) and widening to more scientific papers. U22 triages that corpus and broader searches down to the LLM-agent papers that bear on our SDK, harness, coding agent and platform plans, and writes a survey report that cites primary sources (arXiv, ACL/NeurIPS/ICML proceedings, official benchmark papers) over blogs.

## Context

- [`agent-sdks-and-harness-design.md`](../../research/agent-sdks-and-harness-design.md) and its guides: the architecture this survey checks papers against.
- [`docs/research/memory/retrieval-and-memory.md`](../../research/memory/retrieval-and-memory.md), [`docs/research/external-designs/twelve-factor-agents.md`](../../research/external-designs/twelve-factor-agents.md) and [`docs/research/browser-use/browser-use.md`](../../research/browser-use/browser-use.md): recent research rounds already cite the papers in their areas (memory, agent design patterns, web/computer-use benchmarks); this survey should point to them rather than repeat their claims, and cover what they left out.
- `docs/research/*/notes/`: the raw-notes convention this round follows.

## Scope

**In scope**

- The arXiv query's results, triaged for relevance to LLM-based coding/tool-use agents (architectures, tool use and function calling, planning and reasoning, multi-agent coordination, evaluation and benchmarks, safety).
- Broader searches (arXiv full-text/category search, Semantic Scholar, ACL Anthology, conference proceedings) for papers the one query's newest-50 cut misses, and for peer-reviewed venues alongside preprints.
- What each paper implies for our SDK/harness/coding-agent/platform plans, as proposed changes for the owner.

**Out of scope** (and which todo covers it)

- Retrieval and long-term memory (done, U18), agent-to-agent protocols (done, U19), voice/realtime (done, U20), fine-tuning versus prompting (done, U21), browser-use evals and prompt-injection papers (done, U15/U16): cite, don't repeat.
- Classical (pre-LLM) multi-agent systems, robotics agents and game-theoretic agents, unless a paper is unusually relevant to our stack.
- Applying any proposed plan change: a later todo, once the owner decides.

## Tasks

- [x] Fetch and triage the arXiv query's 50 results.
- [x] Run broader searches per topic cluster (architectures/reasoning, tool use, multi-agent, evals/benchmarks, safety), covering peer-reviewed venues.
- [x] Map findings onto our plans and ADRs (what a later todo would change).
- [x] Draft the report with `/anthropic-skills:writing`, fact-checking each section against its primary source as soon as that section is drafted.
- [x] Review the whole report with `/anthropic-skills:writing-review`, fix findings, re-check touched claims.
- [x] Update `README.md`, `AGENTS.md` and `docs/plans/build-guides.md`.

## Acceptance criteria

- [x] `docs/research/papers/agent-research-papers.md` and `docs/research/papers/fact-check-agent-research-papers.md` exist, with every factual claim cited to a primary source and every relative link and anchor resolving.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

None (documentation only); `pnpm check`, `pnpm typecheck` and `pnpm test` must still pass.

## Docs to update

`README.md`, `AGENTS.md` (research layout index) and `docs/plans/build-guides.md` (new U22 section and todo-table row).

## Risks and open questions

- The arXiv query is broad (all CS, "ai agents"); the LLM-agents-only scope (the owner's choice, 2026-11-19) needs real triage judgment, recorded in the report.
- Some papers may be paywalled outside arXiv; prefer the arXiv preprint when a published version is not freely reachable, and say so.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
