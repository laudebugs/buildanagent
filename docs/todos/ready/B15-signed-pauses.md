# B15: Signed approval and clarification pauses, and `continueRun`

| Field | Value |
| --- | --- |
| ID | `B15` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-the-loop) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B13](B13-interceptors-observers.md) |
| Size | L |

## Goal

Make every pause a signed, resumable result: a gate that returns `ask` or a clarification tool ends the run, and any process can resume it with a resolution.

## Context

- [agent-SDK guide §7](../../guides/agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback): signed log states, the blocking wrapper, the no-handler outcome, clarification
- [D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-owner-to-confirm-with-p2)
- [seams §3.4](../../plans/build-sdk.md#34-the-seams-p2-consumes)

## Scope

**In scope**

- `SignedPendingRequest`, `Resolution`, `ApprovalSigner`, `ephemeralSigner()`, `hmacSigner()` with key ids, `canonicalInputHash()`
- `awaiting_approval` and `clarification_requested` stop reasons with `pending` on the result and in `context`
- `continueRun(context, { resolutions })`: verify signatures, revalidate the input hash, run approved calls, turn denials into error results, turn answers into tool results
- `blockingApprovals()`: emits `approval_request`, waits, then resumes in-process
- `clarificationTool()` wired to the pause

**Out of scope** (and which todo covers it)

- Key storage and rotation policy (P2 and the owner, D5)

## Tasks

- [ ] Implement canonical JSON hashing with Web Crypto SHA-256, and HMAC-SHA-256 signing over the D5 payload.
- [ ] Fail closed on a missing, unknown-key or invalid signature, and on an input hash mismatch: the call does not run and the request is re-issued.
- [ ] Make sure approval resolution does not count as a step.
- [ ] Test resume in a fresh `run` call with a serialised `context` (JSON round trip), as a second process would.

## Acceptance criteria

- [ ] A gate returning `ask` ends the run `awaiting_approval` with one signed pending request
- [ ] `continueRun` with an `allow` resolution runs the call once; with `deny` the model sees an error result
- [ ] A tampered signature, an unknown key id, a changed input and a resolution for an unknown request id each run nothing and re-issue the request
- [ ] A resume after a JSON round trip of `context` works
- [ ] Rotating from key `a` to key `b` still verifies a pause signed with `a` when both are in the ring
- [ ] `blockingApprovals()` emits `approval_request` before it waits (event order test)
- [ ] A clarification answer reaches the model as the tool result
- [ ] The step count is unchanged by a resolution
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/pauses.test.ts`, `signer.test.ts`, `clarification.test.ts`.

## Docs to update

`packages/sdk/README.md`: pauses and resume; ADR 0005 if the owner changes the default. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The owner's D5 answer may make `signer` required; that is a small API change inside 0.x.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
