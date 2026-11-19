# U19: Research: agent-to-agent protocols (a2a), for the book

> **History:** the owner put the book's todos on hold on 2026-11-19 pending approval of the book plan, and approved the plan the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `U19` |
| Status | `ready` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round U (research), for Round T (textbook), MT |
| Depends on | None |
| Size | L |

## Goal

Research agent-to-agent protocols (a2a) so the book can teach it from checked sources instead of memory. The owner chose to cover it (2026-11-19), and the repo has little on it. The result feeds a section of Chapter T21, todo [T37](T37-section-a2a.md). **Research question:** What does A2A 1.0.0 standardize, how does it divide work with MCP, which of our SDKs support it in TypeScript as of the research date, and when should an agent call or expose another agent over A2A?

## Context

- [Book plan §4.3 and BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written): why this topic needs research first and where it lands
- [A2A specification](https://a2a-protocol.org/latest/specification/)
- [Main report](../../research/agent-sdks-and-harness-design.md): its one A2A mention (ADK's Task API)
- [Google ADK reference](../../reference/google-adk/guide.md)
- [AGENTS.md, the five document steps](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), including the per-section fact-check rule

## Scope

**In scope**

- `docs/research/external-designs/notes/` with the raw notes
- A report in `docs/research/external-designs/` that answers the research question, with a fact-check file beside it
- A short list of recommended `verify/` examples, if any, for the book chapter or section

**Out of scope** (and which todo covers it)

- The book's prose (T37)
- Changes to our SDK or harness plans: proposed in the report, decided by the owner

## Tasks

- [ ] Gather primary sources first: specifications, official docs, repositories and papers; mark anything taken from a search summary or a secondary write-up as such.
- [ ] Draft each section of the report with `/anthropic-skills:writing`, and fact-check that section's claims into the fact-check file before drafting the next (the owner's per-section rule).
- [ ] Run `/anthropic-skills:writing-review` on the whole report, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.
- [ ] Write "as of <month year>" for every version, star count and spec status.

## Acceptance criteria

- [ ] The report answers the research question in its thesis, with every factual claim cited
- [ ] The fact-check file logs every claim as ✅, ✏️ or ⚠️, with a tally
- [ ] The report names what the book should teach and which examples, if any, should be written
- [ ] Every relative link resolves
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

None beyond `pnpm check` and the link check; the report is prose.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout and the [README](../../../README.md) docs table: the new report
- The book plan's §4.3 row

## Risks and open questions

- The topic may move fast; record the date of every source read.
- Sources may be thin for TypeScript; say so rather than generalising from Python.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
