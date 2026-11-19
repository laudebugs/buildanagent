# T46: Example: an OpenAI realtime session on the SDK's scripted transport

| Field | Value |
| --- | --- |
| ID | `T46` |
| Status | `ready` |
| Plan | [Book plan §5, BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../ongoing/T5-book-interactive-listings.md), [U20](../done/U20-research-voice-and-realtime.md) |
| Size | M |

## Goal

Write a new type-checked, mock-run example in `verify/openai-agents-sdk/examples/` so Section T38 (voice and realtime agents in Chapter T35) has code behind its subject. The example runs a `RealtimeSession` against `ScriptedRealtimeTransport`, the in-memory transport that `@openai/agents-realtime` 0.21.0 ships for deterministic tests, so it needs no network and no new dependency. It shows four behaviours in code: the session's history, a tool call, an approval and an interruption. U20's research found that no example in `verify/` runs a voice session, and that our OpenAI runner skips every realtime source today, our own examples included ([U20 report, Examples](../../research/voice/voice-and-realtime.md#two-new-examples-would-give-the-section-its-listings-led-by-a-scripted-openai-realtime-session)). The owner approved this example, and the runner change, on 2026-11-19.

## Context

- [U20 report, Examples](../../research/voice/voice-and-realtime.md#two-new-examples-would-give-the-section-its-listings-led-by-a-scripted-openai-realtime-session): the four checks, and which of them the SDK's own doc tests already cover
- [OpenAI testing guide, mirrored](../../reference/openai-agents-sdk/source/docs/src/content/docs/guides/testing.mdx): the scripted doubles "make no model, sandbox provider, or Realtime API requests", and audio playback and server behaviour "require the real transport"
- `verify/openai-agents-sdk/node_modules/@openai/agents-realtime/dist/testing/scriptedRealtimeTransport.d.ts`: the transport's API, from the `./testing` export
- [`verify/openai-agents-sdk/scripts/run-examples.mjs`](../../../verify/openai-agents-sdk/scripts/run-examples.mjs), line 26: the pattern that skips every source matching `@openai/agents/realtime`, `RealtimeSession` or `RealtimeAgent`
- [Book plan BK20](../../plans/build-book.md#bk20-new-verify-examples-fill-the-gaps-the-coverage-review-found-accepted) and the section's todo, [T38](T38-section-voice-and-realtime.md)
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk): behavioural examples, mock models, and no host-touching tools

## Scope

**In scope**

- `verify/openai-agents-sdk/examples/10-realtime-session.ts`, asserting its behaviour with `check()`. Number 10 is free as of 2026-11-19; if T40 or T42 has taken it first, use the next free number
- A change to `run-examples.mjs` so the realtime pattern exempts sources that import `@openai/agents-realtime/testing`, while doc blocks that need a real transport stay skipped
- `// #region` and `// book:note` markers for the section's listing
- A transcript from T5's recorder, if that recorder covers the harness

**Out of scope** (and which todo covers it)

- The chained pipeline and barge-in on Cloudflare: [T47](T47-example-voice-pipeline.md)
- Truncation of the reply to the heard audio, which needs the real transport; the section explains it in prose
- Section T38's prose: [T38](T38-section-voice-and-realtime.md)
- Voice sections in the SDK references: [S10](S10-voice-reference-sections.md)

## Tasks

- [ ] Change the realtime branch of `needsExternal` in `run-examples.mjs` so a source that imports `@openai/agents-realtime/testing` runs, and confirm with `pnpm run verify` that every doc block it skipped before is still skipped.
- [ ] Build a `RealtimeAgent` with one `tool()` and one `needsApproval` tool, and a `RealtimeSession` on a `ScriptedRealtimeTransport`.
- [ ] Assert U20's four checks with `check()`:
  1. a user message and the scripted reply leave `session.history` equal to the script;
  2. a scripted `function_call` runs the `tool()` and returns its output through `sendFunctionCallOutput`;
  3. the `needsApproval` tool raises `tool_approval_requested` and runs only after `session.approve()`;
  4. `session.interrupt()` reaches the transport, and a scripted `audio_interrupted` reaches the session's listener.
- [ ] Record in the example's header that check 3 has no doc test upstream, and that truncation needs the real transport, as of `@openai/agents-realtime` 0.21.0 (November 2026).
- [ ] Run the harness's `pnpm test` twice, and commit its updated `results/` and transcript.
- [ ] Draft the example's header comment, the runner comment and the README line with `/anthropic-skills:writing`, fact-check each claim about the SDK against its pinned `.d.ts`, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] The new example type-checks and passes in the harness's `pnpm test`, offline, with every `check()` passing
- [ ] The runner runs the new example and still skips every realtime doc block that needs a real transport, so `results/` changes only by the new example
- [ ] No mock model or scripted transport calls a tool that touches the host
- [ ] The results-drift check passes after the committed results update
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`pnpm test` and `pnpm run verify` in `verify/openai-agents-sdk`, and the root `pnpm test`.

## Docs to update

- `verify/openai-agents-sdk/README.md`: the new example and the runner's exemption
- The book plan's §4.3 row for voice, and T38's listing

## Risks and open questions

- Check 3 has no upstream doc test, so the approval may not behave as the typings suggest. If it fails, record the limit in the example's header and in T38 instead of writing an example that only pretends.
- `@openai/agents-realtime` is a separate package that our weekly SDK-update job moves with `@openai/agents`. A breaking change in the scripted transport would show up as a failing example in that job's pull request.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
