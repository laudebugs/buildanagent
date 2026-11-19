# T49: Transcripts for the Claude Agent SDK and Copilot SDK, whose mocks answer over HTTP

| Field | Value |
| --- | --- |
| ID | `T49` |
| Status | `ready` |
| Plan | [Book plan §5, BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Let the book replay the Claude Agent SDK and Copilot SDK examples that Part I lists, as it replays the other six harnesses' examples. Both harnesses mock the provider over HTTP, so their recorders belong in the mock servers, and their runtime ids must normalise to the same bytes on every run before their transcripts are committed.

## Context

- [T5's Outcome](../done/T5-book-interactive-listings.md#outcome): the transcript format in `scripts/transcripts/events.ts`, the recorder (`record.mjs`), the writer (`write.mjs`) and the six harnesses it covers.
- [Book plan §4.1](../../plans/build-book.md#41-part-i-foundations-for-developers-new-to-agents): T12, T13 and T15 list `verify/claude-agent-sdk/examples/02-custom-tool.ts`, `04-max-turns.ts` and `06-resume-session.ts`, and T11 lists `verify/copilot-sdk/examples/05-streaming.ts`.
- The mocks: `verify/claude-agent-sdk/scripts/mock-anthropic.mjs`, a local Messages API that the SDK's bundled `claude` CLI calls, and `verify/copilot-sdk/scripts/mock-model.mjs`, a Messages API mock that the Copilot runtime reaches as a BYOK provider. In both, the SDK runs the CLI or the runtime in a child process, so the example's own process sees no model call.
- Plan risk 3: runtime-generated ids in these two harnesses may resist normalisation.

## Scope

**In scope**

- A recorder in each mock server that writes the requests and answers it serves in the transcript format, and a runner change that merges them with the example process's checks into one transcript
- Normalised message ids, session ids and tool-use ids, with two runs of each `pnpm test` writing identical bytes
- Each harness's entry in `MOCK_PACKAGES` (`scripts/transcripts/write.mjs`), its README section on transcripts, and its transcripts committed
- Copilot's examples run only on Linux, inside `unshare`; record and check its transcripts in CI or on a Linux machine

**Out of scope** (and which todo covers it)

- Lines for events: the model calls happen in the CLI's process, so they carry none unless the example's call can be matched to them ([T5](../done/T5-book-interactive-listings.md) shows "no source line")
- The live run's transcripts ([T27](T27-book-live-run.md))

## Tasks

- [ ] Record each request and answer inside `mock-anthropic.mjs` and `mock-model.mjs`, mapped to the transcript's parts, and pass the events to the runner through a file the runner names.
- [ ] Merge the mock's events with the example's checks in the order they happened, and write the transcript with `writeTranscript()`.
- [ ] Find every id that varies between runs and normalise it, or leave the harness without transcripts and say why in its README.
- [ ] Run each harness's `pnpm test` twice and diff the transcripts; for Copilot, do it on Linux.
- [ ] Add each harness to `MOCK_PACKAGES`, commit the transcripts, and check that `results-drift.mjs` and `scripts/ci/transcripts.test.mjs` pass.

## Acceptance criteria

- [ ] Two runs of each harness's `pnpm test` write byte-identical transcripts, and every example still passes
- [ ] A listing of `verify/claude-agent-sdk/examples/02-custom-tool.ts` with `replay` passes `check:book`
- [ ] No listed region in either harness holds recorder code (`scripts/ci/transcripts.test.mjs`)

## Tests

Each harness's `pnpm test` for the recorder; `node --test scripts/ci/*.test.mjs` for the format and the drift check.

## Docs to update

- `verify/claude-agent-sdk/README.md` and `verify/copilot-sdk/README.md`: the transcripts section, in place of "no transcript recorder yet"
- `apps/manual/README.md`: the list of harnesses that record transcripts

## Risks and open questions

- If an id stays random after normalisation, the harness keeps no transcripts, and the chapters list its examples without `replay`.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
