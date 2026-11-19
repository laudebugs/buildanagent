# E3: Signed, fail-closed approvals on `agents` 0.33.0 and `ai` 7.0.162, with policy re-checked on resume

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E3` |
| Status | `done` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E1](../done/E1-safety-core-outcomes.md) |
| Size | M |

## Goal

Make every approval on the two verified third-party SDKs signed, fail closed on resume, and re-checked against current policy before the approved call runs (gap 3). Our own SDK and harness already plan this in B15, B15b and N13; this todo brings the same rules to agents built on Cloudflare `agents` and the AI SDK, so the safety package can ship first.

## Context

- [build-sdk.md, D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): the signer contract this todo implements, and the fields it signs.
- [ADR 0043](../../decisions/0043-standalone-safety-core.md) (accepted): why the signer lives in this package.
- [ADR 0035](../../decisions/0035-read-only-key-store.md): a read-only `KeyStore` backs the key ring on serverless hosts.
- [N13](../ready/N13-signed-approvals.md): the harness's acceptance criteria, which this todo mirrors for the third-party SDKs.
- [Cloudflare reference §9](../../reference/cloudflare-agents/guide.md#9-tool-approval-reuses-the-ai-sdks-needsapproval-and-the-client-answers-over-the-chat-protocol) and [Vercel AI SDK reference §7](../../reference/vercel-ai-sdk/guide.md#7-approval-is-a-call-level-policy-not-a-flag-on-the-tool): each SDK's approval gate, and Vercel's `experimental_toolApprovalSecret`, without which a client can forge approvals.

## Scope

**In scope**

- `ApprovalSigner`, `hmacSigner({ keys, current })`, `ephemeralSigner()` and a fixed-key test signer, in the root export
- The `SignedPendingRequest` and `Resolution` types, in the root export; this package owns them, the SDK re-exports them, and B15 imports them instead of defining them
- `signPending()` and `verifyResolution()` over D5's fields: request id, kind, call id, tool name, input hash and optional `policyVersion`
- A `PendingStore` interface with an in-memory implementation, keyed by call id
- One adapter, `signedToolApproval`, over the AI SDK's call-level `toolApproval`, in the `./ai` subpath, used directly with `ai` and inside a Cloudflare `AIChatAgent`'s `onChatMessage`
- A `recheck` callback that runs current policy at resume time and can turn an approval into a denial

**Out of scope** (and which todo covers it)

- Plan-level approvals (E4a)
- Quorum and roles (N14 for the harness; the platform decides later)
- `canonicalInputHash()` (E1; this todo imports it)
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
  inputHash: string; policyVersion?: string; question?: string; reason?: string;
  keyId: string; signature: string; createdAt: string;
}
type Resolution =
  | { requestId: string; decision: "allow" | "deny"; reason?: string; by?: string }
  | { requestId: string; answer: string; by?: string };
declare function ephemeralSigner(): ApprovalSigner;
declare function hmacSigner(options: { keys: Record<string, Uint8Array>; current: string }): ApprovalSigner;
type Recheck = (p: SignedPendingRequest, input: unknown) => Promise<"allow" | { deny: string }>;

declare function signedToolApproval<TOOLS>(opts: {
  signer: ApprovalSigner; store: PendingStore; policy: ToolApprovalConfiguration<TOOLS>; recheck: Recheck;
}): ToolApprovalConfiguration<TOOLS>;   // passed as `toolApproval` to generateText, streamText or the agent's streamText
```

Both SDKs give the adapter one hook. `ai` 7.0.162 re-runs the call's `toolApproval` function on every approved response before `execute`, inside `validateApprovedToolApprovals` in `generateText` and `streamText`, and turns a `denied` status into a denial result. Cloudflare `AIChatAgent` stores the client's `cf_agent_tool_approval` answer as an `approval-responded` part, and the agent's own `streamText` call then runs the same check. The adapter therefore signs a `SignedPendingRequest` and stores it by `callId` when its `toolApproval` returns `user-approval`. When `toolApproval` runs again for a call that carries an approval response, the adapter verifies the stored signature with the key ring, recomputes the input hash from the call the SDK is about to run, and calls `recheck`. Any failure returns `denied`, so `execute` never runs, and a `recheck` denial reaches the model as a `not_applied` outcome from E1. A `user-approval` status at that point counts as approved in `ai`, so the adapter must return `denied` explicitly. The SDK's own `experimental_toolApprovalSecret` stays on as a second check; it signs with one secret and no key id, and a bad signature throws `InvalidToolApprovalSignatureError` instead of re-issuing the request.

## Tasks

- [x] Write `hmacSigner()`, `ephemeralSigner()`, the fixed-key test signer and the pending record over E1's `canonicalInputHash()`, with key rotation. B18's `testSigner()` re-exports the fixed-key test signer.
- [x] Write the `ai` adapter over `toolApproval`, and test that it runs again on resume before `execute` (`validateApprovedToolApprovals`, `ai` 7.0.162).
- [x] Use the same adapter in a Cloudflare `AIChatAgent` test agent answered through the `cf_agent_tool_approval` frame, tested in workerd. A tool that keeps the deprecated `needsApproval` gets the same wrapping.
- [x] Write a cross-process test: pause in one process, resolve in another with only the key ring shared.

## Acceptance criteria

- [x] On both SDKs, an approval response with a tampered signature, an unknown key id, a changed input or an unknown request id runs nothing (an `execute` spy records zero calls), and the model or client sees a denial it can answer with a fresh request.
- [x] On both SDKs, a policy change between pause and resume makes `recheck` deny, and the model receives a `not_applied` outcome; the tool's `execute` is never called (a spy records zero calls).
- [x] A pause signed in one process verifies in another that loads the same key ring and has no other shared state.
- [x] Rotating from key `a` to key `b` still verifies a pause signed with `a` while `a` is in the ring.
- [x] `ephemeralSigner()` signs and verifies within one process, and a second process cannot verify its signatures.
- [x] The `SignedPendingRequest` and `Resolution` types match build-sdk.md §3.3 field for field, checked by a type test.
- [x] Payloads signed by this package and by B15's tests for the same fields are byte-identical (checked once B15 exists; until then, against a fixture of D5's field order).
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/signing.test.ts`, `test/ai-approval.test.ts` (mock model) and `test/cloudflare-approval.test.ts` (workerd).

## Docs to update

The package README (how to pass a persistent key ring on serverless hosts, with a pointer to ADR 0035).

## Risks and open questions

- The resume-time re-run of `toolApproval` is read from the shipped `ai` 7.0.162 source, not from a documented guarantee, so a test pins it; if a later version drops it, the adapter wraps `execute` instead.
- Settled by the owner on 2026-11-19: the safety package owns `SignedPendingRequest` and `Resolution`, and the SDK re-exports them. ADR 0043 moves the signer and the input hash but did not list the pending record; plan review 2 (2026-11-19) gave both types to this package, so one definition crosses `Context` and the protocol union (N26), and the owner confirmed that reading the same day.

History: plan review 2 (2026-11-19) moved `canonicalInputHash()` to E1, added `ephemeralSigner()` and the `Resolution` type, restored `question?` and `reason?`, and put `signedToolApproval` in `./ai`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The root entry of `@buildanagent/agent-safety` now exports the `ApprovalSigner` interface, `hmacSigner()`, `ephemeralSigner()`, `signPending()`, `verifyResolution()`, `pendingPayload()`, the `SignedPendingRequest`, `Resolution` and `Recheck` types, `PendingStore` with `memoryPendingStore()`, and `KeyStore` with `parseKeyRing()` and `signerFromKeyStore()`. `./ai` adds `signedToolApproval()` and `settleDeniedApprovals()`, and `./testing` holds `testSigner()` (key id `test-fixed-key`). The third-party claims are logged in [the E3 fact-check](../../plans/reviews/fact-check-signed-approvals.md). The writing review runs after the code-review rounds, so its box stays open until then.

Each criterion and the test that covers it:

- Tampered signature, unknown key id, changed input and unknown request run nothing, and the model reads a `not_applied` denial: `test/ai-approval.test.ts` for `generateText` and `streamText`, and `test/cloudflare-approval.test.ts` in workerd, each with an `execute` spy. Both suites also show the model answering a denial with a fresh request that runs once approved.
- A policy change makes `recheck` deny with a `not_applied` outcome: the same two files.
- Cross-process: `test/cross-process.test.ts` pauses in one Node process and resumes in another that shares only the key ring, passed as a secret string; an `ephemeralSigner()` pause fails closed there.
- Rotation: `test/signing.test.ts` and the last test in `test/ai-approval.test.ts`.
- Type match: `test/pending-types.test.ts` compares each type with §3.3's text.
- Byte-identical payloads: `test/fixtures/signed-pending.json` pins the payload and signature, and `test/signing.test.ts` checks the signature against `node:crypto`'s HMAC. B15 imports the same functions, so its payloads match by construction.

Judgement calls:

- **The payload** is the JSON array `["buildanagent.pending.v1", id, kind, callId, tool, inputHash, policyVersion ?? null]` in UTF-8. The tag is not a seventh field; it keeps a pending request's signature from verifying as another record's, such as E4a's plan record, under a shared key. `question`, `reason` and `createdAt` are unsigned, as D5 lists.
- **Signatures** are HMAC-SHA-256 as unpadded base64url. `verify()` refuses non-canonical base64url, recomputes the MAC and compares it in constant time. Keys must be at least 32 bytes, are copied, and stay in non-extractable `CryptoKey`s; errors name key ids only.
- **`ephemeralSigner()` is one key per process**, not per call, so the SDK's default can resume a pause in the process that made it.
- **The fixed-key test signer is in a `./testing` subpath**, with a published key and a warning. The scope put it in the root export, but the first review moved it so that code importing the root can't reach a key anyone can forge; D5 already names a `testing` export for it.
- **A pending request is used once.** `PendingStore` has `put()` and `take()`, so a replayed approval finds nothing, and a forged attempt also burns the real request, which fails closed. `take()` must be atomic, and a store should expire requests that are never taken: a denied call never comes back to the adapter. `memoryPendingStore()` drops them after 24 hours.
- **Resume is detected from the history**: the call's approval request appears in the messages and the last message approves it. The adapter then re-runs the policy, denies on `denied`, and calls `recheck`. Every failure, including a thrown error, returns `denied`.
- **`needsApproval` still applies.** A generic `toolApproval` function makes `ai` skip `needsApproval`, so the adapter applies it when the policy has no answer.
- **A Cloudflare finding.** `agents` 0.33.0 drops the `tool-output-denied` chunk for a part already `approval-responded`, so the client never sees the denial and the next model step failed with `AI_MissingToolResultsError`. `settleDeniedApprovals()` in `./ai` marks those parts denied before the next turn. Reporting it upstream is a follow-up.
- **`src/` reads the bare `crypto` global**, the same object as `globalThis.crypto`, because the Workers types declare it as a `const` and the worker type-checks `src/` against them. The SDK's vendored `errors.ts` and `hash.ts` follow, with an empty changeset; the SDK vendors nothing new, because B15 needs the signer files only once the safety package publishes or B15 vendors them itself.
- **The workerd test** bundles a Worker with esbuild and runs it through Miniflare, reusing `verify/cloudflare-agents`' pins; `test/workerd/tsconfig.json` type-checks it against the Workers types. E7 can grow this into the whole suite.
- **The README** explains the persistent key ring for serverless hosts in plain words, without the ADR number that the todo's "Docs to update" names, because the docs guideline keeps decision ids out of reader text.
