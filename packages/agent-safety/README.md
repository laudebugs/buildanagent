# @buildanagent/agent-safety

When a tool changes the world, such as sending an email or issuing a refund, your agent must know exactly what happened, and a person must approve exactly what runs. This package gives every write one of five typed outcomes and an identity that a crash can't repeat, hashes tool inputs the same way on every runtime, signs approvals so a forged or stale one runs nothing, keeps every model call on the user's own key, and refuses a model call before it is sent when the call could push a run past its USD cap.

As of November 2026 the package is not on npm yet. It holds the write outcomes, `renderOutcome()`, `canonicalInputHash()`, the approval signers, the adapters for the Vercel AI SDK, which also serve Cloudflare's `AIChatAgent`, the guards that keep model calls on the user's key, `guardedWrite()`, which keeps a crash or a regenerated turn from repeating a write, and `costGuard()`, which caps what AI SDK model calls may spend. Plan approvals come next.

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

## A write gets its identity before it runs, and a crash leaves it `unknown`

A crash or a regenerated model turn can repeat an email, an application or a refund. The process may die after the payment API accepted a refund and before the agent recorded it, and a harness that regenerates the lost turn gets a fresh tool call id for the same refund. `guardedWrite()` closes both gaps with one rule. It stores an effect record before the write runs and settles it with the outcome after, and it treats a record that never settled as `unknown`, never as an error to retry:

```ts
const outcome = await guardedWrite({
  store, scope: { tenant, session, branch, toolCallId }, businessKey: `refund:${input.orderId}`,
  operation: "refund_create", input, dedupe: "idempotency_key",
  run: (key) => payments.refunds.create(input, { idempotencyKey: key }),
  toOutcome: (refund) => writeOutcome({ kind: "applied", operation: "refund_create", next: `Tell the user ${refund.id} is issued` }),
  reconcile: async (key) => ((await payments.refunds.findByKey(key)) ? appliedOutcome : "not_found"),
});
```

`guardedWrite()` answers each call from the record it finds under the write's effect key:

| Record found | What `guardedWrite()` does | Outcome |
| --- | --- | --- |
| None | Stores a `started` record, runs `run(key)` and settles the record | The tool's own, from `toOutcome` |
| `settled` | Runs nothing | The stored outcome |
| Same key, another input or operation | Sends nothing | `not_applied`, retry `never`, reason `IDEMPOTENCY_KEY_REUSED` |
| `started`, lease still live | Runs nothing and calls no hook, because another attempt may be running | `unknown`, retry `same_key`, reason `IN_PROGRESS` |
| `started`, lease lapsed | Calls `reconcile(key)`: a found write returns its outcome, and `"not_found"` runs the write once under the same key | Whatever `reconcile` finds |
| `started`, lease lapsed, no `reconcile` | Runs nothing | `unknown`, reason `WRITE_INTERRUPTED`, retry `reconcile_first`, or `never` for `dedupe: "unknown_only"` |

The two refusals follow the IETF `Idempotency-Key` draft, which answers a reused key with a different payload with 422 and a retry of a request still running with 409.

Two settled outcomes are not final. A `not_applied` outcome that allows a `same_key` retry, such as a declined card reported through `onError`, runs again under the same key, because it changed nothing. A settled `unknown` or `partial` outcome whose retry isn't `never` goes to `reconcile`, like a lapsed lease. If `run` throws and the tool gives no `onError`, the write settles as `unknown`, because the request may have reached the system.

`toOutcome` and `onError` receive the effect key as their second argument, so an `unknown` or `partial` outcome they build can allow a `same_key` retry. No option lets a caller choose the key, so with a business key an `unknown` write never runs again under a fresh one.

## Declare a business key for every tool that sends, submits, pays or deletes

`effectKey()` hashes the scope into the key that `run` receives. With a business key, the hash covers only the tenant and that key. A regenerated turn, a new session and a forked branch then all map to the same effect, and one tenant is one user, so the same refund or email is blocked across all of that user's sessions. Without a business key, the hash covers the tenant, session, branch and tool call id, and a regenerated turn's fresh call id starts a fresh write, even after an `unknown` outcome. These tools therefore need a business key:

- **Send:** an email, a chat message or a reply, keyed by the thread and draft, such as `email:{threadId}:{draftId}`.
- **Submit:** a job application or a form, keyed by what it is for, such as `apply:{jobId}`.
- **Pay:** a refund, a charge or a credit, keyed by the order, such as `refund:{orderId}`.
- **Delete:** a record or a file, keyed by its id, such as `delete:{documentId}`.

A business key names one operation for good. Once its write has settled, every later call with that key returns the stored outcome, so a `compensated` outcome's `new_operation_only` retry, or a second refund of one order, needs a new business key, such as one that adds the request's own id: `refund:{orderId}:{requestId}`.

The key is 64 hex digits, never the business key's own text. Stripe caps an idempotency key at 255 characters and asks callers to keep email addresses and other personal identifiers out of it, and a hash meets both rules.

## Say how a retry finds the first attempt with `dedupe`

Every guarded write declares `dedupe`, which tells `guardedWrite()` what the external system can do with the key:

- **`idempotency_key`:** the system dedupes by the key `run` sends, as Stripe does with its `Idempotency-Key` header. `reconcile` is optional, but without it a crashed attempt stays `unknown` with retry `reconcile_first`, and `guardedWrite()` does not send it again on its own.
- **`reconcile`:** the system ignores keys, but `reconcile` can find the write by a field the tool sets, such as a message id header. The hook is required.
- **`unknown_only`:** the system offers neither. An interrupted attempt stays `unknown` with retry `never`, and the model is told to ask a person to check. Put such a tool behind an approval, so a person sees it before it runs.

## Keep effect records in a store that outlives the process

An `EffectStore` holds the records and needs four methods: `begin()`, `takeOver()`, `settle()` and `get()`. Each must be atomic, because every change is a compare-and-set on the record's attempt number; without that, two processes that resume one crashed write could both run it. In SQL, `INSERT ... ON CONFLICT DO NOTHING` and `UPDATE ... WHERE attempt = ?` give that. On Cloudflare, a Durable Object is single-threaded, so a store there can read and write a record with no other `await` between the two. `memoryEffectStore()` keeps records in memory, for tests and single-process hosts, and forgets them when the process ends. Keep records at least as long as a business key can come back and longer than the external API keeps its keys: Stripe's API v1 may prune a key after 24 hours and then treats a reused key as a new request. A durable store proves itself with the cases `effectStoreConformance()` returns from `./testing`, which import no test runner.

Set `leaseMs` longer than the slowest write, plus the clock skew between the hosts that share the store, because the host that resumes reads the lease on its own clock. A call that meets a live lease reports `IN_PROGRESS`, and once the lease lapses, the attempt counts as crashed. The default is five minutes.

## On Cloudflare, repair an interrupted write as `unknown`

`AIChatAgent` (`@cloudflare/ai-chat` 0.12.2) repairs a tool call left without a result before each turn, such as one whose `execute()` died with an evicted isolate. Its default repair stores an error, "The tool call was interrupted before a result was recorded.", which the model reads as a failure it may retry. For a write, override `repairInterruptedToolPart` with `repairInterruptedWrite()` from `./ai`:

```ts
protected override repairInterruptedToolPart(part: UIMessage["parts"][number]) {
  return repairInterruptedWrite(part, new Set(["send_email", "refund"])) ?? super.repairInterruptedToolPart(part);
}
```

The listed tools' parts then settle as `output-available` with an `unknown` outcome. Other tools keep the default repair, and so does a listed tool's part that is still streaming its input or awaiting approval, because its `execute()` never started. Convert the stored messages with your tools, `convertToModelMessages(this.messages, { tools })`, so each tool's `toModelOutput` hands the outcome to the model through `toAiToolResult()`. When the model calls the tool again for the same business key, `guardedWrite()` finds the started record. Until the record's lease lapses, it reports `IN_PROGRESS`, because it can't tell a dead isolate from a slow one; after that, it reconciles the record. A lease just longer than the tool's slowest write keeps that wait short.

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

If any check fails, the adapter denies the call, and its `execute` never runs. No option turns these checks off. The model receives a `not_applied` outcome as the denial's reason, in the same shape `toAiToolResult()` gives, so it can tell the user or ask again with a fresh call. A tool that still sets the deprecated `needsApproval` gets the same signing when your policy says nothing about it.

Keep the AI SDK's own `experimental_toolApprovalSecret` set as well. That setting adds a second check, signed with one secret and no key id. On a bad signature it throws `InvalidToolApprovalSignatureError` instead of denying the call.

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

The signers compare signatures in constant time, copy the keys you pass, and keep them inside Web Crypto. No error message, log line or signer property holds a key's bytes. For tests, `testSigner()` signs with a fixed, published key, so its signatures are the same in every process. Anyone can forge them, so it lives in its own subpath, `@buildanagent/agent-safety/testing`, which only test code should import.

## Keep pending requests where the resume can find them

A `PendingStore` holds each signed pending request from the pause until the resume, and needs two methods: `put()` and `take()`. `memoryPendingStore()` keeps them in memory, for tests and single-process hosts. On a serverless host, back the store with storage that outlives the isolate, such as Durable Object storage. The store needn't be trusted, because the adapter verifies every request it takes before the request counts. The store keys requests by call id alone, so two pauses with one id replace each other, and the first one's approval fails closed. Use one store per conversation, or make sure your model's call ids are unique across the conversations that share a store.

`take()` must remove and return a request in one atomic step. If it reads and then deletes, two copies of one approval that arrive together can both get the request, and the call runs twice. Durable Object storage is atomic within one object; elsewhere, use an atomic operation such as Redis `GETDEL` or SQL `DELETE ... RETURNING`.

The adapter takes a request whenever its call comes back approved, even when the check then fails. A forged approval therefore uses up the real one, and the model has to ask again. A call the person denies, or never answers, is never taken, so expire old requests: `memoryPendingStore()` drops each one 24 hours after it was stored (set `maxAgeMs` to change that), and a durable store should do the same. Expiry also lets you prune an old key once no stored request names it.

## On Cloudflare, settle denied approvals before the next turn

Pass the adapter as `toolApproval` to the `streamText` call in your `AIChatAgent`'s `onChatMessage`, and the client's approval over the agent's WebSocket gets the same checks. One difference remains as of `agents` 0.33.0: the agent drops the denial chunk for a part it already marked as approved. The stored part therefore keeps its approval, and the model's next step fails because that call has no result. To fix the stored history, collect the denied call ids from `onRejected`, keep them in the agent's storage, and pass them to `settleDeniedApprovals()` before converting the messages:

```ts
const messages = settleDeniedApprovals(this.messages, deniedCallIds);
```

`settleDeniedApprovals()` moves those parts to `output-denied` and marks their approval `approved: false`, the form `ai`'s own UI message validator requires for that state; each approval keeps its id and the person's reason. Store the result if it changed, then convert it for the model.

## Sign and verify a pause without an SDK

The adapter rests on two functions in the root entry, which any host can call. `signPending()` hashes a call's input and signs the pending request, and `verifyResolution()` checks a person's answer against it before the call runs. `verifyResolution()` never throws for bad input; it returns `ok: false` with the first check that failed.

## Every model call carries the user's own key, or it fails

An agent that bills the wrong account fails silently: the call succeeds, and someone else pays for it. In `ai` 7.0.162 three paths let that happen without a line of your code choosing it. A provider built without `apiKey` reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from the environment. A provider built without `baseURL` reads `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL`. A string model id such as `"anthropic/<model>"` goes to Vercel AI Gateway, which signs in with `AI_GATEWAY_API_KEY` or a Vercel OIDC token and, by default, falls back to Vercel's own billed keys. The `./byok` subpath closes all three for the models it builds and for string ids. A call on a model built with `explicitProvider()` throws before it is sent if it would carry anything but the key you passed, and a string id throws once `assertNoDefaultProvider()` has run. A model object you build any other way, such as one from `createAnthropic()` or the `gateway` that `ai` exports, isn't checked, so build every model with `explicitProvider()`:

```ts
import { assertNoDefaultProvider, explicitProvider } from "@buildanagent/agent-safety/byok";

assertNoDefaultProvider();
const anthropic = explicitProvider({ provider: "anthropic", apiKey: userKey, baseURL: "https://api.anthropic.com/v1" });
const result = await generateText({ model: anthropic(modelId), prompt });
```

`explicitProvider()` builds an `@ai-sdk/anthropic` or `@ai-sdk/openai` provider from the `apiKey` and `baseURL` you pass, and nothing else. Both are required, so the provider never reads the environment. A missing, empty or whitespace-padded key throws a `SafetyError` with the code `invalid_byok_config`, because the provider would otherwise send the empty key as given. The base URL must use https (plain http only on a loopback host, for a local proxy), must not end its host in a dot or hold an encoded `/` or `\` in its path, and must not be Vercel AI Gateway. A Cloudflare AI Gateway base URL must name the provider's own endpoint, `/v1/<account>/<gateway>/anthropic` for an Anthropic key. `assertNoDefaultProvider()` sets the AI SDK's default provider to one that refuses every model, so `generateText`, `streamText` or a `prepareStep` that names a model by string throws, code `default_provider`, before any request. Call it once at startup. It leaves the setting read-only, so later code that assigns another default provider throws instead of reopening the path. It throws the code `default_provider` if another default provider is already set.

## `egressGuard()` checks each request on its way out

Every provider that `explicitProvider()` builds sends its requests through `egressGuard()`, which you can also wrap around any other `fetch`. The OpenAI provider's realtime transcription opens a WebSocket instead, and `explicitProvider()` puts its handshake through the same checks and allows only the plain `realtime` subprotocol, because OpenAI's browser mode carries a key in a subprotocol where no header check sees it. The guard refuses a request, with the code `egress_refused` and before anything leaves, in three cases. First, the request goes to another origin or outside the base URL's path, which includes a path holding an encoded `/` or `\`. Second, its credential header is missing or differs from the configured key: `x-api-key` for Anthropic, `authorization: Bearer` for OpenAI. Third, it carries a second credential header, such as `cf-aig-authorization` beside the key, That rule means a Cloudflare gateway with authentication turned on can't be used through `explicitProvider()`. The guard never follows a redirect, because Node's `fetch` forwards `x-api-key` to a redirect's new host. Its errors name headers, never their values.

## Run model calls through Cloudflare AI Gateway with `byok_only`, never through Vercel AI Gateway

Each gateway has a setting that decides whether it may bill its owner's keys when the user's key fails. Cloudflare AI Gateway's **Require provider credentials** setting, `byok_only: true` in its API, refuses that fallback. The per-request header `cf-aig-no-wholesale: true` forces the same refusal, and it cannot relax the gateway's setting. `egressGuard()` adds that header to every request to `gateway.ai.cloudflare.com`, so pass a gateway endpoint as the base URL, such as `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic`. Through that endpoint the Anthropic key still travels in `x-api-key`, where the gateway reads provider credentials. Vercel AI Gateway's **Fallback to Vercel Keys** setting is on by default and lives only in the team dashboard, so no deploy configuration can show that it is off. The package therefore refuses every Vercel AI Gateway route.

A deploy step checks its routes with `checkModelRoutes()`, which returns a report rather than throwing:

```ts
const report = checkModelRoutes({
  routes: [{ provider: "anthropic", baseURL: gatewayURL, cloudflareAiGateway: { byok_only: true } }],
});
if (!report.ok) throw new Error(report.problems.map((problem) => problem.message).join("; "));
```

A route through Cloudflare AI Gateway passes only with `byok_only: true` and its own provider's endpoint, and a route through Vercel AI Gateway never passes. A route whose base URL is a loopback `http` URL fails too, because a deployed agent can't reach the deployer's loopback. The check fails closed: a field it doesn't know fails too, so a renamed gateway setting stops the deploy instead of slipping through. The report's `settingsAsOf` gives the date of the gateway documentation the setting names come from, 2026-11-18.

## A model call that could pass the USD cap is never sent

An agent loop that checks its spend after each response stops only once a response has already crossed the cap, so it overshoots by the whole cost of that call. The AI SDK has `stopWhen` but no spend cap at all. `costGuard()` from the `./cost` subpath checks before each call instead. It is a language-model middleware: before the provider sees a request, the guard projects the most the request can cost and throws `BudgetExceeded` if the spend so far plus that projection would pass `capUsd`. In `ai` 7.0.162 every step of `generateText` and `streamText`, and every retry, calls the model's `doGenerate` or `doStream`, so the guard sees each request. Because it wraps the model, the same guard caps a Cloudflare `AIChatAgent` that calls `streamText` in `onChatMessage`:

```ts
import { budgetRefusal, costGuard, guardedProvider, memorySpend } from "@buildanagent/agent-safety/cost";

const guard = costGuard({ capUsd: 0.5, spend: memorySpend() });
const models = guardedProvider(explicitProvider({ provider: "anthropic", apiKey: userKey, baseURL }), guard);
try {
  await generateText({ model: models.languageModel(modelId), prompt, tools, stopWhen: isStepCount(20) });
} catch (error) {
  const refused = budgetRefusal(error);
  if (refused === undefined) throw error;
  // The run stopped at its cap: refused.spentUsd, refused.projectedUsd and refused.capUsd say why.
}
```

The projection is the gateway's own formula, the one our SDK's `budgetUsd` uses, so both caps agree on what a call can cost. The guard turns the AI SDK request into the gateway's transcript and calls `estimateInputTokens()`. When the request continues a call the guard has already seen, that call's reported input and output stand in for everything up to its answer, and only the messages added since are estimated from their characters. `projectCost()` then prices every input token at the model's dearest input rate and adds the call's output limit at the output rate. That limit is the call's `maxOutputTokens`, or the catalog's limit for the model when the call sets none; pass `maxOutputTokens` to `costGuard()` to set a lower limit on such calls and price them at it. An image counts at the largest per-image size a provider documents. A file sent by URL or by provider reference has no size the guard can read, so it also counts as one image, and a long PDF sent that way can cost more than its projection.

After each call the guard adds what the call cost to the spend: the usage the response reported, priced with the catalog, read from the `finish` part when the call streams. The AI SDK reports cache writes as one count, so the guard prices them at the dearer of the short and long write rates. An attempt that throws before it returns a response reports no usage, so it adds nothing, and the guard checks the AI SDK's retry again before it is sent.

The guard refuses a call with one of two codes, both on `BudgetExceeded`, a `SafetyError`:

- `budget_exceeded`: the spend so far plus the projection would pass the cap. A cap of 0 refuses the first call.
- `unknown_price`: the catalog has no price for the model, so its first call is refused, or an earlier response reported no usage. A response without usage is charged its projection, and every later call through the guard is refused, because a spend the guard can't read is never counted as zero.

The guard finds a model's price by the part of the AI SDK's provider name before the first dot, so `anthropic.messages` reads the catalog's `anthropic` entry for the model id. It reads the gateway's `defaultCatalog` unless you pass `catalog`. The AI SDK retries only a provider error marked retryable, so a refusal ends the call on its first attempt and `generateText` rejects with the `BudgetExceeded` itself. `streamText` hands it to `onError` instead. A refusal on a retry reaches you inside the AI SDK's `RetryError`, and `budgetRefusal()` finds it there too.

## Cap each run with a fresh `Spend`, and the session with a shared one

The guard keeps the spend in a `Spend`, an object with `get()` and `add(usd)`, so where the `Spend` lives decides what the cap covers. A fresh `memorySpend()` for each run caps that run. To cap a whole session, keep one `Spend` that every run of the session reads, such as a row in your database or in a Durable Object's storage. Pass both guards to `guardedProvider()`, and a call goes out only when each of them allows it:

```ts
const models = guardedProvider(provider, [
  costGuard({ capUsd: 0.5, spend: memorySpend() }),
  costGuard({ capUsd: 5, spend: sessionSpend }),
]);
```

Calls that run at the same time through one guard share its cap. The guard holds each call's projection against the cap until the call's cost is known, so two parallel calls can't both spend the last of the budget. A guard sees only the calls that pass through it, though: another process that adds to the same session `Spend` is counted once its `add()` has finished, not while its call is in flight.

Build every model a run uses from the guarded provider, the models `prepareStep` switches to included. A model built any other way never passes through the guard, so its calls are never checked. A string model id escapes it too, because the AI SDK resolves the id through its default provider; `assertNoDefaultProvider()` from `./byok` makes such an id throw. Wrap a single model with `guardedModel(model, guards)`. On Think, which calls `getModel()` for each turn, return a model from a guarded provider there; the package's own workerd test covers `AIChatAgent` only.

## The root entry loads without any third-party SDK

`@buildanagent/agent-safety` imports no package at all, so it runs anywhere Web Crypto does: Node 22, Cloudflare Workers and other edge runtimes. Adapters for other SDKs live in subpaths. `./ai` needs `ai` and `@ai-sdk/provider-utils`, `./byok` needs `@ai-sdk/anthropic` and `@ai-sdk/openai`, and `./cost` needs `ai`; all four are optional peer dependencies. `./cost` also imports `@buildanagent/gateway` for its price catalog and cost projection, and the gateway is the package's one dependency. `egressGuard()` and `checkModelRoutes()` sit in the root entry, so a host without the AI SDK can use them. `./agents` will hold adapters that need Cloudflare `agents` itself, and it holds none yet, because `AIChatAgent` works through the `./ai` adapters. `./testing` holds `testSigner()` and the `EffectStore` conformance cases, and imports no third-party SDK either.

To see how the model runs these tools, read the [SDK's README](../sdk/README.md).
