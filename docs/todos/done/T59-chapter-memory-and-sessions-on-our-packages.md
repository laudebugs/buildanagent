# T59: Add our own packages to Chapter 5's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T59` |
| Status | `done` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T15](../done/T15-chapter-memory-and-sessions.md), [N3](../done/N3-session-store.md), [N6](../done/N6-session-runner.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Chapter 5 ("Memory within a task") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Chapter 5 has three replayed listings that our packages can show, and two state listings they cannot. Our session store and session runner live in the private `@buildanagent/harness` (`./session` and `./session/jsonl`, built by [N3](../done/N3-session-store.md) and [N6](../done/N6-session-runner.md)) and run over the SDK's loop and the gateway's model, so the harness becomes a third book harness beside `packages/sdk` and `packages/gateway` ([ADR 0057](../../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)).

**In scope**

- Register `packages/harness` in `apps/manual/src/data/harnesses.json` and in `MOCK_PACKAGES` of `scripts/transcripts/write.mjs`, and add the harness's `test/book-examples.test.ts` (a call to `defineBookExamples`), `examples/lib/` files and an `examples/` entry in its `tsconfig.json`. The harness is private, so its listings show the version it declares (`0.0.0`) and its transcripts record `workspace`.
- `#session-openai` becomes tabs: our tab runs two turns on one session and checks that the second request carries the first exchange.
- `#thread-langchain` becomes tabs: our tab names a session by user and session id, and checks that a new session id and another user's id each start empty.
- `#resume-claude` becomes tabs: our tab runs a second turn from a fresh session object, harness and model over the same store, and checks that the request carries the first turn from the log.
- Update the chapter's prose and notes so each describes both tabs, fact-check every changed claim into `apps/manual/fact-checks/memory-and-sessions.md`, and update `apps/manual/README.md`.

**Stays single, and why**

- `#state-adk` and `#state-cloudflare` already form a tabs block of two third-party listings. Our harness keeps no named state beside the messages, so there is no tab to add.
- No table or figure changes.
- Book examples may not write files ([examples guideline](../../guidelines/examples.md#a-book-example-may-carry-the-plumbing-that-keeps-its-listing-true)), so our resume tab runs over `memoryStore()` and not `jsonlStore()`, and the chapter says so. The harness exports no in-memory `SessionLock`, so a small one lives in `examples/lib/`; a public one would be a package change, left as a proposal.

**Out of scope:** any change to a package's `src/` or `package.json`.

## Tasks

- [x] Read the chapter, its log and the packages; write Scope and Tasks.
- [x] Wire the harness as a book harness.
- [x] Write three examples and their transcripts.
- [x] Convert the three listings to tabs, update the prose, and log the fact-checks.
- [x] Run the full checks and move this todo to `done/`.

## Acceptance criteria

- [x] Each of the three listings is a tabs block with our tab first and the earlier tab unchanged.
- [x] Each example's checks fail when its claim is false, shown by a mutation.
- [x] Every new or changed claim has a row in the chapter's fact-check log.
- [x] `pnpm check`, `pnpm typecheck`, `pnpm test` and `check:book` pass offline.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`
- [ ] Reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- **The harness as a book harness.** `apps/manual/src/data/harnesses.json` and `MOCK_PACKAGES` in `scripts/transcripts/write.mjs` now name `packages/harness`, its own main package, so its listings show the version it declares (`0.0.0`, private) and its transcripts record `@buildanagent/harness@workspace`. The recorder attaches to the SDK's `ScriptedModel`, but `MOCK_PACKAGES` names the harness itself, because the harness depends on the SDK as `workspace:*` and a transcript cannot record that range as a pin. `packages/harness/test/book-examples.test.ts` calls `defineBookExamples()`, `examples/lib/transcript.ts` is a copy of the SDK's recorder file, whose move into `scripts/transcripts/` is a follow-up for the owner, and the package's `tsconfig.json` type-checks `examples/`. No package source or `package.json` changed, so no changeset is needed.
- **The examples.** `01-session-two-runs.ts` (region `session`), `02-session-key.ts` (`sessions`) and `03-resume-from-log.ts` (`resume`) run `openSession()` and `runTurn()` over `memoryStore()` with a scripted model. `examples/lib/check.ts` holds `check()`, `scripted()` and `memoryLock()`; each turn's `runTurn()` call is inline, so a replay's lines point at the turn that made each request. Transcripts are in `packages/harness/results/transcripts/`.
- **The chapter.** `#session-openai`, `#thread-langchain` and `#resume-claude` are tabs blocks with `#session-ours`, `#thread-ours` and `#resume-ours` first and the earlier listing, notes and replay unchanged. `#state-adk` and `#state-cloudflare` stay as they were: our harness keeps no named state beside the messages. The chapter's tables and figures are unchanged.
- **Limits the chapter says plainly.** The resume tab stays in one process, because a book example writes no file ([examples guideline](../../guidelines/examples.md#a-book-example-may-carry-the-plumbing-that-keeps-its-listing-true)), so it shows `memoryStore()` and says `jsonlStore()` would hold the same entries in a file.
- **Found.** The harness exports no in-memory `SessionLock` (only `fileLock`), so a writable session in a file-free example needs a lock of its own, which lives in `examples/lib/check.ts`. A public `memoryLock()` in `@buildanagent/harness/session` would be a package change and is a proposal for the owner, as is letting a book example write inside its own temporary directory.
- **Fact-check.** Rows 107–135 in `apps/manual/fact-checks/memory-and-sessions.md`; rows 112, 118, 119 and 122 are ✏️ corrections from the first code review (rows 129–132), and the tally reads 135 rows.
