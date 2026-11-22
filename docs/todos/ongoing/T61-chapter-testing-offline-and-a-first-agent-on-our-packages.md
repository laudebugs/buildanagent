# T61: Add our own packages to Chapter 7's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T61` |
| Status | `ongoing` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T16](../done/T16-chapter-testing-offline-and-a-first-agent.md), [B18](../done/B18-testing-export.md), [B19](../done/B19-triage-capstone.md), [T50](../done/T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Chapter 7 ("Testing offline, and a first complete agent") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Chapter 7 has fourteen listings in five blocks. Our SDK, `@buildanagent/sdk` with its `./testing` export, can show every block, so each gains a first tab and keeps its third-party tabs.

**Gains a first tab on our SDK:**

- The four mock listings (`mock-openai`, `mock-langchain`, `mock-pi`, `mock-adk`): a new `11-scripted-turns.ts` shows `ScriptedModel` playing a tool turn and then a text turn, keeping each request in `calls`.
- `check-helper`: the `check` region of `examples/lib/check.ts`, which our examples share.
- `weak-check`: a new `12-weak-check.ts`, the same empty-answer lesson on `run()`.
- `capstone-ai`: a new `13-triage-agent.ts`, a whole-run listing with a replay: a lookup, a gate that pauses the escalation, a signed resume, a typed result and a step cap.
- The seven gate listings: our tab is the `gate` region of `13-triage-agent.ts`, a `beforeToolCall` interceptor that asks.
- `capstone-differences`: a ninth row for our SDK.

**Stays single:** no listing. The chapter says that our SDK is a ninth beside the eight it compares, and that its test model is strict like three of theirs.

The unnumbered `triage-agent.ts` follows the full example rules and has no checks, so the chapter lists the numbered `13-triage-agent.ts` instead.

## Tasks

- [x] Read the chapter, its log and the packages; write Scope and Tasks.
- [ ] Add `11-scripted-turns.ts`, `12-weak-check.ts` and `13-triage-agent.ts` to `packages/sdk/examples/` and the `check` region to `lib/check.ts`; commit their transcripts.
- [ ] Turn the chapter's blocks into tabs with our SDK first; update the prose, the table and the sources.
- [ ] Log every new or changed claim in the chapter's fact-check file and update its tally.
- [ ] Run the full check list and move this todo to `done/`.

## Acceptance criteria

- [ ] Each qualifying listing's first tab runs offline under the SDK's `test`, with `// #region` and `// book:note` markers and, for the capstone, a transcript the chapter replays.
- [ ] The third-party tabs are unchanged: same file, region, notes and replay.
- [ ] The prose names both tabs where they differ, and every changed claim has a row in the chapter's log.
- [ ] `check:book`, the manual's build and tests, and `pnpm check`, `pnpm typecheck` and `pnpm test` pass.
- [ ] Code review (first round)
- [ ] Code review (second round)
- [ ] Writing review
