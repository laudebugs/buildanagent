# U19: Research: agent-to-agent protocols (a2a), for the book

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `U19` |
| Status | `done` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round U (research), for Round T (textbook), MT |
| Depends on | None |
| Size | L |

## Goal

Research agent-to-agent protocols (a2a) so the book can teach it from checked sources instead of memory. The owner chose to cover it (2026-11-19), and the repo has little on it. The result feeds a section of Chapter T21, todo [T37](../done/T37-section-a2a.md). **Research question:** What does A2A 1.0.0 standardize, how does it divide work with MCP, which of our SDKs support it in TypeScript as of the research date, and when should an agent call or expose another agent over A2A?

## Context

- [Book plan §4.3 and BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written): why this topic needs research first and where it lands
- [A2A specification](https://a2a-protocol.org/latest/specification/)
- [Main report](../../research/agent-sdks-and-harness-design.md): its one A2A mention (ADK's Task API)
- [Google ADK reference](../../reference/google-adk/guide.md)
- [AGENTS.md, the five document steps](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), including the per-section fact-check rule

## Scope

**In scope**

- `docs/research/a2a/notes/` with the raw notes
- A report in `docs/research/a2a/` that answers the research question, with a fact-check file beside it
- A short list of recommended `verify/` examples, if any, for the book chapter or section

**Out of scope** (and which todo covers it)

- The book's prose (T37)
- Changes to our SDK or harness plans: proposed in the report, decided by the owner

## Tasks

- [x] Gather primary sources first: specifications, official docs, repositories and papers; mark anything taken from a search summary or a secondary write-up as such.
- [x] Draft each section of the report with `/anthropic-skills:writing`, and fact-check that section's claims into the fact-check file before drafting the next (the owner's per-section rule).
- [x] Run `/anthropic-skills:writing-review` on the whole report, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.
- [x] Write "as of <month year>" for every version, star count and spec status.

## Acceptance criteria

- [x] The report answers the research question in its thesis, with every factual claim cited
- [x] The fact-check file logs every claim as ✅, ✏️ or ⚠️, with a tally
- [x] The report names what the book should teach and which examples, if any, should be written
- [x] Every relative link resolves
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

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

The report is [agent-to-agent-protocols.md](../../research/a2a/agent-to-agent-protocols.md), with its [fact-check log](../../research/a2a/fact-check-agent-to-agent-protocols.md) (138 claims: 97 ✅, 31 ✏️, 10 ⚠️). It finds that A2A 1.0.0 (patched as 1.0.1) is a released standard, that MCP 2026-07-28 leaves "who plans the work" as the line between the two protocols, and that only Google ADK ships A2A in TypeScript among our eight SDKs, on protocol 0.3. It recommends that T37 stay one section of T21, teaching five steps, and that a new ADK example (placeholder T45) give it a listing. It proposes seven plan changes for the owner to decide. The report sits in `docs/research/a2a/`, its own folder, rather than in `external-designs/` as this todo's scope first said. `pnpm check` passes and every relative link resolves. The offline-gate and review boxes stay open until `pnpm typecheck`, `pnpm test` and the pull request's rounds finish.
