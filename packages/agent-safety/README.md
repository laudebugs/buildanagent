# @buildanagent/agent-safety

When a tool changes the world, such as sending an email or issuing a refund, your agent must know exactly what happened, and a person must approve exactly what runs. This package gives every write one of five typed outcomes and an identity that a crash can't repeat, hashes tool inputs the same way on every runtime, signs approvals so a forged or stale one runs nothing, lets a person approve a whole plan once before a step that can't be undone, keeps every model call on the user's own key, and refuses a model call before it is sent when the call could push a run past its USD cap.

As of November 2026 the package is not on npm yet. It holds the write outcomes, `renderOutcome()`, `canonicalInputHash()`, the approval signers, the adapters for the Vercel AI SDK, which also serve Cloudflare's `AIChatAgent`, the guards that keep model calls on the user's key, `guardedWrite()`, which keeps a crash or a regenerated turn from repeating a write, `costGuard()`, which caps what AI SDK model calls may spend, and the signed plan approval, which expires when the state a plan was computed from changes. Running a plan and compensating its steps come next.

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

## Pick a durable store for the target: Durable Object SQLite, DynamoDB or Postgres

Each target has an `EffectStore` and a `PlanLedger` that keep their records across restarts. Each lives in its own subpath, takes its database client as an argument, and imports no client library the others don't need, so a Worker that uses one loads none of the rest.

| Target | Subpath | Effect store and ledger | What you provide |
| --- | --- | --- | --- |
| Cloudflare | `./stores/cloudflare` | `durableObjectEffectStore()`, `durableObjectPlanLedger()` | The object's `ctx.storage.sql`, with `createCloudflareTables()` run once |
| AWS | `./stores/dynamodb` | `dynamoEffectStore()`, `dynamoPlanLedger()` | A `DynamoDBClient` from `@aws-sdk/client-dynamodb`, and a table with a string partition key `pk` |
| Vercel, or any Postgres | `./stores/postgres` | `postgresEffectStore()`, `postgresPlanLedger()` | A client with `query(text, values)`, such as `pg`'s `Pool`, and `POSTGRES_SCHEMA` run once |
| Local Node | the root entry | `memoryEffectStore()`, `memoryPlanLedger()` | Nothing; the records vanish with the process |

```ts
import { createCloudflareTables, durableObjectEffectStore } from "@buildanagent/agent-safety/stores/cloudflare";

// In a Durable Object's constructor:
createCloudflareTables(this.ctx.storage.sql);
const store = durableObjectEffectStore(this.ctx.storage.sql); // pass it to guardedWrite() as `store`
```

Every change is one conditional write that the database decides, so two processes that race for one record can't both win. The Durable Object stores run their statements with no `await` between them, so no other event in the object runs between two of them, and each statement is conditional as well. The Postgres stores use `INSERT … ON CONFLICT` and `UPDATE … WHERE attempt = …` with `RETURNING`. The DynamoDB effect store puts items under a condition expression, and its ledger claims a step in one transaction that checks the step before and puts this one.

A Durable Object store belongs to one object, so give each tenant or session its own object, or rely on the keys that `effectKey()` makes unique across tenants.

A ledger's records follow the same rule as an effect store's: keep them as long as an approval can still be replayed. A plan's ledger rows are tiny, one per step, so keeping them costs little.

Each store runs the cases `effectStoreConformance()` and `planLedgerConformance()` return from `./testing`, and a third-party store should too. The ledger cases check that concurrent claims of one step pass once, that a step claimed out of order is refused, and that a refused or replayed claim uses nothing up.

This package's own tests run the cases on every store, each on the nearest thing to the real engine:

- **Durable Object stores:** inside workerd, on real Durable Object storage.
- **Postgres stores:** on PGlite, which is Postgres compiled to WebAssembly and run in the test's process.
- **DynamoDB stores:** through the AWS SDK, against a fake that speaks DynamoDB's wire protocol, applies the condition expressions and records each request.

A DynamoDB test proves the request shapes and the store's reading of DynamoDB's answers, not DynamoDB's own atomicity. PGlite and the fake run one request at a time, so their concurrent cases are serialized. A live check of the DynamoDB conditions belongs with the first deploy.

The package's portable tests also run inside workerd, in a Worker that loads each test file with a small runner in place of Vitest, so the same files that pass on Node 22 pass on the Workers runtime. `test/workerd-suite.test.ts` lists the files that stay in Node and why, and fails when a new test file is in neither list.

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

## One signed approval covers a whole plan whose pivot can't be undone

A per-call approval breaks a plan with an irreversible step. Suppose an agent marks an order, refunds it and then emails the customer. If the person approves the email only after the refund has gone out, a rejected or edited email strands the plan past a step nobody can take back. A plan approval asks once, before the first step, and its signature covers every step's exact input. Before each step runs, `verifyPlanBeforeStep()` checks that the step is the signed one and, until the irreversible step has run, that the state the plan was computed from still holds.

These rules follow our [sagas research](../../docs/research/reversible-actions/sagas.md#approval-belongs-before-the-first-compensable-step-and-covers-the-whole-plan). They are our own synthesis, not a vendor design: no vendor source the sagas report read discusses approval relative to a pivot.

## Classify every step as compensable, the pivot, or retryable

Each step gets one of three classes, after the saga terms the sagas report takes from Microsoft's saga pattern:

- **`compensable`:** a later failure can undo it, such as an order update whose compensation restores the old status.
- **`pivot`:** the point of no return, such as a card refund. Once it runs, every later step must run.
- **`retryable`:** runs after the pivot and is idempotent, so a failure is retried, never undone.

`lintPlan()` enforces the order. Every compensable step comes before the pivot, a plan has at most one pivot, and every retryable step comes after it. A plan without a pivot therefore holds compensable steps only. Step ids must be unique and non-empty. `lintPlan()` returns `{ ok: true }`, or `ok: false` with every problem it found, and `signPlan()` and `planCard()` throw a `SafetyError`, code `invalid_plan`, for a plan that fails it.

The refund-then-email plan from the sagas report has four steps. The email must come after the refund, because a "your refund is on its way" message followed by a failed refund leaves a promise no step can take back:

```ts
const plan: PlanFields = {
  steps: [
    { id: "mark", tool: "order_update", class: "compensable", input: { orderId, status: "refund_pending" },
      summary: `Mark order ${orderId} as refund_pending` },
    { id: "refund", tool: "refund_create", class: "pivot", input: { orderId, amountCents, currency: "usd" },
      businessKey: `refund:${orderId}`, summary: `Refund ${amount} to the card on order ${orderId}` },
    { id: "email", tool: "send_email", class: "retryable", input: { to, subject, body },
      businessKey: `email:${orderId}:refund`, summary: `Tell ${to} the refund is on its way` },
    { id: "close", tool: "order_update", class: "retryable", input: { orderId, status: "refunded" },
      summary: `Mark order ${orderId} as refunded` },
  ],
  state: [
    { source: "orders", key: `order:${orderId}:refundable_cents`, value: refundableCents },
    { source: "payments", key: `order:${orderId}:refunded_cents`, value: refundedCents },
  ],
  expiresInMs: 15 * 60 * 1000,
};
```

## List in `state` every value the plan's inputs were computed from

The refund amount above came from the refundable balance and the amount already refunded. If either changes before the refund runs, the approved amount may be wrong, so both belong in `state`. The rule is: **list every value the plan's arguments were computed from**. Which values those are is a judgment about each tool, and no check can find a value you left out. Write an absent value as `null`.

Leave out any value that a step before the pivot changes itself. The order update in step 1 bumps the order's version, so a plan that listed the version would find it changed before the refund and stop. Read the values the refund depends on instead, and let step 1's `refund_pending` status keep other writers away while the plan runs.

`stateHash()` hashes the values with their sources and keys, in order, as canonical JSON. The hash changes when any value, read or order changes, and it never equals a tool input hash of the same values.

## Show the card, then sign the plan the person approved

`planCard(plan)` builds the data an approval card shows: each step's position, tool, class, summary, exact input and input hash, with `isPivot` marking the pivot, plus the state the plan read. It is plain JSON for your UI to draw.

Once the person approves, sign the plan you kept on your server, never fields the client sends back:

```ts
const card = await planCard(plan);                 // send to the approver
const approval = await signPlan(plan, signer);     // after they approve; store it as JSON
```

`signPlan()` stores each input's `canonicalInputHash()` and the state's `stateHash()`, never the inputs or values themselves, and sets `expiresAt` to `expiresInMs` from now. `expiresInMs` must be a finite number of at least 1. Its signature covers the plan id, the expiry, the state hash, the state reads, and every step's id, tool, class, input hash, business key and summary, in order. The signed bytes start with their own tag, `buildanagent.plan-approval.v1`, so a plan signature never verifies as a tool approval, and a tool approval never verifies as a plan. Sign with the same `hmacSigner()` ring as your pauses.

## Verify the approval before every step

Call `verifyPlanBeforeStep()` before each step, with the step as you are about to run it, and run the step only on `"ok"`:

```ts
const ledger = memoryPlanLedger();
const check = await verifyPlanBeforeStep(approval, { stepId: "refund", tool: "refund_create", input }, {
  signer, ledger, readState: (reads) => readValues(reads),
});
if (check !== "ok") return check; // stop; compensate the steps that ran only if the pivot never ran
```

Every step must pass the same first checks. The signature must verify under a key the signer holds, the step id must be in the plan, and the tool and input must match what was signed. Steps up to and including the pivot then check two more things: the approval hasn't passed `expiresAt`, and `readState` returns values that hash to the signed state hash. Steps after the pivot skip the clock and the state, because the pivot itself changes the state, as a refund changes the refunded amount, and nothing after the pivot may wait on a person or a clock. The function returns the first failure it finds:

| Result | Meaning |
| --- | --- |
| `tampered` | The record is malformed, its signature fails or names an unknown key, or the step's tool or input differs from the signed one |
| `step_not_in_plan` | No signed step has that id |
| `expired` | The approval has passed `expiresAt`, checked up to and including the pivot |
| `stale_approval` | A value the plan was computed from has changed, checked up to and including the pivot |
| `replayed` | The step already passed once |
| `out_of_order` | A step ahead of it hasn't passed yet |

A changed, added, removed or reordered step, a changed state read and an extended expiry all fail the signature, so each returns `tampered`. `readState` must return `null` for an absent value, as the plan recorded it; `undefined` counts as a changed value. The function never throws for a bad record, a bad call or a signer that throws; each returns a refusal. It rejects only when `readState` or the ledger rejects, and the step must not run then either.

## The ledger lets each step pass once, in order

The last check claims the step in a `PlanLedger`, after every other check has passed, so a failed check claims nothing. `claim(planId, stepIndex)` records the step only when every earlier step is recorded and this one isn't, so a replayed approval can't run a step twice and no step can skip ahead. A step that passed once returns `replayed` on a second check when every earlier check passes again. A step up to the pivot meets the clock and the state first, so once the pivot has changed the state or the approval has lapsed, a second check of that step returns `stale_approval` or `expired` instead. So retry a step that already passed under its effect key, without checking it again.

The ledger records that a step passed its check, not that the step ran. A step after the pivot returns `ok` once the pivot has passed, even if the refund then failed or the process crashed before it. So the host tracks which steps ran and runs each step only after the one before it succeeded. It compensates the steps that ran only when the pivot never ran, and once the pivot has run, it runs forward, whatever a later check returns. `claim()` must be atomic, because two checks of one step that arrive together must pass once between them. `memoryPlanLedger()` keeps the claims in memory, for tests and single-process hosts. A host whose plan can resume in another process needs a durable ledger, such as the ones in [the stores section](#pick-a-durable-store-for-the-target-durable-object-sqlite-dynamodb-or-postgres), and a ledger of your own should pass `planLedgerConformance()`.

## `runPlan()` runs the approved plan and says what is true afterwards

`verifyPlanBeforeStep()` checks one step. `runPlan()` runs the whole plan: it verifies each step, runs it as a `guardedWrite()`, undoes the steps that ran if the plan fails before the pivot, and returns an outcome the harness computed, never one the model guessed. You give it the signed approval and one `PlanStepImpl` for each signed step, in order. A step holds its signed `step`, its exact `input`, a `dedupe` rule, a `run(key)` that returns a `WriteOutcome`, and, for a compensable step, a `compensate(key)` that returns an `applied` outcome once the step is undone. Each key comes from `effectKey()`, so no step and no compensation is ever sent under a fresh key. A step without a business key is keyed by the plan id and the step id. A step with one is keyed by the business key alone, which names one operation for good across plans. A step that another plan already applied therefore returns that plan's stored outcome without a call.

```ts
const outcome = await runPlan({ approval, steps, store, scope, signer, ledger, readState });
return planWriteOutcome(outcome); // the WriteOutcome the model reads, or renderPlanOutcome(outcome) for its text
```

The rules, in the order the steps meet them:

- **Before the pivot, a failure undoes the steps that ran.** The compensations run last first, each as a guarded write under a key of its own, and the pivot never runs. The outcome is `failed_compensated`, with the undone steps in `undone`.
- **A compensation that fails stops the unwind.** The step that could not be undone and every step before it go in `held` and `outstanding`, and the outcome is `failed_needs_human`. A step before it may depend on this one being undone, so nothing further is undone. A compensation that another process is still running returns `pending` instead.
- **A pivot whose result is not known returns `pending` with `phase: "pivot_unknown"`.** Nothing is undone, because the pivot may have taken effect, and nothing is sent under a new key. Call `runPlan()` again: the pivot's `reconcile` hook checks the earlier attempt, and a pivot that took effect lets the plan run forward.
- **A pivot that was rejected is undone like any failed step. A pivot that left effects is not.** A pivot that only partly took effect returns `failed_needs_human` without undoing the steps before it, because undoing them could leave the plan worse.
- **After the pivot nothing is undone.** A step that fails or times out and may still succeed returns `pending` with `phase: "running"`, and the next call retries or reconciles it. A step that cannot finish returns `failed_needs_human`: the steps that ran are in `held`, and that step and every later one are in `outstanding`.
- **A cancel before the pivot undoes the steps that ran, and a cancel after it is ignored.** Pass an `AbortSignal` as `signal`. It is checked before each step up to and including the pivot starts. Once the pivot has started, the plan runs forward.
- **A stale or lapsed approval is a failure of the step that meets it.** Found before any step ran, it returns `stale_approval` or `expired` and nothing ran. Found after a step ran, it undoes the steps that ran and returns `failed_compensated` with the reason `STALE_APPROVAL` or `EXPIRED`.
- **A forged approval, or a step whose input differs from the signed one, is refused the same way.** Found before any step ran, it returns `rejected`. Found later, it is a failure of that step: before the pivot the steps that ran are undone with the reason `NOT_VERIFIED`, and after it the plan goes to a person.
- **A plan undoes only the steps it ran.** A step that another plan applied under the same business key is left alone.

The mapping onto the five write outcomes is fixed, and `renderPlanOutcome()` renders it with `renderOutcome()`:

| Plan outcome | Write outcome | Retry |
| --- | --- | --- |
| `completed` | `applied` | `never` |
| `failed_compensated` | `compensated` | `new_operation_only` |
| `failed_needs_human` | `partial`, with `held`, the steps that still hold, as its applied effects | `never` |
| `pending`, `pivot_unknown` | `unknown` | `reconcile_first` |
| `pending`, `running` | `unknown` | `never` |
| `stale_approval`, `expired`, `rejected` | `not_applied` | `new_operation_only` |

**The step records are the compensation log.** Each step's record carries the plan id and step id of the call that wrote it, so reading the records in plan order shows which steps this plan ran. A plan that crashed and is called again with the same approval skips every step that already ran, compensates exactly those if it was unwinding, and never repeats a call. The one extra record is the plan's decision to unwind, which a resume reads first, so a step that failed is not retried while its plan is half undone.

A resume needs a durable `EffectStore` and a durable `PlanLedger`: with in-memory ones, a new process forgets the plan. A compensation that crashed before it settled is checked with `reconcileCompensation`, and without that hook it comes back `unknown` and goes to a person.

`runPlan()` throws a `SafetyError` with the code `invalid_plan` when the steps are not the signed ones, a compensable step has no `compensate`, or a step that can't be undone has one.

It can't catch a value you left out of `state`: if a step's arguments came from a value the plan never listed, the approval does not cover that value, and no check can find the gap. That is a known miss, and the rule in the `state` section above is the only guard against it. Keep a plan inside one process: one that outlives it needs plan state beyond what the effect store holds, which is out of scope here.

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

Every provider that `explicitProvider()` builds sends its requests through `egressGuard()`, which you can also wrap around any other `fetch`. The OpenAI provider's realtime transcription opens a WebSocket instead, and `explicitProvider()` puts its handshake through the same checks and allows only the plain `realtime` subprotocol, because OpenAI's browser mode carries a key in a subprotocol where no header check sees it. The guard refuses a request, with the code `egress_refused` and before anything leaves, in three cases. First, the request goes to another origin or outside the base URL's path, which includes a path holding an encoded `/` or `\`. Second, its credential header is missing or differs from the configured key: `x-api-key` for Anthropic, `authorization: Bearer` for OpenAI. Third, it carries a second credential header, such as `x-api-key` beside an OpenAI key or `cf-aig-authorization` beside the key. One exception exists, described next. The guard never follows a redirect, because Node's `fetch` forwards `x-api-key` to a redirect's new host.

### An authenticated Cloudflare AI Gateway takes one more credential, set on purpose

A Cloudflare AI Gateway with authentication turned on wants its token in a `cf-aig-authorization: Bearer <token>` header beside the provider key, which Anthropic's endpoint reads from `x-api-key`. Pass the token as `gatewayToken` to `explicitProvider()` or `egressGuard()`, and the guard adds that header to every request. It is the only credential beyond the provider key that a request may carry. A request that brings its own `cf-aig-authorization` with any other value is refused, and so is every other credential header. The token can go to one place only: the base URL must name one Cloudflare AI Gateway, `/v1/<account>/<gateway>` on `gateway.ai.cloudflare.com`, or the guard throws `invalid_byok_config` when it is built, so a base URL of the host alone can't send the token to another account's gateway, and a request to any other origin or path is refused before it leaves. A token that is empty or is not printable ASCII without whitespace throws the same way, and no error message holds the token or the key. Without `gatewayToken`, a request that carries `cf-aig-authorization` is still refused. The package has no mode for a provider key stored on the gateway: `apiKey` is always sent, and Cloudflare treats a key in the request as the request's own, so stored keys are bypassed. The guard doesn't check the gateway's **Require provider credentials** setting; `checkModelRoutes()`, below, does. Its errors name headers, never their values.

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

The projection is the gateway's own formula, the one our SDK's `budgetUsd` uses, so both caps agree on what a call can cost. The guard turns the AI SDK request into the gateway's transcript and calls `estimateInputTokens()`. When the request continues a call the guard has already seen, on the same model with the same tools, that call's reported input and output stand in for everything up to its answer, and only the messages added since are estimated from their characters. Another model counts tokens with another tokenizer, and a new tool adds input the earlier usage doesn't hold, so either one makes the guard estimate the whole request from its characters. An answer in the prompt that is longer than the call returned counts at least its own character estimate.

`projectCost()` then prices every input token at the model's dearest input rate and adds the call's output limit at the output rate. That limit is the call's `maxOutputTokens`, or the catalog's limit for the model when the call sets none; pass `maxOutputTokens` to `costGuard()` to set a lower limit on such calls and price them at it. An image counts at the largest per-image size a provider documents, in a message or in a tool's result. A file that is not an image counts by its data when the request carries it. A file sent by URL or by provider reference carries none, so the guard asks `fileSize` for its size. `{ bytes }` counts as the base64 characters those bytes would take inline. `{ pages }` counts each page as one image and leaves out the text a provider reads from the page, so give bytes when you have them. A usable size is a whole number of bytes up to 2 ** 32, or of pages up to 100,000. The guard remembers each size it was given, so a tool loop asks once for each file. A file with no usable size, one whose `fileSize` throws included, makes the guard refuse the call with `unknown_price` before it is sent, because a long PDF sent unsized would otherwise cost more than its projection. The refusal names the file by its `filename`, or by its URL without the query, which may hold a signature.

After each call the guard adds what the call cost to the spend: the usage the response reported, priced with the catalog, read from the `finish` part when the call streams. The AI SDK reports cache writes as one count, so the guard prices them at the dearer of the short and long write rates. An attempt that throws before it returns a response reports no usage. If its abort signal stopped it while the request was in flight, by the caller's signal or the AI SDK's `timeout`, the provider may already have generated tokens, so the guard charges its projection, the most it could have cost. Any other error, and a signal that was already aborted when the request was sent, adds nothing, and the guard checks the AI SDK's retry again before it is sent. A stream that is cancelled or breaks before its `finish` part, such as a chat the user stops, is charged its projection the same way, and the guard carries on. A stream that reports an `error` part and never finishes is charged the same. A streamed call holds its projection against the cap until its stream ends or is cancelled, so a stream you drop without reading or cancelling keeps that amount reserved and shrinks the room left for later calls.

The guard refuses a call with one of two codes, both on `BudgetExceeded`, a `SafetyError`:

- `budget_exceeded`: the spend so far plus the projection would pass the cap. A cap of 0 refuses the first call.
- `unknown_price`: the guard can't tell what the call or the spend costs. The catalog has no price for the model, no rate for the call's input size, or the request holds a file the guard can't size, so the call is refused with a `projectedUsd` of `null`. The guard also stops when an earlier response reported no usage, or usage the catalog can't price, and was charged its projection, or when the `Spend` failed to record a call's cost. Every later call through the guard is then refused, because a spend the guard can't read is never counted as zero. A `Spend` whose `get()` returns anything but a finite number of 0 or more refuses the call too, with a `spentUsd` of `NaN`.

The guard finds a model's price by the part of the AI SDK's provider name before the first dot, so `anthropic.messages` reads the catalog's `anthropic` entry for the model id. It reads the gateway's `defaultCatalog` unless you pass `catalog`. The AI SDK retries only a provider error marked retryable, so a refusal ends the call on its first attempt and `generateText` rejects with the `BudgetExceeded` itself. `streamText` hands it to `onError` instead. A refusal on a retry reaches you inside the AI SDK's `RetryError`, and `budgetRefusal()` finds it there too.

## Cap each run with a fresh `Spend`, and the session with a shared one

The guard keeps the spend in a `Spend`, an object with `get()` and `add(usd)`, so where the `Spend` lives decides what the cap covers. A fresh `memorySpend()` for each run caps that run. To cap a whole session, keep one `Spend` that every run of the session reads, such as a row in your database or in a Durable Object's storage. Pass both guards to `guardedProvider()`, and a call goes out only when each of them allows it:

```ts
const models = guardedProvider(provider, [
  costGuard({ capUsd: 0.5, spend: memorySpend() }),
  costGuard({ capUsd: 5, spend: sessionSpend }),
]);
```

Calls that run at the same time through one guard share its cap. The guard holds each call's projection against the cap until the call's cost is known, so two parallel calls can't both spend the last of the budget. A store need not show an `add()` to a `get()` that started before it, so the guard also counts what it added while a read was pending; such a read can count a cost twice, which errs towards refusing. A guard sees only the calls that pass through it, though: another process that adds to the same session `Spend` is counted once its `add()` has finished, not while its call is in flight.

Build every model a run uses from the guarded provider, the models `prepareStep` switches to included. A model built any other way never passes through the guard, so its calls are never checked. A string model id escapes it too, because the AI SDK resolves the id through its default provider; `assertNoDefaultProvider()` from `./byok` makes such an id throw. The guard caps language models only: `guardedProvider()` passes embedding, image, transcription, speech and reranking models through unguarded, so their calls are never counted. Wrap a single model with `guardedModel(model, guards)`. On Think, which calls `getModel()` for each turn, return a model from a guarded provider there; build the guarded provider once, so every turn shares one cap. The package's workerd tests run both a Cloudflare `AIChatAgent` and a `Think` agent under a cap.

## The root entry loads without any third-party SDK

The root entry of `@buildanagent/agent-safety` imports no package at all, so it runs anywhere Web Crypto does: Node 22, Cloudflare Workers and other edge runtimes. Adapters for other SDKs live in subpaths. `./ai` needs `ai` and `@ai-sdk/provider-utils`, `./byok` needs `@ai-sdk/anthropic` and `@ai-sdk/openai`, and `./cost` needs `ai`; all four are optional peer dependencies. `./cost` also imports `@buildanagent/gateway` for its price catalog and cost projection, and the gateway is the package's one dependency. `egressGuard()` and `checkModelRoutes()` sit in the root entry, so a host without the AI SDK can use them. `./agents` will hold adapters that need Cloudflare `agents` itself, and it holds none yet, because `AIChatAgent` works through the `./ai` adapters. `./testing` holds `testSigner()` and the `EffectStore` conformance cases, and imports no third-party SDK either.

To see how the model runs these tools, read the [SDK's README](../sdk/README.md).
