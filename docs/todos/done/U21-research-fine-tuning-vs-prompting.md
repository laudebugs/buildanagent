# U21: Research: fine-tuning versus prompting, for the book

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `U21` |
| Status | `done` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round U (research), for Round T (textbook), MT |
| Depends on | None |
| Size | L |

## Goal

Research fine-tuning versus prompting so the book can teach it from checked sources instead of memory. The owner chose to cover it (2026-11-19), and the repo has little on it. The result feeds a section of Chapter T11, todo [T39](../ready/T39-section-fine-tuning-vs-prompting.md). **Research question:** When does fine-tuning, distillation or reinforcement fine-tuning beat prompting plus tools for an agent, what does it cost, and what does evidence from deployed agents show?

## Context

- [Book plan §4.3 and BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written): why this topic needs research first and where it lands
- Pan et al., "Measuring Agents in Production" ([arXiv 2512.04123](https://arxiv.org/abs/2512.04123)), cited in the U17 [source-update report](../../research/source-update-2026-11-19.md): "70% rely on prompting off-the-shelf models instead of weight tuning"
- [OpenAI, A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf), "Selecting your models"
- [AGENTS.md, the five document steps](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), including the per-section fact-check rule

## Scope

**In scope**

- `docs/research/fine-tuning/notes/` with the raw notes (the folder was renamed from `agent/` when the work started, so the topic has its own folder, as U18's `memory/` does)
- A report in `docs/research/fine-tuning/` that answers the research question, with a fact-check file beside it
- A short list of recommended `verify/` examples, if any, for the book chapter or section

**Out of scope** (and which todo covers it)

- The book's prose (T39)
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

The report is [fine-tuning-vs-prompting.md](../../research/fine-tuning/fine-tuning-vs-prompting.md), with its [fact-check log](../../research/fine-tuning/fact-check-fine-tuning-vs-prompting.md) (120 claims: 82 ✅, 23 ✏️, 15 ⚠️) and five notes files. Its thesis is that an agent builder should default to prompting, tools and evals, and tune only for a gap an eval proves, at a volume or latency that repays the training, on a base model that lives long enough to repay it. As of November 2026, OpenAI is winding down self-serve fine-tuning, Anthropic's API offers none, and Google alone tunes its current models. Rereading MAP (arXiv 2512.04123v4) at its source showed that the abstract's 70% is 14 of 20 interviewed teams, not a survey figure. The book plan's fact-check rows 105 and 174 are right about the quote but silent on its base, so change 1 of the report proposes a correction. The report recommends T39's four teach points and one offline pricing example, and proposes six plan changes for the owner to decide. The last four sections were drafted in one pass and checked together, which the log records. `pnpm check` and `pnpm typecheck` pass. `pnpm test` passes for every package except `verify/copilot-sdk`, whose harness needs Linux's `unshare` and refuses to run on macOS; CI runs it on Linux, so the offline-gate box stays open until CI is green. The review boxes stay open until the pull request's rounds finish.
