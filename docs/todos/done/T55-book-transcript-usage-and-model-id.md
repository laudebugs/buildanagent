# T55: Record token usage and the model id in the book's transcripts, at the mock layer and deterministically

| Field | Value |
| --- | --- |
| ID | `T55` |
| Status | `done` |
| Plan | [Book plan §5, BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Make each recorded answer in a transcript carry the token usage and the model id that the mock reported, so the book's replays show what a call cost and which model answered. Today a replay shows neither. Chapter 2 has to say so in its usage section: "The model's answer in the replay carries no usage of its own, because this book's transcripts record no usage yet. The transcript also names the model `model-1`, not Claude Sonnet 5.5." The example behind that replay, `verify/vercel-ai-sdk/examples/10-streaming-usage.ts`, already scripts both: its model reports `modelId: "claude-sonnet-5-5"` and four token classes, and the recorder drops them. The values come from each example's script, so recording them keeps the transcripts deterministic. This todo should land before [T18](T18-chapter-the-model-gateway.md), the model gateway chapter, whose sections on cost and caching need replays that show the counts. The owner accepted it on 2026-11-19 ("yes, i accept these").

## Context

- [T5's Outcome](../done/T5-book-interactive-listings.md#outcome) and [BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed): the recorder, the writer and the six harnesses that record transcripts.
- [`scripts/transcripts/events.ts`](../../../scripts/transcripts/events.ts): the format, `TRANSCRIPT_FORMAT = 1`, and `modelNames()`, which names each model `model-1`, `model-2` and so on, in the order of its first request. The writer uses that name as a key: it shortens each request to what is new since the same model's previous request and answer.
- [`scripts/transcripts/write.mjs`](../../../scripts/transcripts/write.mjs) and [`record.mjs`](../../../scripts/transcripts/record.mjs): the writer's normalisation and the recorder.
- Each harness's `examples/lib/transcript.ts`, which maps its SDK's messages to the format, and its `examples/lib/check.ts`, whose scripted model sets the usage and the model id. The AI SDK's scripted model reports 10 input and 5 output tokens by default and `options.modelId` when a script sets one (`verify/vercel-ai-sdk/examples/lib/check.ts`).
- `apps/manual/src/book/transcripts.ts`, the schema the book reads transcripts with, and `apps/manual/src/components/replay-html.ts`, which renders each event.
- Chapter 2, `apps/manual/src/content/chapters/talking-to-a-model.md`, the paragraph that opens "The replay beside [[lst:stream-usage]]", and rows 49 and 116 of its fact-check log.
- `scripts/ci/transcripts.test.mjs` and `scripts/ci/results-drift.mjs`: the format tests and the drift check.

## Scope

**In scope**

- Two optional fields on a `response` event. The first holds the usage the mock reported, in the SDK guide's four token classes (uncached input, cache reads, cache writes and output), plus reasoning tokens where the SDK reports them. The second holds the model id the mock reported, apart from `model`, which stays the writer's key
- A format version bump to 2, with the book's schema reading both versions until every committed transcript is rewritten
- Each of the six recording harnesses' mappers filling the fields from what its mock reports, or leaving them out where the mock reports nothing
- The replay showing the usage and the model id on each answer, with and without JavaScript
- Chapter 2's paragraph rewritten to read the counts from the replay, with fact-check rows; row 116 marked ✏️ and corrected by the new row

**Out of scope** (and which todo covers it)

- The Claude Agent SDK's and Copilot SDK's transcripts: [T49](../done/T49-book-http-mock-transcripts.md), which should record the same fields once it lands
- Cost in the transcript: a price is a catalog lookup that changes with the catalog's date, so the chapters compute cost in the example and show it through a check, as Chapter 2 does
- Our own packages' transcripts: [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) builds that recorder, and it should adopt the format this todo sets

## Tasks

- [x] Decide what counts as usage worth recording. The AI SDK's scripted model reports 10 input and 5 output tokens when a script sets none, and a replay that shows those placeholder counts would teach a reader nothing. Record usage only where the example's script set it, or mark the default as such; write the rule into `events.ts`.
- [x] Add the fields to `TranscriptEvent`, bump `TRANSCRIPT_FORMAT`, and teach `write.mjs` to keep them unchanged.
- [x] Fill them in each harness's `examples/lib/transcript.ts` from what its mock reports, and in workerd through the Cloudflare harness's marked console lines.
- [x] Run each harness's `pnpm test` twice and diff the transcripts, then commit them.
- [x] Extend the book's transcript schema and the replay renderer; add a test in `apps/manual/test/` for an answer with usage and a model id and for one without.
- [ ] Rewrite Chapter 2's paragraph, fact-check it, and run `/anthropic-skills:writing-review` on the section.

## Acceptance criteria

- [x] `verify/vercel-ai-sdk/results/transcripts/10-streaming-usage.json` records the answer's model id as `claude-sonnet-5-5` and its usage as 1,000 uncached input, 1,500 cache-read, 500 cache-write and 200 output tokens
- [x] Two runs of each recording harness's `pnpm test` write byte-identical transcripts, and every example still passes
- [x] The replay beside `#stream-usage` shows the counts and the model id on the answer, and Chapter 2 no longer says that the transcripts record no usage
- [x] `scripts/ci/transcripts.test.mjs` covers the new fields and the version bump, and `results-drift.mjs` reports no drift
- [x] `check:book`, the manual's `test` and `build`, and `pnpm fact-check-logs` pass
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`node --test scripts/ci/*.test.mjs` for the format, the writer and the drift check; each recording harness's `pnpm test`; the manual's `test`, including the replay rendering and the page-script tests.

## Docs to update

- `apps/manual/README.md`: what a replay shows for each answer
- [Book plan BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed): the transcript format's fields
- [T49](../done/T49-book-http-mock-transcripts.md) and [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md), if their recorders have not yet landed: record the same fields
- Chapter 2 and its fact-check log

## Risks and open questions

- Each SDK names the token classes differently, and some mocks report fewer classes. Map each to the SDK guide's four classes and leave out a class the mock does not report, rather than writing a zero that reads as a measurement.
- A model id that a mock generates, such as a default `mock-model-id`, says nothing about a real model. Record the id only where the script set it, by the same rule as usage.
- Rewriting every committed transcript makes a large diff. Keep the rewrite in its own commit, and check that only the new fields changed.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Each recorded answer now carries the token usage and the model id its mock reported, wherever the example's script set them, and the book's replays show both.

- **Format 2.** `scripts/transcripts/events.ts` gives a `response` event an optional `usage` (`uncachedInput`, `cacheRead`, `cacheWrite`, `output` and `reasoning`) and an optional `modelId`, kept apart from `model`, and states the rule: a value no script chose stays out, and so does a class the mock did not report. A helper marks a default object with `placeholder()`, as the AI SDK's and Cloudflare's `scripted()` do with their 10 and 5 tokens. The writer keeps both fields as written and checks their shape.
- **Recorders.** The AI SDK, Cloudflare (through its marked console lines), LangChain, OpenAI Agents SDK, Google ADK and our own SDK's recorders map their mock's usage to the four classes. Pi's faux provider replaces a step's usage with an estimate and its model with `faux-1`, and the Claude Agent SDK's and Copilot SDK's HTTP mocks send the same 10 and 5 tokens with every answer, so those three record neither field, and each says why in code.
- **Transcripts.** One commit rewrote all 77 committed transcripts: the format line everywhere, plus the new fields on the answers of `10-streaming-usage`, `11-tuned-vs-cached` and `12-retries-caching-budget`, the only examples whose scripts set them. A second run of every harness, the Claude Agent SDK's as a non-root user, wrote identical bytes.
- **Book.** The schema reads formats 1 and 2, and the replay shows "Model id" and "Usage" under the answer's text with or without JavaScript. Chapter 2's usage paragraph reads the counts from the answer, with fact-check rows 126–129, and row 116 is corrected by row 126.

The writing review and the code reviews run on the pull request.
