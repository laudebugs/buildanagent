# B15: Signed pauses in the loop on the safety package's signers, and `createPendingRequest`

| Field | Value |
| --- | --- |
| ID | `B15` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B13](../done/B13-interceptors-observers.md), [E3](../done/E3-signed-approvals-third-party.md) |
| Size | M |

## Goal

Make every pause a signed record: a gate that returns `ask` ends the run with a `SignedPendingRequest` that any process holding the key can verify, and code outside a run can build the same record. The signers, the input hash and the pending record come from `@buildanagent/agent-safety` (E1, E3), so this todo wires them into the loop. B15b then resumes from it.

## Context

- [agent-SDK guide §7](../../guides/agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback): signed log states and the no-handler outcome
- [D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): the signer, its key ids and the signed payload
- [seams §3.4](../../plans/build-sdk.md#34-the-seams-p2-consumes): pause records and `createPendingRequest()`, which harness N40 uses for code-initiated calls
- [ADR 0043](../../decisions/0043-standalone-safety-core.md) and [E3](../done/E3-signed-approvals-third-party.md): the safety package defines the signer, the pending record and `Resolution`, with the shapes of build-sdk.md §3.3
- [P4 review R25 and need S1](../../plans/reviews/plan-review.md#4-needs-reconciliation-24-change-upstream-3-drop-1-is-already-covered): why B15 was split and what S1 asks for

## Scope

**In scope**

- Re-exports from `@buildanagent/agent-safety`: `SignedPendingRequest`, `Resolution`, `ApprovalSigner`, `ephemeralSigner()`, `hmacSigner({ keys, current })` and `canonicalInputHash()`
- `createPendingRequest(fields, signer)`, which signs the same D5 payload outside a run (agent need S1)
- The `awaiting_approval` stop reason with `pending` on the result and in `context` when a gate returns `ask`

**Out of scope** (and which todo covers it)

- `continueRun` with resolutions, `blockingApprovals()` and the clarification pause (B15b)
- Key storage and rotation policy (the harness's `KeyStore`, N13; ADR 0015)
- Defining the signers, the input hash or the pending record (E1, E3)

## Tasks

- [x] Import `ephemeralSigner()` (the default), `hmacSigner()`, `canonicalInputHash()`, `SignedPendingRequest` and `Resolution` from `@buildanagent/agent-safety`, and re-export them from the SDK unchanged.
- [x] Implement `createPendingRequest()` on the same payload code path the loop uses, so the two cannot drift.
- [x] Wire a gate's `ask` to end the run `awaiting_approval`, writing the signed request into `result.pending` and `context.pending`.

## Acceptance criteria

- [x] A gate returning `ask` ends the run `awaiting_approval` with one signed pending request
- [x] A request from `createPendingRequest()` and one written by the loop for the same fields verify with the same signer, and their signed payloads are byte-identical
- [x] Rotating from key `a` to key `b` still verifies a request signed with `a` when both are in the ring, and an unknown key id fails verification
- [x] A pause signed through the SDK and one signed directly by the package for the same fields produce byte-identical payloads (E3's matching test)
- [x] The SDK defines no signer, hash or pending-record type of its own: its exports for them are re-exports (a test compares identities)
- [x] The signed-request kinds stay as D5 defines them: the owner chose on 2026-11-19 to keep plan approvals on their own signature ([SG5](../../plans/close-sdk-gaps.md#sg5-a-plan-approval-keeps-its-own-signature-separate-from-d5s-signed-request-kinds-accepted)), and to revisit a `"plan"` kind when this todo starts
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/signer.test.ts` and `pending.test.ts`.

## Docs to update

`packages/sdk/README.md`: pause records and signers. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

- Pending owner confirmation (plan review 2 §6, decision 2): whether the safety package owns `SignedPendingRequest` and `Resolution`, which ADR 0043 does not list. If the owner declines, this todo defines both types and E3 keeps a structural copy.

The owner accepted D5 with an ephemeral default and an optional `signer` (ADR 0005); the harness always passes `hmacSigner()` (ADR 0015).

**Answered (owner, 2026-11-19):** the owner confirmed the safety package owns `SignedPendingRequest` and `Resolution` (plan review 2 §6, action 2), so this todo re-exports both.

**Answered (owner, 2026-11-19), the SG5 revisit:** keep the signed-request kinds as D5 defines them, `"approval"` and `"clarification"`, with no `"plan"` kind. Plan approvals stay on E4a's own signature ([SG5](../../plans/close-sdk-gaps.md#sg5-a-plan-approval-keeps-its-own-signature-separate-from-d5s-signed-request-kinds-accepted)).

**Resolved in the first code review:** a composed gate that replaced the input and a later gate that asked once paused the call over the model's original input, because `composeInterceptors()` dropped the earlier `allow`'s input. An approved call would then have run without the earlier gate's replacement. The composed `ask` now carries the replacement, an `ask` may carry an `input` of its own, and every pause signs the input the call would run with, which `context.pendingInputs` and the `approval_request` event hold.

## History

The SDK-gaps revision of 2026-11-18 (ADR 0043) moved the signer and the input hash into `@buildanagent/agent-safety`; plan review 2 (2026-11-19) folded it into the sections above, renamed the todo, and made the safety package the owner of `SignedPendingRequest` and `Resolution`. D5's contract and ADR 0005's rules do not change.

On 2026-11-19, when B15 started, the owner answered the SG5 revisit by keeping D5's kinds unchanged, with no `"plan"` kind.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

A `beforeToolCall` gate that returns `ask` now pauses its call. The hook runner signs a `SignedPendingRequest` with the run's `signer`, emits `approval_request`, and the run ends `awaiting_approval` after the step, with the requests in `result.pending` and `context.pending`. `createPendingRequest(fields, signer, options?)` signs through the same function, `signPause()` in `packages/sdk/src/pauses.ts`. The SDK vendors the safety package's `bytes.ts`, `signer.ts` and `pending.ts` beside B10's four copies, and the drift test covers all seven. The changeset is `.changeset/signed-pauses-in-the-loop.md`, a `minor` bump that opens with "Breaking Changes", because `RunResult` and `AgentEvent` each gain a member.

Decisions:

- The paused call doesn't run and gets no tool result, so the context ends with its call open for B15b to answer. The step's other calls run or are denied as usual, and every paused call gets its own request, in model order.
- A pause wins over a finished answer or an output tool in the same step, and over an abort that came while the step's other calls ran, as a clarification already did. `shouldStop` and the progress policy are not asked after a pause.
- `RunOptions.signer` defaults to `ephemeralSigner()`. Request ids come from `idGenerator`, so a fixed clock and ids make pauses deterministic. A request whose id repeats an earlier one in the run, or whose signing throws, blocks its call with an error result and emits `hook_error` with `hook: "signer"`. Its text names only the safety package's error code, or `signer_failed`, never the signer's own message, so no pause is ever written unsigned and no key can reach an event.
- `approval_request` follows the paused call's `tool_call_start`, and the call gets no `tool_call_end`. The OTel observer ends its tool span without an error and records nothing of the request.
- `createPendingRequest()` takes an optional third argument, the safety package's `SignPendingOptions`, so a caller can fix the id and time, and its fields add an unsigned `reason`. It signs only `kind: "approval"`.
- The SDK re-exports `SafetyError`, `isSafetyError()`, `HmacSignerOptions` and `SignPendingOptions` too, because the re-exported signers and `createPendingRequest()` throw or reject with `SafetyError`.
- Until B15b, `continueRun()` throws `invalid_run_options` for a context with pending requests, so a waiting call is never dropped. The gateway's replay pass would otherwise answer it with "No result was recorded".

Each criterion and the test that covers it:

- One signed request on `ask`: "a gate that asks ends the run awaiting_approval with one signed request, in the result and the context" (`pending.test.ts`), and the updated gate test in `gates.test.ts`.
- Loop and `createPendingRequest()` byte-identical: "the loop, createPendingRequest() and the safety package's signPending() sign byte-identical payloads" (`pending.test.ts`).
- Rotation and unknown key id: "after rotating from key a to key b, a request signed with a still verifies, and new ones use b" and "a request whose key id the ring lacks fails verification" (`signer.test.ts`).
- SDK against the package's own `signPending()`: the byte-identical test above, which signs with the package's own `hmacSigner()` over the same key, and "a pause signed with the safety package's test signer is the same record createPendingRequest() writes" (`pending.test.ts`).
- Re-exports by identity: "the SDK's signer, hash and error exports are the vendored safety files' own functions", "the SDK's pause types are the safety package's types, unchanged" and "no SDK source outside the vendored folder defines a signer, an input hash or a pending-record type" (`signer.test.ts`).
- D5's kinds: the owner's 2026-11-19 answer above; `SignedPendingRequest["kind"]` is the package's own union, which the type test compares.
- Security: "a run without a signer signs with the process's ephemeral signer", "no key's bytes reach the events, the result or the OTel spans of a paused run" (`signer.test.ts`), and "a pause that can't be signed blocks its call, and no report carries the signer's own message" (`pending.test.ts`).
- Offline checks: `pnpm check`, `pnpm typecheck` and `pnpm test` pass from the repo root, and the pack test (`scripts/ci/packages-pack.test.mjs`) passes.
