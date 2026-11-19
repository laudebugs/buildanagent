# E3: Signed, fail-closed approvals on `agents` 0.33.0 and `ai` 7.0.162, with policy re-checked on resume

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner approved Round E's reviewed todos but said "Approve plan, don't start yet" ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-and-only-once-the-owner-says-go-accepted-on-hold)).

| Field | Value |
| --- | --- |
| ID | `E3` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps) |
| Depends on | [E1](E1-safety-core-outcomes.md) |
| Size | M |

## Goal

Make every approval on the two verified third-party SDKs signed, fail closed on resume, and re-checked against current policy before the approved call runs (gap 3). Our own SDK and harness already plan this in B15, B15b and N13; this todo brings the same rules to agents built on Cloudflare `agents` and the AI SDK, so the safety package can ship first.

## Context

- [build-sdk.md, D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): the signer contract this todo implements, and the fields it signs.
- [ADR 0043](../../decisions/0043-standalone-safety-core.md) (proposed): why the signer lives in this package.
- [ADR 0035](../../decisions/0035-read-only-key-store.md): a read-only `KeyStore` backs the key ring on serverless hosts.
- [N13](N13-signed-approvals.md): the harness's acceptance criteria, which this todo mirrors for the third-party SDKs.
- [Cloudflare reference §9](../../reference/cloudflare-agents/guide.md#9-tool-approval-reuses-the-ai-sdks-needsapproval-and-the-client-answers-over-the-chat-protocol) and [Vercel AI SDK reference §7](../../reference/vercel-ai-sdk/guide.md#7-approval-is-a-call-level-policy-not-a-flag-on-the-tool): each SDK's approval gate, and Vercel's `experimental_toolApprovalSecret`, without which a client can forge approvals.

## Scope

**In scope**

- `ApprovalSigner`, `hmacSigner({ keys, current })`, `canonicalInputHash()` and a fixed-key test signer
- `signPending()` and `verifyResolution()` over D5's fields: request id, kind, call id, tool name, input hash and optional `policyVersion`
- A `PendingStore` interface with an in-memory implementation, keyed by call id
- One adapter over the AI SDK's call-level `toolApproval`, used directly with `ai` and inside a Cloudflare `AIChatAgent`'s `onChatMessage`
- A `recheck` callback that runs current policy at resume time and can turn an approval into a denial

**Out of scope** (and which todo covers it)

- Plan-level approvals (E4a)
- Quorum and roles (N14 for the harness; the platform decides later)
- Our own SDK's signer (B15, which imports this one under ADR 0043, accepted 2026-11-18)

## Design notes

```ts
// The shapes of build-sdk.md §3.3, unchanged, so B15 can import them (ADR 0043).
interface ApprovalSigner {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<string>;
  verify(keyId: string, payload: Uint8Array, signature: string): Promise<boolean>;
}
interface SignedPendingRequest {
  id: string; kind: "approval" | "clarification"; callId: string; tool: string;
  inputHash: string; policyVersion?: string; keyId: string; signature: string; createdAt: string;
}
type Recheck = (p: SignedPendingRequest, input: unknown) => Promise<"allow" | { deny: string }>;

declare function signedToolApproval<TOOLS>(opts: {
  signer: ApprovalSigner; store: PendingStore; policy: ToolApprovalConfiguration<TOOLS>; recheck: Recheck;
}): ToolApprovalConfiguration<TOOLS>;   // passed as `toolApproval` to generateText, streamText or the agent's streamText
```

Both SDKs give the adapter one hook. `ai` 7.0.162 re-runs the call's `toolApproval` function on every approved response before `execute`, inside `validateApprovedToolApprovals` in `generateText` and `streamText`, and turns a `denied` status into a denial result. Cloudflare `AIChatAgent` stores the client's `cf_agent_tool_approval` answer as an `approval-responded` part, and the agent's own `streamText` call then runs the same check. The adapter therefore signs a `SignedPendingRequest` and stores it by `callId` when its `toolApproval` returns `user-approval`. When `toolApproval` runs again for a call that carries an approval response, the adapter verifies the stored signature with the key ring, recomputes the input hash from the call the SDK is about to run, and calls `recheck`. Any failure returns `denied`, so `execute` never runs, and a `recheck` denial reaches the model as a `not_applied` outcome from E1. A `user-approval` status at that point counts as approved in `ai`, so the adapter must return `denied` explicitly. The SDK's own `experimental_toolApprovalSecret` stays on as a second check; it signs with one secret and no key id, and a bad signature throws `InvalidToolApprovalSignatureError` instead of re-issuing the request.

## Tasks

- [ ] Write the signer, the canonical hash and the pending record, with key rotation.
- [ ] Write the `ai` adapter over `toolApproval`, and test that it runs again on resume before `execute` (`validateApprovedToolApprovals`, `ai` 7.0.162).
- [ ] Use the same adapter in a Cloudflare `AIChatAgent` test agent answered through the `cf_agent_tool_approval` frame, tested in workerd. A tool that keeps the deprecated `needsApproval` gets the same wrapping.
- [ ] Write a cross-process test: pause in one process, resolve in another with only the key ring shared.

## Acceptance criteria

- [ ] On both SDKs, an approval response with a tampered signature, an unknown key id, a changed input or an unknown request id runs nothing (an `execute` spy records zero calls), and the model or client sees a denial it can answer with a fresh request.
- [ ] On both SDKs, a policy change between pause and resume makes `recheck` deny, and the model receives a `not_applied` outcome; the tool's `execute` is never called (a spy records zero calls).
- [ ] A pause signed in one process verifies in another that loads the same key ring and has no other shared state.
- [ ] Rotating from key `a` to key `b` still verifies a pause signed with `a` while `a` is in the ring.
- [ ] Payloads signed by this package and by B15's tests for the same fields are byte-identical (checked once B15 exists; until then, against a fixture of D5's field order).
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/signing.test.ts`, `test/ai-approval.test.ts` (mock model) and `test/cloudflare-approval.test.ts` (workerd).

## Docs to update

The package README (how to pass a persistent key ring on serverless hosts, with a pointer to ADR 0035).

## Risks and open questions

- The resume-time re-run of `toolApproval` is read from the shipped `ai` 7.0.162 source, not from a documented guarantee, so a test pins it; if a later version drops it, the adapter wraps `execute` instead.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
