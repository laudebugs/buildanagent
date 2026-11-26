---
title: Problems and fixes
description: Problems you may hit with write outcomes, signed approvals, guarded writes, the own-key guard and the cost cap, each from what you see, to its cause, to its fix.
---

You will find fourteen problems, each written from what you see to why it happens and how to fix it. You need this page when an agent-safety call throws, or when a write or an approval does not behave as you expected.

Every error here is a `SafetyError`, which carries a `code` property. The entries name that code, and `isSafetyError()` recognises such an error even when two copies of the package are loaded.

## Write outcomes and hashes

### `writeOutcome()` throws `invalid_outcome` about a reason

**You see.** `writeOutcome()` throws a `SafetyError` with the code `invalid_outcome` and the message `a write outcome's reason must be upper snake case and at most 63 characters, got "card declined"`.

**Cause.** A `reason` is a stable code for machines to match. It must be upper snake case, start with a letter, end with a letter or a digit, and have at most 63 characters.

**Fix.** Write the reason as `CARD_DECLINED`. Put the sentence for people in `next` or `currentState`.

### `writeOutcome()` throws `invalid_outcome` about a retry rule

**You see.** `writeOutcome()` throws a `SafetyError` with the code `invalid_outcome` and a message such as `a applied outcome cannot use retry "same_key"`.

**Cause.** Each kind of outcome allows only some retry rules. An `applied` outcome allows only `never`, because the write took effect and a retry would repeat it. TypeScript flags the same mistake when the kind is a literal.

**Fix.** Leave `retry` out to take the kind's default, or pick a rule from the table on the [write outcomes](/agent-safety/outcomes/) page.

### A `partial` or `unknown` outcome throws `invalid_outcome` about an effect key

**You see.** `writeOutcome()` throws a `SafetyError` with the code `invalid_outcome` and the message `a unknown outcome can use retry "same_key" only with an effectKey`.

**Cause.** A retry with `retry: "same_key"` is safe only when the retry carries the same key as the first attempt. Without an `effectKey`, a retry of a write that may have taken effect could take effect twice.

**Fix.** Pass the `effectKey` that `guardedWrite()` hands to your `toOutcome` and `onError` functions. If your tool cannot name a key, choose `retry: "reconcile_first"` or `retry: "never"`.

### Hashing or signing throws `invalid_input` and names a path

**You see.** `canonicalInputHash()`, `signPending()` or `guardedWrite()` throws a `SafetyError` with the code `invalid_input` and a message such as `the input at $.amount is NaN, so it has no canonical JSON form`.

**Cause.** A tool input must have exactly one JSON form, so the hash is the same on every runtime. A number that is not finite, a `Date` or another object that is not plain, a bigint, a function, a hole in an array and a string with a lone surrogate have none. The path in the message points at the value.

**Fix.** Convert the value before it reaches the tool's input: send a `Date` as an ISO string, and check a number is finite.

## Approvals and keys

### `hmacSigner()` throws `invalid_key_ring` for a short key

**You see.** `hmacSigner()` throws a `SafetyError` with the code `invalid_key_ring` and the message `the key "a" must be a Uint8Array of at least 32 bytes`, with your key's id in place of `a`.

**Cause.** The signer accepts only keys of at least 32 bytes, the length of one SHA-256 output. The message names the key's id and never its bytes.

**Fix.** Generate 32 random bytes for each key. For a ring stored as a secret, `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` prints a key in the form `parseKeyRing()` reads.

### `parseKeyRing()` throws `invalid_key_ring` for text that is not JSON

**You see.** `parseKeyRing()` throws a `SafetyError` with the code `invalid_key_ring` and the message `the key ring is not valid JSON`.

**Cause.** The secret's text must be a JSON object, `{"current":"2026-11","keys":{"2026-11":"<key>"}}`, with each key as unpadded base64url. The message hides the parser's own error, because that error can quote the key.

**Fix.** Store the ring as that JSON object in your platform's secret store, and read it whole. A key that is not base64url throws the same code with the message `the key "<id>" must be unpadded base64url`.

### An approval is refused with `signature_invalid` after a restart

**You see.** `verifyResolution()` returns `ok: false` with the cause `signature_invalid` for an approval that a person gave, and the call never runs.

**Cause.** The pause was signed in another process, or before a restart, and the verifying signer lacks the key that signed it. An `ephemeralSigner()` makes a random key that lives only in its process, so no other process can verify its signatures. On a serverless host the process that paused is often gone before the person answers.

**Fix.** Sign with `hmacSigner()` over a key ring from your platform's secret store. Keep an old key in the ring until no unanswered pause names it.

### An approval is refused with `input_changed`

**You see.** `verifyResolution()` returns `ok: false` with the cause `input_changed`, though the person allowed the call.

**Cause.** The input the host is about to run does not hash to the input that was signed. Someone edited the call while it waited, or the host rebuilt the input in a different shape, such as a changed amount.

**Fix.** Run the call with exactly the input the person saw. If the input must change, sign a new pause and ask again. A `call_mismatch` cause means the call id or the tool's name differs, and the fix is the same.

## Guarded writes

### `guardedWrite()` throws `invalid_effect` for an empty scope field

**You see.** `guardedWrite()` rejects with a `SafetyError` with the code `invalid_effect` and the message `an effect scope's tenant must be non-empty`.

**Cause.** The scope names who asked: the tenant, the session, the branch and the tool call id. Each must be non-empty text, and so must a business key and the operation. The message names the field that broke the rule.

**Fix.** Fill the field from the run's own identifiers. For `tenant`, use the user's id, because one tenant is one user and a business key never spans two users.

## Model calls and the cost cap

### `explicitProvider()` throws `invalid_byok_config` for a missing key

**You see.** `explicitProvider()` throws a `SafetyError` with the code `invalid_byok_config` and the message `explicitProvider(anthropic) needs the user's apiKey, and got none`.

**Cause.** The provider takes the key only from its options and never from the environment. An empty string counts as none, and so does a key that you did not load for this user.

**Fix.** Load the user's key before you build the provider. A key with surrounding whitespace throws the same code with the message `explicitProvider(anthropic) got an apiKey with surrounding whitespace or a control character`, so trim it where you read it.

### A model call throws `default_provider` for a string model id

**You see.** `generateText()` throws a `SafetyError` with the code `default_provider` and the message `A string model id "anthropic/claude-haiku-5-5" was resolved for a languageModel; string ids route through a default provider, which may use a credential nobody configured. Pass a model built with explicitProvider() instead.`

**Cause.** `assertNoDefaultProvider()` has run, so a model named by a string, which the AI SDK would send through a default provider, is refused before any request.

**Fix.** Build the model from the provider that `explicitProvider()` returns, and pass that model. The same code is thrown when another default provider is already set at the time you call `assertNoDefaultProvider()`.

### A model request throws `egress_refused`

**You see.** A model call throws a `SafetyError` with the code `egress_refused` and a message such as `egressGuard refused a model request: its x-api-key header differs from the configured key`.

**Cause.** The egress guard sends a request only to the configured address and only with the configured key. Here the call set its own `x-api-key` header, perhaps through the `headers` option of `generateText()`. A second credential header gives `it carries a second credential header, authorization`.

**Fix.** Remove the credential header from the call, so the provider's key is the only one. To reach another address or key, build another provider with `explicitProvider()`.

### A model call is refused with `budget_exceeded`

**You see.** A model call throws a `BudgetExceeded` error with the code `budget_exceeded`. Its message reads `anthropic.messages/claude-sonnet-5-5 was not called: $0 is spent or in flight and the call can cost up to $1.280004, which passes the cap of $0.5`. The figures follow the catalog's prices.

**Cause.** The guard projects the most the call could cost, and the spend so far plus that projection would pass the cap. A call that sets no output limit is projected at the model's full limit, so a dear model can be refused with nothing spent.

**Fix.** Set `maxOutputTokens` on the call, or on `costGuard()`, to the longest answer you need. Raise the cap only if the call is worth its projected cost. A cap of 0 refuses every first call.

### A model call is refused with `unknown_price`

**You see.** A model call throws a `BudgetExceeded` error with the code `unknown_price` and a message such as `the price of anthropic.messages/mystery-1 is unknown, so a call under a USD cap can't be checked; add the model to the catalog`.

**Cause.** The guard cannot check a cap without a price. The catalog may lack the model, the request may hold a file whose size the guard cannot read, or an earlier response may have reported no usage.

**Fix.** Use a model in the gateway's catalog, or pass your own `catalog` to `costGuard()`. For a file sent by URL, set `fileSize` on `costGuard()` so the guard can size it. After a response that reported no usage, every later call through that guard is refused, so build a new guard for the next run.

Next, look up any type or function in the [agent safety API reference](/reference/agent-safety/).
