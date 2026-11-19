# B15b: `continueRun`, `blockingApprovals()` and the clarification pause

| Field | Value |
| --- | --- |
| ID | `B15b` |
| Status | `done` |
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

- [x] Fail closed on a missing, unknown-key or invalid signature, and on an input hash mismatch: the call does not run and the request is re-issued.
- [x] Make sure approval resolution does not count as a step.
- [x] Test resume in a fresh `continueRun` call with a serialised `context` (JSON round trip), as a second process would, and with a `Context` assembled by hand from stored messages.
- [x] Rely on B6's rule that drops a trailing errored assistant message, and test the re-issue through `continueRun`.

## Acceptance criteria

- [x] `continueRun` with an `allow` resolution runs the call once without calling `beforeToolCall` (a spy gate records no call); with `deny` the model sees an error result
- [x] A tampered signature, an unknown key id, a changed input and a resolution for an unknown request id each run nothing and re-issue the request
- [x] A resume after a JSON round trip of `context` works, and so does a resume from a `Context` built by hand from the same messages and pending requests
- [x] `continueRun` on a context whose last message has `stopReason: "error"` re-issues the model call, and the scripted model records one new request
- [x] `blockingApprovals()` emits `approval_request` before it waits (event order test)
- [x] A clarification answer reaches the model as the tool result
- [x] The step count is unchanged by a resolution
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/pauses.test.ts`, `resume.test.ts`, `clarification.test.ts`.

## Docs to update

`packages/sdk/README.md`: resume and clarification. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

An approved call must run with the input its request signs, which `context.pendingInputs` holds by request id, not with the call's arguments in `messages`: coercion, `repair` and a gate's replacement can change it. A context stored without `pending` passes B15's guard, and the gateway answers its open call with "No result was recorded for this tool call". Decide whether `continueRun()` should refuse a context whose last assistant message has calls with no results.

**Answered (owner, 2026-11-19):** `continueRun()` refuses a context whose last assistant message has calls with no results and no matching signed pending request. It throws `SdkError` `invalid_run_options`, so a lost pending record becomes a loud error instead of a quiet "No result was recorded".

A hand-built `Context` may omit a field a result carries. The JSON round-trip test and the hand-built test share one fixture, so any such field shows up as a failing diff.

## History

On 2026-11-19, when B15b started, the owner answered the open question above: refuse a context whose waiting call has no pending request. The owner's earlier answer for B15 stands too: the signed-request kinds stay as D5 defines them, with no `"plan"` kind.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`continueRun(context, { resolutions, recheck })` resumes a paused context in any process that holds the key ring. Before the first model call, `resumeSetupOf()` in `packages/sdk/src/resume.ts` checks the context's shape, and `judgeOpenCalls()` checks every waiting call's stored request with the safety package's `verifyResolution()`: the signature under its `keyId`, the call id and tool against the transcript's call, the input in `context.pendingInputs` against the signed hash, and the resolution's kind. The loop then acts on each verdict:

- A verified `allow` runs the call once, with the input its request signs and not the transcript's arguments, without `beforeToolCall`. The pipeline's `approved` mode skips coercion, `repair` and the gate, checks the signed input against the schema once more, and runs `afterToolCall` as usual.
- A verified `deny` becomes an error result with the reason, and a verified `answer` becomes the call's result.
- A request no resolution names, which still verifies, waits; the run then ends paused again with no model call.
- A request or resolution that fails a check runs nothing, emits `resolution_rejected` with the cause, and asks again. The run's gate is asked as for a new call, but the call never runs: a deny blocks it, and an `ask`, an `allow` or no gate pauses it with a new request.

The changeset is `.changeset/continue-run-resolutions.md`, a `minor` bump that opens with "Breaking Changes".

Decisions:

- The owner's 2026-11-19 answer: a waiting call with no result and no pending request throws `invalid_run_options`. A pending request whose call doesn't wait, and malformed `pending`, `pendingInputs`, `resolutions` or `recheck`, throw too.
- `recheck` (the safety package's `Recheck`) runs current policy before an approved call, at the coordinator's request and matching E3's adapter; the todo had left policy re-evaluation to the harness. A `recheck` that denies, throws or returns anything else gives the model an error result and runs nothing. Without it, a verified approval runs, as the plan's sketch says.
- Re-issue means "the tool asks again" (ADK's behaviour in D5's evidence), but never runs in the same resume, so a forged resolution can't make a call run even under a gate that now allows it.
- Single use across processes is the host's store's job, as in E3's adapter, and the README says to mark a request used before resuming it. Within one call, two resolutions for one request are refused as `replayed`.
- The clarification pause is a stop reason of its own, `clarification_requested` (`ClarificationRequestedResult`), as the plan's sketch had it, replacing `stopped` with `stoppedBy: "clarification"`. Any tool result with `pause` signs a `clarification` request over the input the tool ran with; the call gets no result and no `tool_call_end`. A step with both kinds ends `awaiting_approval`, with the requests in model order. A clarification request that fails its check asks again as an approval, so nothing runs; once approved, the tool asks its question again.
- `blockingApprovals(handler)` returns an `Interceptors` object that carries the handler under a private symbol, so the six hook moments stay as they are; `composeInterceptors()` passes it on and refuses two. The runner emits `approval_request` before it calls the handler, checks the answer with `verifyResolution()`, and denies the call on any failure, a throwing handler or an abort.
- Resume events carry `stepIndex` 0 and come before the first `step_start`. No key, signature or signer message reaches `resolution_rejected`.

Each criterion and the test that covers it:

- Allow without the gate, deny as an error: "an allow runs the call once, with the input its request signs, and without calling beforeToolCall" and "a deny gives the model an error result with the reason, and the call never runs" (`resume.test.ts`).
- Tampered signature, unknown key id, changed input, unknown request id: the four tests of those names, plus "a request moved onto another call, a resolution of the wrong kind and a replay each run nothing" (`resume.test.ts`). Each resumes with a second `hmacSigner()` instance over the same key bytes, as a second process would.
- JSON round trip and hand-built context: "a context rebuilt by hand from the stored events resumes like the result's context after a JSON round trip" (`resume.test.ts`), whose one fixture asserts the two contexts are equal before both resume.
- Errored last message: "a context whose last response ended in an error asks the model again, and the model records one new request" (`resume.test.ts`).
- `blockingApprovals()` order: "blockingApprovals() emits approval_request before it waits (event order)", with allow, deny, refused answers, abort and composition (`pauses.test.ts`).
- Clarification answer: "the answer reaches the model as the tool result, in a fresh continueRun" (`clarification.test.ts`).
- Step count: "settling the requests is not a step: steps count only the resumed run's model calls" (`resume.test.ts`).
- The owner's refusal: "continueRun() refuses a waiting call with no pending request and a request whose call doesn't wait" (`resume.test.ts`) and "continueRun() refuses a paused context stored without its pending requests" (`pending.test.ts`).
- Offline checks: `pnpm check`, `pnpm typecheck` and `pnpm test` pass from the repo root.
