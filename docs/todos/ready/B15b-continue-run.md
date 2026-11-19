# B15b: `continueRun`, `blockingApprovals()` and the clarification pause

| Field | Value |
| --- | --- |
| ID | `B15b` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B15](../done/B15-signed-pauses.md) |
| Size | M |

## Goal

Make every pause resumable from any process: `continueRun` verifies the signed record B15 wrote, runs or denies each call, and a clarification answer reaches the model as a tool result.

## Context

- [agent-SDK guide §7](../../guides/agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback): the blocking wrapper, resume and clarification
- [D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): an unsigned or invalid resume always fails closed
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api): `Context` as plain JSON, and the `continueRun` comments on the gate and on errored messages
- [harness plan §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): needs 4, 6 and 7, which this todo tests

## Scope

**In scope**

- `continueRun(context, { resolutions })`: verify signatures, revalidate the input hash, run approved calls, turn denials into error results, turn answers into tool results
- A verified `allow` runs its call without calling `beforeToolCall` (harness need 7)
- A `Context` built by hand from stored messages resumes like one a result returned (harness need 6)
- A context whose last message is an errored assistant message re-issues the call (harness need 4)
- `blockingApprovals()`: emits `approval_request`, waits, then resumes in-process
- `clarificationTool()` wired to the `clarification_requested` pause

**Out of scope** (and which todo covers it)

- Signers, hashing and the pending record (B15)
- Re-evaluating policy before a resume (the harness's `Approvals.resolve`, N13)

## Tasks

- [ ] Fail closed on a missing, unknown-key or invalid signature, and on an input hash mismatch: the call does not run and the request is re-issued.
- [ ] Make sure approval resolution does not count as a step.
- [ ] Test resume in a fresh `continueRun` call with a serialised `context` (JSON round trip), as a second process would, and with a `Context` assembled by hand from stored messages.
- [ ] Rely on B6's rule that drops a trailing errored assistant message, and test the re-issue through `continueRun`.

## Acceptance criteria

- [ ] `continueRun` with an `allow` resolution runs the call once without calling `beforeToolCall` (a spy gate records no call); with `deny` the model sees an error result
- [ ] A tampered signature, an unknown key id, a changed input and a resolution for an unknown request id each run nothing and re-issue the request
- [ ] A resume after a JSON round trip of `context` works, and so does a resume from a `Context` built by hand from the same messages and pending requests
- [ ] `continueRun` on a context whose last message has `stopReason: "error"` re-issues the model call, and the scripted model records one new request
- [ ] `blockingApprovals()` emits `approval_request` before it waits (event order test)
- [ ] A clarification answer reaches the model as the tool result
- [ ] The step count is unchanged by a resolution
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/pauses.test.ts`, `resume.test.ts`, `clarification.test.ts`.

## Docs to update

`packages/sdk/README.md`: resume and clarification. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

A hand-built `Context` may omit a field a result carries. The JSON round-trip test and the hand-built test share one fixture, so any such field shows up as a failing diff.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
