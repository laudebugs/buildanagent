# T47: Example: a chained voice pipeline with a tool and barge-in on Cloudflare

| Field | Value |
| --- | --- |
| ID | `T47` |
| Status | `ongoing` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md), [U20](../done/U20-research-voice-and-realtime.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/cloudflare-agents/examples/` so Section T38 (voice and realtime agents in Chapter T35) can show the chained pipeline beside T46's speech-to-speech session. On Cloudflare the loop stays an ordinary `streamText` call inside `onTurn`, between speech-to-text and text-to-speech, so the listing shows that a voice agent keeps the text loop. The example gives a `withVoice(Agent)` class a fake `Transcriber` and a fake `TTSProvider`, runs one tool inside `onTurn`, and interrupts the agent while it speaks. U20's research designed it but could not run it, because no voice example has run in our workerd harness yet ([U20 report, Examples](../../research/voice/voice-and-realtime.md#two-new-examples-would-give-the-section-its-listings-led-by-a-scripted-openai-realtime-session)). The owner approved this example on 2026-11-19.

## Context

- [U20 report, Examples](../../research/voice/voice-and-realtime.md#two-new-examples-would-give-the-section-its-listings-led-by-a-scripted-openai-realtime-session): the design and its four assertions
- [U20 report, SDKs](../../research/voice/voice-and-realtime.md#two-sdks-ship-a-voice-agent-two-ship-experimental-live-layers-and-four-leave-voice-to-the-builder): Cloudflare's voice mixin is experimental and keeps only `{ role, content }` text in its history
- [Cloudflare voice doc, mirrored](../../reference/cloudflare-agents/source/agents/docs/agents/voice.md): "**Experimental.** This API is under active development and will break between releases"
- `verify/cloudflare-agents/node_modules/agents/dist/voice/index.d.ts`: `withVoice`, `onTurn(transcript, context)` and `VoiceTurnContext`
- [`verify/cloudflare-agents/scripts/run-examples.mjs`](../../../verify/cloudflare-agents/scripts/run-examples.mjs): it skips `agents/voice` only in doc blocks, so our own example needs no runner change
- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and the section's todo, [T38](T38-section-voice-and-realtime.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools

## Scope

**In scope**

- `verify/cloudflare-agents/examples/11-voice-pipeline.ts`, asserting its behaviour with `check()`. T44 claims number 10; if T33 or another todo has taken 11 first, use the next free number
- A fake `Transcriber` that turns one audio frame into an interim and a final transcript, and a fake `TTSProvider` that returns fixed bytes
- `// #region` and `// book:note` markers for the section's listing
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- The speech-to-speech session: [T46](T46-example-realtime-session.md)
- Workers AI's built-in speech models, which have no local simulation
- Section T38's prose: [T38](T38-section-voice-and-realtime.md)
- Voice sections in the SDK references: [S10](S10-voice-reference-sections.md)

## Tasks

- [ ] Give a `withVoice(Agent)` class the two fakes, and run `streamText` on the harness's scripted model with one tool inside `onTurn`.
- [ ] Over the Agent's WebSocket in workerd, assert U20's four behaviours with `check()`:
  1. an interim and a final transcript arrive;
  2. the tool runs inside `onTurn`;
  3. at least one audio frame and a `turn_metrics` message follow;
  4. an `interrupt` message sent while the agent speaks aborts `context.signal` and returns the status to `listening`.
- [ ] Record in the example's header that the API is experimental at `agents` 0.33.0, as of November 2026, and that a tool result from one turn reaches the next only if the agent stores it.
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment and README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts` or the mirrored doc, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing, or the header and T38 record which behaviour local workerd could not show
- [ ] No mock model calls a tool that touches the host
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` in `verify/cloudflare-agents`, and the root `pnpm test`.

## Docs to update

- `verify/cloudflare-agents/README.md`: the new example
- The book plan's §4.3 row for voice, and T38's listing

## Risks and open questions

- The design is untested, and the voice mixin may need bindings that local workerd lacks. If it does, record the limit in the harness README and in T38, and keep whatever half of the example runs.
- The API "will break between releases", so the next `agents` upgrade may fail this example. That failure is the point: the weekly SDK-update job's pull request then shows what changed.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
