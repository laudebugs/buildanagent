---
title: Signed approvals
description: How a signed pending request rejects an edit or a forgery, and what the signature leaves unprotected, such as the person's answer, replay and expiry.
---

You will pause a refund until a person approves it, and check before it runs that nobody edited or forged the paused call. You need this when pending requests are stored where others can change them, such as a browser or a stored chat.

A pending request is the record the host stores while a tool call waits for a person. The person's answer is allow or deny. The code calls that answer a resolution, as in `verifyResolution()`. The host signs the pending request with a secret key, and when the answer comes back it sees whether the call changed.

The signature covers the pending request, not the answer. An edited or forged request fails the check. The answer is never signed: the host passes it to `verifyResolution()` as plain input, so anyone who can write the answer can say allow.

## Sign the pending request

`signPending()` hashes the call's input, signs the pending request and returns it for you to store. The signature covers the request's id and kind, the call id, the tool's name, the input's hash and an optional policy version. The input itself is never stored.

The question, the reason and the creation time are shown to people and are not signed, so never let them decide anything. This function signs the pending request for a refund:

```ts file="packages/agent-safety/examples/approval-check.ts" region="pause"
```

The signer is an `ApprovalSigner`, an object that signs and verifies with HMAC-SHA-256, a keyed hash. `hmacSigner()` builds one from a key ring: key ids mapped to keys of at least 32 bytes, and the id of the key that signs. Every signature names its key, so a host can rotate keys without stranding a stored pending request.

## Check the answer before the call runs

`verifyResolution()` checks the person's answer against the stored request and the call the host is about to run. It never throws for bad input. It returns `ok: true`, or `ok: false` with the first cause that failed:

```ts file="packages/agent-safety/examples/approval-check.ts" region="resume"
```

A host that runs calls for more than one caller can bind a request to the caller's data, such as the signed-in customer, by passing `app` to `signPending()` and `verifyResolution()`. The signature then covers a keyed hash of that data, so a resume as another caller fails. This binding works in the manual flow only: `signedToolApproval()` passes no `app`. The causes are these, in the order the check finds them:

- `malformed`: the stored request is not a well-formed pending request.
- `unknown_request`: the answer names another request.
- `signature_invalid`: the signature is wrong, or its key id is not in the signer's ring.
- `app_mismatch`: the request is bound to the caller's data, and the host passed none or other data.
- `call_mismatch`: the call id or tool differs from the call about to run.
- `input_changed`: the call's input differs from the input that was signed.
- `resolution_mismatch`: the answer does not fit the request's kind.

A passing check says the stored request is authentic and that the call matches it. It does not say that the person gave the answer, that the pending request is unused, or that today's policy still allows the call. Check the policy separately, right before the call runs.

## Stop replay and expiry yourself

`verifyResolution()` is stateless. The same pending request and answer verify every time, and `createdAt` is not signed, so the check cannot tell a stale request from a fresh one. Store each pending request where you can find it, take it out in one atomic step when its answer arrives, and drop any that waits too long. A request that was taken once cannot be used again. Without this, a replayed answer runs the call a second time.

## Use a key ring that outlives the process

The ring decides which process can check a signature. `ephemeralSigner()` makes a random key that lives only in the current process, so no other process can verify what it signs. On Cloudflare, AWS Lambda or Vercel, the process that paused may be gone before the person answers, and an ephemeral pending request then fails closed.

On those hosts, keep a key ring in the platform's secret store and read it with `parseKeyRing()`, which takes JSON text such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}` with each key as unpadded base64url. Pass the result to `hmacSigner()`. To rotate, add a new key and make it current, and remove the old one once no unanswered pending request names it.

For tests, `testSigner()` from `@buildanagent/agent-safety/testing` signs with a fixed, published key, so anyone can forge its signatures. Never use it outside tests.

## Let the AI SDK pause for you

If you use the AI SDK, `signedToolApproval()` from `@buildanagent/agent-safety/ai` does this work for its call-level `toolApproval` setting. The adapter signs a pending request when your policy asks for a person and keeps it in a store under the tool call's id. When the call comes back approved, the adapter takes the request out of the store, so a replayed approval fails. It runs the call only when the checks above pass and your `recheck` function allows it. If any check fails, it denies the call and the tool's `execute` never runs.

By default, `memoryPendingStore()` drops each request 24 hours after it was stored. Set `maxAgeMs` to change that, and make a durable store expire requests too.

Like the manual check, the adapter does not sign the person's answer. It treats a call as approved when the last message of the history is a tool message that holds an approved response, and that response's approval id matches a request in an earlier assistant message. Those entries are unsigned history, not the stored signed request, so a forger needs only to write that message. The adapter then checks the stored request, so the forger still cannot change the call.

Set the AI SDK's own `experimental_toolApprovalSecret` as well. That setting adds a second check, signed with one secret, and it throws `InvalidToolApprovalSignatureError` for a bad signature instead of denying the call.

The adapter has three more limits:

- It cannot bind a caller, because it passes no `app`.
- The store is keyed by the call id alone, so two conversations that share a store and reuse a call id replace each other's requests. Give each conversation its own store.
- It takes the request on every approved resume, even when the check then fails, so a forged approval uses up the real request and the model has to ask again.

The [package README](https://github.com/laudebugs/buildanagent/blob/main/packages/agent-safety/README.md) covers the adapter, its stores and the Cloudflare differences.

Next, see how the [cost cap](/agent-safety/cost-cap/) refuses a model call before it can pass your budget.
