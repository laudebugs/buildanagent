---
title: Signed approvals
description: How a signed pause rejects an edited or forged request, and what the signature leaves unprotected, such as the person's answer, replay and expiry.
---

You will pause a refund until a person approves it, and check before it runs that nobody edited or forged the paused request. You need this when pauses are stored where others can change them, such as a browser or a stored chat.

The signature covers the request, not the person's answer. An edited or forged request fails the check. The answer, allow or deny, is never signed: the host passes it to `verifyResolution()` as plain input, so anyone who can write the answer can say allow. The check also keeps no state, so the same pause and answer pass again if the host does not stop them.

An approval is a person's answer, allow or deny, to a tool call that waits for them. A pending request is the record the host stores while the call waits. The host signs the request with a secret key, and when the answer comes back it sees whether the call changed.

## Sign the pause

`signPending()` hashes the call's input, signs the request and returns it for you to store. The signature covers the request's id and kind, the call id, the tool's name, the input's hash and an optional policy version. The input itself is never stored.

The question, the reason and the creation time are shown to people and are not signed, so never let them decide anything. This function signs the pause for a refund:

```ts file="packages/agent-safety/examples/approval-check.ts" region="pause"
```

The signer is an `ApprovalSigner`, an object that signs and verifies with HMAC-SHA-256, a keyed hash. `hmacSigner()` builds one from a key ring: key ids mapped to keys of at least 32 bytes, and the id of the key that signs. Every signature names its key, so a host can rotate keys without stranding a stored pause.

## Check the answer before the call runs

`verifyResolution()` checks the person's answer against the stored request and the call the host is about to run. It never throws for bad input. It returns `ok: true`, or `ok: false` with the first cause that failed:

```ts file="packages/agent-safety/examples/approval-check.ts" region="resume"
```

A host that runs calls for more than one caller can bind a request to the caller's data, such as the signed-in customer, by passing `app` to `signPending()`. The signature then covers a keyed hash of that data, so a resume as another caller fails. The causes are these, in the order the check finds them:

- `malformed`: the stored request is not a well-formed pending request.
- `unknown_request`: the answer names another request.
- `signature_invalid`: the signature is wrong, or its key id is not in the signer's ring.
- `app_mismatch`: the request is bound to the caller's data, and the host passed none or other data.
- `call_mismatch`: the call id or tool differs from the call about to run.
- `input_changed`: the call's input differs from the input that was signed.
- `resolution_mismatch`: the answer does not fit the request's kind.

A passing check says the stored request is authentic and that the call matches it. It does not say that the person gave the answer, that the pause is unused, or that today's policy still allows the call. Check the policy separately, right before the call runs.

## Stop replay and expiry yourself

`verifyResolution()` is stateless. The same pause and answer verify every time, and `createdAt` is not signed, so the check cannot tell a stale pause from a fresh one. Store each pause where you can find it, take it out in one atomic step when its answer arrives, and drop any pause that waits too long. A pause that was taken once cannot be used again. Without this, a replayed answer runs the call a second time.

## Use a key ring that outlives the process

The ring decides which process can check a signature. `ephemeralSigner()` makes a random key that lives only in the current process, so no other process can verify what it signs. On Cloudflare, AWS Lambda or Vercel, the process that paused may be gone before the person answers, and an ephemeral pause then fails closed.

On those hosts, keep a key ring in the platform's secret store and read it with `parseKeyRing()`, which takes JSON text such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}` with each key as unpadded base64url. Pass the result to `hmacSigner()`. To rotate, add a new key and make it current, and remove the old one once no unanswered pause names it.

For tests, `testSigner()` from `@buildanagent/agent-safety/testing` signs with a fixed, published key, so anyone can forge its signatures. Never use it outside tests.

## Let the AI SDK pause for you

If you use the AI SDK, `signedToolApproval()` from `@buildanagent/agent-safety/ai` does this work for its call-level `toolApproval` setting. It signs a pending request when your policy asks for a person and keeps it in a store under the tool call's id. When the call comes back approved, it takes the request out of the store, so a replayed approval fails, and runs the call only when the checks above pass and your `recheck` function allows it. If any check fails, the adapter denies the call and its `execute` never runs.

`memoryPendingStore()` drops each request 24 hours after it was stored, and a durable store should do the same.

The adapter, like the manual check, does not sign the person's answer. It counts any approval response in the history that approves a known request as the person's yes. Set the AI SDK's own `experimental_toolApprovalSecret` as well. That setting adds a second check, signed with one secret, and it throws `InvalidToolApprovalSignatureError` for a bad signature instead of denying the call.

The [package README](https://github.com/laudebugs/buildanagent/blob/main/packages/agent-safety/README.md) covers the adapter, its stores and the Cloudflare differences.

Next, see how the [cost cap](/agent-safety/cost-cap/) refuses a model call before it can pass your budget.
