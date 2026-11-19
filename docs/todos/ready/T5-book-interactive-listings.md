# T5: Interactive listings: annotations, SDK tabs, recorded-run replay and the transcript recorder

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T5` |
| Status | `ready` |
| Plan | [Book plan §5, BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T4](T4-book-listings.md) |
| Size | L |

## Goal

Make code blocks interactive in the three tiers the owner asked for, all built from the same real file regions so CI keeps checking them. Tier 1 adds numbered notes on marked lines; tier 2 shows one concept across several SDKs in tabs; tier 3 replays a recorded run of the example against its mock model, from a transcript CI regenerates on every push. Every tier must read well with JavaScript turned off.

## Context

- [Book plan BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed): the owner's tiers and tier 4, which stays later.
- Each harness's mock layer: `verify/vercel-ai-sdk/examples/lib/check.ts` (`MockLanguageModelV4` and `check()`), `verify/pi/examples/lib/faux.ts`, and the mock Messages API in `verify/claude-agent-sdk/scripts/mock-anthropic.mjs`.
- `scripts/ci/results-drift.mjs` and each harness's `results/run-examples.json`: how CI already fails on changed results.

## Scope

**In scope**

- Tier 1: `// book:note <id>` markers in example files, note text in the chapter, numbered markers on the page and a numbered list without JavaScript
- Tier 2: the `:::tabs` block, each tab a listing with its own path and pin, stacked under headings without JavaScript
- Tier 3: a transcript recorder per harness, writing `verify/<sdk>/results/transcripts/<example>.json` with normalised ids and timings, and a replay component that steps through it
- The results-drift check extended to transcripts

**Out of scope** (and which todo covers it)

- Tier 4, live editing against `ScriptedModel` or a WebContainer embed (later; see BK9)
- Styling ([T2](T2-book-design.md)) beyond wiring the components to its tokens

## Tasks

- [ ] Write the note markers: strip `// book:note` comments from the displayed code, attach each note to its line, and fail on an unknown or unused id.
- [ ] Write the `:::tabs` block on top of the T4 listing, with an accessible tab list and a stacked fallback.
- [ ] Define the transcript format: the example id, the harness and pin, each model request and response as messages, each tool call and result, and each `check()` message with its pass state.
- [ ] Build the recorder for the AI SDK harness first, inside its mock model, then for Pi, the OpenAI Agents SDK and LangChain; record which harnesses Part I's chapters need and cover those before the rest.
- [ ] Normalise ids, timestamps and durations so two runs produce identical files; run each harness's `pnpm test` twice and diff.
- [ ] Extend `scripts/ci/results-drift.mjs` to fail when a committed transcript differs from the regenerated one, with its own test in `scripts/ci/`.
- [ ] Write the replay component: step forward and back, show the current message beside the highlighted listing line where the transcript names one, and render the whole transcript as a list without JavaScript.

## Acceptance criteria

- [ ] A fixture listing with three notes shows three markers and, with JavaScript off, a numbered list of three notes under the code
- [ ] A tabs block with listings from two harnesses shows two paths and two pins
- [ ] Running a covered harness's `pnpm test` twice leaves every transcript byte-identical
- [ ] Editing an example so its model exchange changes, without regenerating the transcript, fails the results-drift check
- [ ] The replay page makes no network request when stepping through a transcript
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest tests for the note and tab directives and the replay's static rendering; `node --test scripts/ci/*.test.mjs` for the drift extension; each harness's own `pnpm test` for the recorder.

## Docs to update

- `apps/book/README.md`: notes, tabs and replays
- Each covered harness's README: the transcripts folder
- [AGENTS.md](../../../AGENTS.md) layout: `results/transcripts/` is committed with the other results

## Risks and open questions

- Harnesses that mock over HTTP (Claude Agent SDK, Copilot SDK) carry runtime-generated ids; if a transcript still varies after normalisation, leave that harness without replays and say so in its README (plan risk 3).
- Transcripts add files that the weekly SDK-update pull requests regenerate; their diffs make those pull requests longer but show behaviour changes, which is useful review material.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
