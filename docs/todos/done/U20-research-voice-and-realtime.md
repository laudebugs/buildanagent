# U20: Research: voice and realtime agents, for the book

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `U20` |
| Status | `done` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round U (research), for Round T (textbook), MT |
| Depends on | None |
| Size | L |

## Goal

Research voice and realtime agents so the book can teach it from checked sources instead of memory. The owner chose to cover it (2026-11-19), and the repo has little on it. The result feeds a section of Chapter T35, todo [T38](../ready/T38-section-voice-and-realtime.md). **Research question:** How do voice and realtime agents differ from text agents in the loop, latency, interruption and tool calls, and what do our SDKs offer in TypeScript?

## Context

- [Book plan §4.3 and BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written): why this topic needs research first and where it lands
- [TypeScript gaps](../../comparison/typescript-gaps.md): the OpenAI TypeScript SDK lacks the voice pipeline
- `@openai/agents-realtime` 0.21.0 in [`verify/openai-agents-sdk/package.json`](../../../verify/openai-agents-sdk/package.json)
- [AGENTS.md, the five document steps](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), including the per-section fact-check rule

## Scope

**In scope**

- `docs/research/voice/notes/` with the raw notes
- A report in `docs/research/voice/` that answers the research question, with a fact-check file beside it
- A short list of recommended `verify/` examples, if any, for the book chapter or section

**Out of scope** (and which todo covers it)

- The book's prose (T38)
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

The report is [voice-and-realtime.md](../../research/voice/voice-and-realtime.md), with its [fact-check log](../../research/voice/fact-check-voice-and-realtime.md) (141 claims: 96 ✅, 38 ✏️, 7 ⚠️) and five notes files in [notes/](../../research/voice/notes/). The deliverables sit in `docs/research/voice/`, not the `agent-ui/` folder the scope first named, so the report has its own folder as U18's does. It finds that a voice agent runs the text tool loop inside a live session, so it must predict the end of a turn, truncate its context to what the user heard and keep tools from silencing it. Of our eight SDKs, OpenAI's and Cloudflare's ship a voice agent, ADK and the AI SDK ship experimental live layers, and four have no audio. It recommends that T38 stay a section with four teaching points and a revised analogy break note, recommends two examples (a scripted OpenAI realtime session and a Cloudflare voice pipeline with barge-in), and proposes eight plan changes for the owner to decide. `pnpm check` and `pnpm typecheck` pass. `pnpm test` passes for every package except `verify/copilot-sdk`, whose harness needs Linux's `unshare` and refuses to run on macOS; CI runs it on Linux, so the offline-gate box stays open until CI is green. The review boxes stay open until the pull request's rounds finish.
