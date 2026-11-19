# @buildanagent/agent-safety

When a tool changes the world, such as sending an email or issuing a refund, your agent must know exactly what happened, and a person must approve exactly what runs. This package gives every write one of five typed outcomes, hashes tool inputs the same way on every runtime, and signs approvals so a forged or stale one runs nothing.

As of November 2026 the package is not on npm yet. It holds the write outcomes, `renderOutcome()`, `canonicalInputHash()`, the approval signers and adapters for the Vercel AI SDK, which also serve Cloudflare's `AIChatAgent`. Effect keys and plan approvals come next.

## A failed write reports one of five outcomes

A bare error tells the model too little. "The email may have gone out" and "nothing happened" both look like failure, yet they call for opposite next steps. A write outcome names which one happened, and its kind decides whether a retry is safe:

| Kind | What happened | Default retry | The model must not |
| --- | --- | --- | --- |
| `applied` | The write took effect | `never` | Run it again for the same request |
| `not_applied` | The write was rejected before any effect | `same_key` | Say that it happened |
| `compensated` | The write took effect and was then undone | `new_operation_only` | Say it took effect, or hide what could not be undone |
| `partial` | Some effects hold, and the rest could not be undone | `never` | Present it as a success |
| `unknown` | Nobody knows whether it took effect, as after a timeout | `reconcile_first` | Retry it as a new request |

The four retry rules mean this:

- **`same_key`:** retry with the same effect key, so the write takes effect at most once.
- **`new_operation_only`:** start a new operation, and only if the user still wants it.
- **`reconcile_first`:** check what happened before any retry.
- **`never`:** don't retry; tell the user or hand the task to a person.

A tool may choose a retry rule other than the default, but only one its kind allows. An `applied` outcome allows only `never`, and an `unknown` outcome never allows `new_operation_only`, because the first attempt may already have taken effect. TypeScript rejects a rule the kind doesn't allow, and so does `writeOutcome()` at runtime.

## Build an outcome with `writeOutcome()`

`writeOutcome()` fills in the default retry rule and empty effect lists, checks every field and returns a frozen outcome. This refund tool reports that the payment provider declined the refund:

```ts
const outcome = writeOutcome({
  kind: "not_applied", operation: "refund_create", reason: "CARD_DECLINED",
  next: "Ask the requester for another payment method",
});
```

Every outcome needs `operation` and `next`, which tells the model what to do now. Optional fields add detail: `applied`, `reverted` and `notReversible` list effects, `currentState` gives one line the model can trust, and `avoid` adds what the model must not do. `writeOutcome()` throws a `SafetyError` with the code `invalid_outcome` when a field breaks one of these rules:

- A `reason` is upper snake case of at most 63 characters, such as `CARD_DECLINED`.
- No optional text field and no listed effect is blank.
- The effects agree with the kind: a `not_applied` outcome lists none, an `applied` one lists nothing `reverted`, and a `compensated` one lists nothing `applied`.
- A `partial` or `unknown` outcome uses `same_key` only with an `effectKey`, because without one a retry could take effect twice.

## The model reads a sentence and a payload

`renderOutcome()` turns an outcome into what the model reads. It checks the outcome as `writeOutcome()` does, so an outcome built by hand or parsed from JSON follows the same rules. For the refund above, it returns this text:

> The refund_create call did not take effect, and nothing changed. Next: Ask the requester for another payment method. Retrying this same call is safe, because this attempt changed nothing. Do not say that it happened.

Beside the text, it returns the outcome's fields as a JSON `payload`, and `isError`, which is true for every kind except `applied`. Send all three to the model. Some SDKs show the model only the text or only the structured part, and some adapters drop the provider's error flag, so the outcome must survive in each channel alone.

## Use an outcome as an AI SDK tool result

The `./ai` subpath hands outcomes to the Vercel AI SDK (`ai` 7.0.162). Return the outcome from your tool's `execute`, and convert it in `toModelOutput`:

```ts
import { toAiToolResult } from "@buildanagent/agent-safety/ai";

const refund = tool({ inputSchema, execute: issueRefund, toModelOutput: ({ output }) => toAiToolResult(output) });
```

The model then receives one tool result whose value holds the sentence as `message` beside the payload. Every kind except `applied` arrives as an `error-json` result, which sets the provider's error flag; `applied` arrives as `json`.

## Hash a tool input with `canonicalInputHash()`

An approval signs a hash of the tool's input, and an effect record stores the same hash. `canonicalInputHash()` serializes the input as canonical JSON (RFC 8785), so key order never changes the hash, and returns its SHA-256 as 64 lowercase hex digits:

```ts
await canonicalInputHash({ to: "ada@example.com", body: "Hi" }) === await canonicalInputHash({ body: "Hi", to: "ada@example.com" }); // true
```

Any changed value gives a different hash. A property set to `undefined` counts as absent, as it does in `JSON.stringify`. The hash is async, because Web Crypto's digest is. It rejects with a `SafetyError`, code `invalid_input`, for an input that has no single JSON form:

- a number that isn't finite;
- `undefined`, or a hole, in an array;
- a string with a lone surrogate;
- a bigint or a function;
- an object that isn't plain, such as a `Date`;
- an object or array that contains itself.

## An approved call runs only after its signed pause verifies

An approval that travels through a browser or a stored chat is untrusted input: anyone who can edit the history can approve a call they changed. `signedToolApproval()` closes that gap for the AI SDK's call-level `toolApproval`. Wrap the policy you would pass anyway, and give the adapter a signer and a store:

```ts
const toolApproval = signedToolApproval({ signer, store, policy: { refund: "user-approval" }, recheck });
const result = await generateText({ model, messages, tools: { refund }, toolApproval });
```

When the policy asks for a person, the adapter signs a pending request and keeps it in the store under the tool call's id. The signature covers the request's id and kind, the call id, the tool's name, the input's hash and an optional policy version. The AI SDK then asks the adapter again just before it runs the approved call. At that point the adapter runs the call only if four checks pass:

1. The store holds a pending request for the call. Each request is used once, so a replayed approval fails.
2. The signature verifies under a key the signer holds.
3. The call's id, tool and input match what was signed, so an edited input fails.
4. Your policy doesn't deny the call now, and `recheck` allows it.

Any other answer denies the call, and its `execute` never runs. No option turns these checks off. The model receives a `not_applied` outcome as the denial's reason, in the same shape `toAiToolResult()` gives, so it can tell the user or ask again with a fresh call. A tool that still sets the deprecated `needsApproval` gets the same signing when your policy says nothing about it.

Keep the AI SDK's own `experimental_toolApprovalSecret` set as well. It is a second check, signed with one secret and no key id, and it throws `InvalidToolApprovalSignatureError` on a bad signature instead of denying the call.

## `recheck` lets current policy stop an approved call

An approval can sit for hours, and your rules can change while it waits. `recheck` runs after the pending request verifies and before the call runs, with the request and the call's input. Resolve to `"allow"`, or to `{ deny }` with a reason the model reads:

```ts
const recheck: Recheck = async (pending) =>
  pending.policyVersion === currentPolicyVersion ? "allow" : { deny: "the refund policy changed" };
```

Pass `policyVersion` to the adapter so each pause records the version it was made under. A `recheck` that throws, or answers anything but `"allow"`, denies the call. `onRejected` receives the cause of every denial, such as `signature_invalid` or `input_changed`, for your audit log; it never receives key material.

## Use a persistent key ring wherever a pause can resume in another process

A signature only helps if the process that resumes can check it. `ephemeralSigner()` makes a random key that lives only in the current process, so it suits a single long-running process. On Cloudflare, AWS Lambda or Vercel, the isolate or function that paused may be gone before the person answers. There, an ephemeral pause always fails closed.

On those hosts, keep a key ring in the platform's secret store and pass `hmacSigner()` over it. `parseKeyRing()` reads the ring from the secret's text, JSON such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}`, with each key as 32 or more random bytes in unpadded base64url:

```ts
const signer = hmacSigner(parseKeyRing(env.APPROVAL_KEYS));
```

`hmacSigner()` signs with the `current` key and verifies with any key in the ring. To rotate, add a new key and make it current, then remove the old one once no unanswered pause names it. Your platform's secret tooling does the rotation; the signer only reads the ring. `signerFromKeyStore()` builds the same signer from any `KeyStore`, an object whose `load()` returns the ring.

The signers compare signatures in constant time, copy the keys you pass, and keep them inside Web Crypto. No error message, log line or signer property holds a key's bytes. For tests, `testSigner()` signs with a fixed, published key, so its signatures are the same in every process; anyone can forge them, so never use it outside tests.

## Keep pending requests where the resume can find them

A `PendingStore` holds each signed pending request from the pause until the resume, and needs two methods: `put()` and `take()`. `memoryPendingStore()` keeps them in memory, for tests and single-process hosts. On a serverless host, back the store with storage that outlives the isolate, such as Durable Object storage. The store needn't be trusted, because the adapter verifies every request it takes before the request counts.

## On Cloudflare, settle denied approvals before the next turn

Pass the adapter as `toolApproval` to the `streamText` call in your `AIChatAgent`'s `onChatMessage`, and the client's approval over the agent's WebSocket gets the same checks. One difference remains as of `agents` 0.33.0: the agent drops the denial chunk for a part it already marked as approved. The stored part therefore keeps its approval, and the model's next step fails because that call has no result. To fix the stored history, collect the denied call ids from `onRejected`, keep them in the agent's storage, and pass them to `settleDeniedApprovals()` before converting the messages:

```ts
const messages = settleDeniedApprovals(this.messages, deniedCallIds);
```

It marks those parts as denied and keeps each person's approval as given. Store the result if it changed, then convert it for the model.

## Sign and verify a pause without an SDK

The adapter rests on two functions in the root entry, which any host can call. `signPending()` hashes a call's input and signs the pending request, and `verifyResolution()` checks a person's answer against it before the call runs. `verifyResolution()` never throws for bad input; it returns `ok: false` with the first check that failed.

## The root entry loads without any third-party SDK

`@buildanagent/agent-safety` imports no third-party SDK, so it runs anywhere Web Crypto does: Node 22, Cloudflare Workers and other edge runtimes. Adapters for other SDKs live in subpaths. `./ai` needs `ai` and `@ai-sdk/provider-utils`, which are optional peer dependencies. `./agents` will hold adapters that need Cloudflare `agents` itself, and it holds none yet, because `AIChatAgent` works through the `./ai` adapters.

To see how the model runs these tools, read the [SDK's README](../sdk/README.md).
