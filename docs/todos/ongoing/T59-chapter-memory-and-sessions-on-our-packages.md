# T59: Add our own packages to Chapter 5's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T59` |
| Status | `ongoing` |
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
- [ ] Wire the harness as a book harness.
- [ ] Write three examples and their transcripts.
- [ ] Convert the three listings to tabs, update the prose, and log the fact-checks.
- [ ] Run the full checks and move this todo to `done/`.

## Acceptance criteria

- [ ] Each of the three listings is a tabs block with our tab first and the earlier tab unchanged.
- [ ] Each example's checks fail when its claim is false, shown by a mutation.
- [ ] Every new or changed claim has a row in the chapter's fact-check log.
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and `check:book` pass offline.
