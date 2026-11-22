# T49: Transcripts for the Claude Agent SDK and Copilot SDK, whose mocks answer over HTTP

| Field | Value |
| --- | --- |
| ID | `T49` |
| Status | `done` |
| Plan | [Book plan §5, BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Let the book replay the Claude Agent SDK and Copilot SDK examples that Part I lists, as it replays the other six harnesses' examples. Both harnesses mock the provider over HTTP, so their recorders belong in the mock servers, and their runtime ids must normalise to the same bytes on every run before their transcripts are committed. Once their transcripts exist, give both harnesses the live mode that T27 gave five others, so the occasional live run can compare them too. T27's review added that step on 2026-11-19, when it found that no todo owned it.

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
- After the transcripts: a `--live` mode in both harnesses' `scripts/run-examples.mjs`, as [T27](../done/T27-book-live-run.md) built for five others (`scripts/live/harness.mjs`, `scripts/live/live.ts`), with each harness added to `LIVE_HARNESSES` in `scripts/live/config.mjs`. The Claude Agent SDK reaches Anthropic through its bundled CLI and the Copilot SDK either provider through BYOK (book plan BK18), and both CLIs offer host tools that the live mode must deny by name and type. Adding their examples to `apps/manual/src/data/live-examples.json` is the owner's choice, since it changes what a run costs

**Out of scope** (and which todo covers it)

- Lines for events: the model calls happen in the CLI's process, so they carry none unless the example's call can be matched to them ([T5](../done/T5-book-interactive-listings.md) shows "no source line")
- The live run itself, its workflow and its comparison ([T27](../done/T27-book-live-run.md))

## Tasks

- [x] Record each request and answer inside `mock-anthropic.mjs` and `mock-model.mjs`, mapped to the transcript's parts, and pass the events to the runner through a file the runner names.
- [x] Merge the mock's events with the example's checks in the order they happened, and write the transcript with `writeTranscript()`.
- [x] Find every id that varies between runs and normalise it, or leave the harness without transcripts and say why in its README.
- [x] Run each harness's `pnpm test` twice and diff the transcripts; for Copilot, do it on Linux.
- [x] Add each harness to `MOCK_PACKAGES`, commit the transcripts, and check that `results-drift.mjs` and `scripts/ci/transcripts.test.mjs` pass.
- [x] Add `replay` to Chapter 4's `#cap-claude` and Chapter 5's `#resume-claude` listings, describe what each replay shows where the chapter's prose needs it, and fact-check each change into `apps/manual/fact-checks/stopping-and-structured-output.md` and `memory-and-sessions.md`.
- [x] Add `--live` to both harnesses' runners, pass the key from `LIVE_API_KEY_FILE` to the CLI's child process in its allowlisted environment, deny the CLIs' host tools, and test each against `scripts/ci/live-stub.mjs` as `scripts/ci/live-run.test.mjs` tests the other five.

## Acceptance criteria

- [x] Two runs of each harness's `pnpm test` write byte-identical transcripts, and every example still passes
- [x] A listing of `verify/claude-agent-sdk/examples/02-custom-tool.ts` with `replay` passes `check:book`
- [x] Chapter 4's `#cap-claude` listing (`verify/claude-agent-sdk/examples/04-max-turns.ts`, region `max-turns`) and Chapter 5's `#resume-claude` listing (`verify/claude-agent-sdk/examples/06-resume-session.ts`, region `resume`) gain `replay`, and each chapter's fact-check log gains rows that check what its replay shows and the prose that describes it (the owner's decision, 2026-11-19: "yes, i accept these")
- [x] No listed region in either harness holds recorder code (`scripts/ci/transcripts.test.mjs`)
- [x] Both harnesses run a listed example live against the stub, with no key in any written file or log

## Tests

Each harness's `pnpm test` for the recorder; `node --test scripts/ci/*.test.mjs` for the format and the drift check.

## Docs to update

- `verify/claude-agent-sdk/README.md` and `verify/copilot-sdk/README.md`: the transcripts section, in place of "no transcript recorder yet"
- `apps/manual/README.md`: the list of harnesses that record transcripts
- Chapters 4 and 5 (`stopping-and-structured-output.md`, `memory-and-sessions.md`) and their fact-check logs: the two new replays

## Risks and open questions

- If an id stays random after normalisation, the harness keeps no transcripts, and the chapters list its examples without `replay`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Both harnesses that mock over HTTP now record transcripts and have a live mode, so the book replays their listings and the live run can compare them like the other five.

- **Transcripts.** Each mock reports the requests and answers it serves in the transcript format. The Claude Agent SDK's mock runs in the runner's process, so the runner merges its events with the example's checks by the millisecond; the Copilot SDK's runs inside the example's process, where the recorder hears it directly. The recorders drop what varies by machine and day: the CLI's system reminders and environment note, and the runtime's system reminder and clock reading. The Claude mock's tool-use ids now count per server, and `09-skills.ts` keeps its project folder inside the run's own directory. Two runs, on one worker or four, write identical bytes, and both harnesses are in `MOCK_PACKAGES`.
- **Replays.** Chapter 4's `#cap-claude` and Chapter 5's `#resume-claude` gain `replay`, with their chapters' fact-check rows. A listing of `02-custom-tool.ts` with `replay` also passes `check:book`, tested on 2026-11-22 and reverted, because no chapter asks for one.
- **A live mode through a proxy that alone holds the key.** The CLI and the runtime make the model calls from a child process, so each runner starts `scripts/live/proxy.mjs` in its own process and runs the example, with its CLI or runtime, in `unshare -rn`. A forwarder inside the namespace copies each connection to the proxy's Unix socket. The proxy reads the key file and deletes it, and the CLI and the runtime get a placeholder key and no provider headers. Before each call the proxy refuses a host tool by name or type and any body field it doesn't know, sets the run's model and output cap, drops `metadata`, and checks the cost guard. The Claude preload limits the CLI to `--tools=ToolSearch` and refuses non-SDK MCP servers; the Copilot preload excludes `builtin:*` and `mcp:*` and points every session at the proxy through BYOK on either provider.
- **Tests.** `live-run.test.mjs` runs `02-custom-tool.ts` on Anthropic and `05-streaming.ts` on OpenAI live through `run.mjs` against the stub, with dummy key files, and finds the mock's flow and no key, account id or request id in any written file, request log or output. It also tests the proxy's refusals, rewrites and redaction in a child process, and that the namespace can't reach the host's loopback interface. The stub now streams text in two deltas, as real streams send many.
- **Left for the owner.** `live-examples.json` lists none of the two harnesses' examples, because adding one changes what a run costs. `live-run.yml`'s provider jobs run `ci.yml`'s step that allows unprivileged user namespaces, which the owner added to the pull request, since the live mode refuses to run without one. No real provider has seen the proxy yet, so the first live run will show whether the CLI and the runtime accept its answers and its field list.

Fact-check rows T49-1 to T49-38 in [the book plan's log](../../plans/reviews/fact-check-build-book.md) record the claims.
