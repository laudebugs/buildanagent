---
title: Signed approvals
description: How a signed pause makes an approval fail closed, so a forged, edited or stale approval runs nothing.
---

You will pause a refund until a person approves it, and check the approval before the refund runs. You need this when approvals travel through a browser or a stored chat, where anyone who can edit the history could approve a call they changed.

An approval is a person's answer, allow or deny, to a tool call that waits for them. A pending request is the record the host stores while the call waits. Signing the request with a secret key lets the host see, when the answer comes back, that nothing about the call changed.

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

The check passes only when the stored request is authentic and unchanged. It does not say that today's policy still allows the call. Check that separately, right before the call runs.

## Use a key ring that outlives the process

The ring decides which process can check a signature. `ephemeralSigner()` makes a random key that lives only in the current process, so no other process can verify what it signs. On Cloudflare, AWS Lambda or Vercel, the process that paused may be gone before the person answers, and an ephemeral pause then fails closed.

On those hosts, keep a key ring in the platform's secret store and read it with `parseKeyRing()`, which takes JSON text such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}` with each key as unpadded base64url. Pass the result to `hmacSigner()`. To rotate, add a new key and make it current, and remove the old one once no unanswered pause names it.

For tests, `testSigner()` from `@buildanagent/agent-safety/testing` signs with a fixed, published key, so anyone can forge its signatures. Never use it outside tests.

## Let the AI SDK pause for you

If you use the AI SDK, `signedToolApproval()` from `@buildanagent/agent-safety/ai` does this work for its call-level `toolApproval` setting. It signs a pending request when your policy asks for a person, keeps it in a store under the tool call's id, and runs the approved call only when the checks above pass and your `recheck` function allows it. If any check fails, the adapter denies the call and its `execute` never runs. The package README covers the adapter, its stores and the Cloudflare differences.

Next, see how the [cost cap](/agent-safety/cost-cap/) refuses a model call before it can pass your budget.
