# B15: Signers, canonical hashing, the signed pending record and `createPendingRequest`

| Field | Value |
| --- | --- |
| ID | `B15` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B13](B13-interceptors-observers.md), [E3](E3-signed-approvals-third-party.md) |
| Size | M |

## Goal

Make every pause a signed record: a gate that returns `ask` ends the run with a `SignedPendingRequest` that any process holding the key can verify, and code outside a run can build the same record. B15b then resumes from it.

## Context

- [agent-SDK guide §7](../../guides/agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback): signed log states and the no-handler outcome
- [D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): the signer, its key ids and the signed payload
- [seams §3.4](../../plans/build-sdk.md#34-the-seams-p2-consumes): pause records and `createPendingRequest()`, which harness N40 uses for code-initiated calls
- [P4 review R25 and need S1](../../plans/reviews/plan-review.md#4-needs-reconciliation-24-change-upstream-3-drop-1-is-already-covered): why B15 was split and what S1 asks for

## Scope

**In scope**

- `SignedPendingRequest`, `Resolution`, `ApprovalSigner`, `ephemeralSigner()`, `hmacSigner({ keys, current })` with key ids, `canonicalInputHash()`
- `createPendingRequest(fields, signer)`, which signs the same D5 payload outside a run (agent need S1)
- The `awaiting_approval` stop reason with `pending` on the result and in `context` when a gate returns `ask`

**Out of scope** (and which todo covers it)

- `continueRun` with resolutions, `blockingApprovals()` and the clarification pause (B15b)
- Key storage and rotation policy (the harness's `KeyStore`, N13; ADR 0015)

## Tasks

- [ ] Implement canonical JSON hashing with Web Crypto SHA-256, and HMAC-SHA-256 signing over the D5 payload: request id, kind, call id, tool, input hash and optional `policyVersion`.
- [ ] Implement `ephemeralSigner()` (one random key per process, the default) and `hmacSigner()` over a key ring, with `keyId` on every signature.
- [ ] Implement `createPendingRequest()` on the same payload code path the loop uses, so the two cannot drift.
- [ ] Wire a gate's `ask` to end the run `awaiting_approval`, writing the signed request into `result.pending` and `context.pending`.

## Acceptance criteria

- [ ] A gate returning `ask` ends the run `awaiting_approval` with one signed pending request
- [ ] A request from `createPendingRequest()` and one written by the loop for the same fields verify with the same signer, and their signed payloads are byte-identical
- [ ] Rotating from key `a` to key `b` still verifies a request signed with `a` when both are in the ring, and an unknown key id fails verification
- [ ] `canonicalInputHash()` gives the same hash for objects whose keys differ only in order
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/signer.test.ts` and `pending.test.ts`.

## Docs to update

`packages/sdk/README.md`: pause records and signers. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

None open. The owner accepted D5 with an ephemeral default and an optional `signer` (ADR 0005); the harness always passes `hmacSigner()` (ADR 0015).

## Revision (2026-11-18, SDK gaps)

[ADR 0043](../../decisions/0043-standalone-safety-core.md), accepted by the owner on 2026-11-18, puts the signer and the canonical input hash in `@agent-speak/agent-safety`, which [E3](E3-signed-approvals-third-party.md) builds with the shapes of [build-sdk.md §3.3](../../plans/build-sdk.md#33-sdk-api). D5's contract and ADR 0005's rules do not change.

- [ ] `hmacSigner()`, `ephemeralSigner()` and the input hash are imported from the safety package, not defined here; the SDK re-exports them.
- [ ] A pause signed through the SDK and one signed directly by the package for the same fields produce byte-identical payloads (E3's matching test).
- [ ] The signed-request kinds stay as D5 defines them: the owner chose on 2026-11-19 to keep plan approvals on their own signature ([SG5](../../plans/close-sdk-gaps.md#sg5-a-plan-approval-keeps-its-own-signature-separate-from-d5s-signed-request-kinds-accepted)), and to revisit a `"plan"` kind when this todo starts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
