# T5: Interactive listings: annotations, SDK tabs, recorded-run replay and the transcript recorder

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T5` |
| Status | `done` |
| Plan | [Book plan §5, BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T4](../done/T4-book-listings.md) |
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
- Styling ([T2](../done/T2-book-design.md)) beyond wiring the components to its tokens

## Tasks

- [x] Write the note markers: strip `// book:note` comments from the displayed code, attach each note to its line, and fail on an unknown or unused id.
- [x] Write the `:::tabs` block on top of the T4 listing, with an accessible tab list and a stacked fallback.
- [x] Define the transcript format: the example id, the harness and pin, each model request and response as messages, each tool call and result, and each `check()` message with its pass state.
- [x] Build the recorder for the AI SDK harness first, inside its mock model, then for Pi, the OpenAI Agents SDK and LangChain; record which harnesses Part I's chapters need and cover those before the rest.
- [x] Normalise ids, timestamps and durations so two runs produce identical files; run each harness's `pnpm test` twice and diff.
- [x] Extend `scripts/ci/results-drift.mjs` to fail when a committed transcript differs from the regenerated one, with its own test in `scripts/ci/`.
- [x] Write the replay component: step forward and back, show the current message beside the highlighted listing line where the transcript names one, and render the whole transcript as a list without JavaScript.

## Acceptance criteria

- [x] A fixture listing with three notes shows three markers and, with JavaScript off, a numbered list of three notes under the code
- [x] A tabs block with listings from two harnesses shows two paths and two pins
- [x] Running a covered harness's `pnpm test` twice leaves every transcript byte-identical
- [x] Editing an example so its model exchange changes, without regenerating the transcript, fails the results-drift check
- [x] The replay page makes no network request when stepping through a transcript
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest tests for the note and tab directives and the replay's static rendering; `node --test scripts/ci/*.test.mjs` for the drift extension; each harness's own `pnpm test` for the recorder.

## Docs to update

- `apps/manual/README.md`: notes, tabs and replays
- Each covered harness's README: the transcripts folder
- [AGENTS.md](../../../AGENTS.md) layout: `results/transcripts/` is committed with the other results

## Risks and open questions

- Harnesses that mock over HTTP (Claude Agent SDK, Copilot SDK) carry runtime-generated ids; if a transcript still varies after normalisation, leave that harness without replays and say so in its README (plan risk 3).
- Transcripts add files that the weekly SDK-update pull requests regenerate; their diffs make those pull requests longer, but they also show behaviour changes, which reviewers want to see.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **Notes.** An example line ends with `// book:note <id>`, and a `:::listing` container that names a file holds `::note[Text]{#id}` for each marker. The build takes the marker off the line, highlights the line, ends it with a numbered marker that links to its note, and lists the notes under the code, numbered in the order of their markers. Notes stay Markdown, so references and citations in them render. A note without a marker, a marker without a note once the listing gives notes, a repeated id, a note without text, any other child, and a marker that is malformed, repeated in its file or alone on its line each fail. A listing that gives no notes shows its marked lines plainly, which is our choice.
- **Tabs.** `:::tabs` holds two or more file listings. Each sits in a panel under a heading made from its caption and keeps its own number, path and pin. `ChapterLayout` now loads `scripts/tabs.ts` and `scripts/steps.ts` as one external script, and `tabs.ts` turns the headings into T2's tab list.
- **Transcripts.** `scripts/transcripts/record.mjs` is the recorder each harness's runner preloads. The mock layer reports each request, response and `check()` to it, with the example line the call stack shows. `scripts/transcripts/write.mjs` writes `verify/<sdk>/results/transcripts/<example>.json` in format 1: the example, its file, harness and pin, then events of three kinds. A request holds its new messages, a `repeated` count and the tool names; a response holds the model's message and finish reason; a check holds its message and pass state. Messages use SDK-neutral parts: text, reasoning, tool calls, tool results and `other`. The writer replaces paths, user and host names, timestamps, durations, UUIDs and long generated ids with placeholders.
- **Covered harnesses.** The AI SDK records through `MockLanguageModelV4`, Pi through `fauxSession()`'s faux steps, the OpenAI Agents SDK through `ScriptedModel`, and LangChain through `fakeModel()`. Together they commit 35 transcripts (287,901 bytes), and two runs of each `pnpm test` wrote identical bytes with every example passing. LangChain's and Pi's model calls, and the AI SDK's streamed ones, run outside the example's async stack, so those events carry no line; Pi's `04-steering.ts` has no transcript.
- **Left without replays.** Part I also lists Google ADK, Claude Agent SDK, Cloudflare Agents and Copilot SDK examples. The Claude Agent SDK and Copilot SDK mock the provider over HTTP, so their recorders belong in each mock server and their ids need checking against plan risk 3; Copilot's examples also run only on Linux. Google ADK and Cloudflare Agents mock in process and look straightforward, but the todo named four harnesses and these four came first. A follow-up todo should cover all four before T10, T12, T13 and T15 need replays of them.
- **Replays.** `replay` on a file listing reads its example's transcript and fails when the transcript is missing or malformed, records another file, or was recorded at another pin. Without JavaScript the replay lists every event; `steps.ts` reveals one at a time and marks the listing line each event came from. The transcript joins the render dependencies and the dev server's watched files.
- **Drift.** `results-drift.mjs` compares transcripts byte for byte and fails on an untracked, deleted or orphaned one. Its untracked check had used the pathspec `verify/*/results/`, which matched no file; it now uses `verify/*/results/*`. Changing one prompt in `01-generate-text.ts` left all nine AI SDK examples passing and failed the drift check.
- **Tests.** `scripts/ci/transcripts.test.mjs` (41 tests) checks every committed transcript's shape, bytes, pin and freedom from machine values, and the writer's rules. `scripts/ci/results-drift.test.mjs` adds 6 cases in temporary repositories. The manual runs 237 tests after merging T6, 29 of them T5's: 16 failing fixtures in `test/check-book.test.ts` and one passing one, 8 in `test/interactive.test.ts`, 3 in `test/page-scripts.test.ts`, and a build check. The page-scripts test runs both scripts in happy-dom 21.0.4, a new exact dev dependency published on 2026-10-20, with every network API replaced by a spy, and finds no request.
- `pnpm check`, `pnpm typecheck`, the manual's build, test and `check:book`, and `results-drift.mjs` pass. `node --test scripts/ci/*.test.mjs` passes except `packages-pack.test.mjs`'s offline install, which fails the same way on `main` here because Corepack fetches pnpm 12.21.0 for the fresh project. `pnpm -r --no-bail test` passes for every package except `verify/copilot-sdk`, which needs Linux's `unshare`.
- Fact-check rows 350–368 in `docs/plans/reviews/fact-check-build-book.md` cover T5's claims.
