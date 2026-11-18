# Transactions and idempotency for agent tool calls (as of November 2026)

*Working material for the [server rollback report](../server-rollback.md); the report and its [fact-check log](../fact-check-server-rollback.md) supersede this note where they disagree.*

Fetched 2026-11-18 with `curl -sSL --max-time 30` unless noted. Repo paths are relative to `/home/user/agent-speak` at commit `13b28a9`. "Inferred" marks my reasoning, not a source's claim.

## 1. One transaction per tool call: EF Core, Prisma, Drizzle, and what cannot be inside the transaction

### Takeaway
All three ORMs give one callback- or scope-shaped transaction that maps cleanly onto "one tool call = one transaction". Each has a trap for retries. In EF Core, a retrying execution strategy refuses user transactions unless the whole unit runs inside `strategy.ExecuteAsync`, and a commit that fails mid-flight leaves the outcome unknown. Prisma 7 and the Prisma 8 RC do not retry write conflicts for you, and a nested `db.transaction` in Prisma 8 is a separate transaction, not a savepoint. In Drizzle a nested `tx.transaction` is a savepoint. Emails, HTTP calls and payments do not roll back, so they go after commit or through a transactional outbox.

### Cited Findings

**Versions (registry reads, 2026-11-18)**
- `Microsoft.EntityFrameworkCore`: the newest NuGet versions are `11.0.0-rc.3.26522.148` and then `11.0.0`, so EF Core 11.0.0 is published. I did not record the publish date. — [NuGet flat container](https://api.nuget.org/v3-flatcontainer/microsoft.entityframeworkcore/index.json)
- `Npgsql.EntityFrameworkCore.PostgreSQL`: the newest version listed is `11.0.0-rc.3`, so no 11.0.0 final had shipped as of the fetch. — [NuGet flat container](https://api.nuget.org/v3-flatcontainer/npgsql.entityframeworkcore.postgresql/index.json)
- `@prisma/client`: `latest` = `7.10.1` (2026-10-15). — [npm registry](https://registry.npmjs.org/@prisma/client)
- `prisma` (CLI): `latest` = `8.0.0-rc.34` (2026-11-16), `prev` = `7.10.1`, `next` = `8.0.0-rc.10`. The `latest` tag therefore points at a release candidate. — [npm registry](https://registry.npmjs.org/prisma)
- `@prisma/orm-postgres` (the Prisma 8 Postgres runtime): `latest` = `8.0.0-rc.24` (2026-11-16). — [npm registry](https://registry.npmjs.org/@prisma/orm-postgres)
- The Prisma docs banner says "Prisma ORM 8 is here. The docs now default to Prisma ORM 8. Prisma ORM 7 docs stay at /orm/v7". npm still tags 8 as `-rc`, so the docs and the registry disagree on whether 8 is GA. — [Prisma transactions page](https://www.prisma.io/docs/orm/prisma-client/queries/transactions); [npm registry](https://registry.npmjs.org/prisma)
- `drizzle-orm`: `latest` = `0.45.4` (2026-10-08); `rc` = `1.0.0-rc.5` (2026-10-21); `beta` = `1.0.0-beta.22`. The docs site advertises "v1.0" and an "Upgrade to v1.0" guide. — [npm registry](https://registry.npmjs.org/drizzle-orm); [Drizzle transactions page](https://orm.drizzle.team/docs/transactions)
- The repo's pin rule asks for releases at least one week old (`AGENTS.md`, Coding standards). On that rule the stable pins as of 2026-11-18 are EF Core 11.0.0 (if it is at least a week old; I did not check), `@prisma/client@7.10.1` and `drizzle-orm@0.45.4`. Prisma 8 rc.34 and rc.24 are two days old. — inferred from the dates above

**EF Core** ([Using Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions), last updated 2026-08-31; [Connection Resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency), last updated 2022-07-26)
- By default, "all changes in a single call to SaveChanges are applied in a transaction… SaveChanges is guaranteed to either completely succeed, or leave the database unmodified if an error occurs." — [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- `AutoTransactionBehavior` takes `WhenNeeded` (the default), `Always` or `Never`. With `Never`, "earlier commands may have already been committed, leaving partial changes." — [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- `context.Database.BeginTransactionAsync()` / `CommitAsync()` groups several `SaveChanges` calls and queries; the transaction "will auto-rollback when disposed if either commands fails". — [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- "Manually controlling transactions in this way is incompatible with implicitly invoked retrying execution strategies." — [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- Savepoints: when `SaveChanges` runs inside an existing transaction, "EF automatically creates a savepoint before saving any data" and rolls back to it on error. `CreateSavepointAsync` and `RollbackToSavepointAsync` are the manual API. EF creates no savepoints when SQL Server MARS is enabled. — [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- `TransactionScope` works, but "if you're using async APIs, be sure to specify `TransactionScopeAsyncFlowOption.Enabled`". Distributed transactions are Windows-only (.NET 7+), `TransactionScope` "does not support async commit/rollback", and a provider that does not support `System.Transactions` may ignore the calls entirely. — [Transactions](https://learn.microsoft.com/en-us/ef/core/saving/transactions)
- `EnableRetryOnFailure()` turns on a retrying execution strategy. With it, "each query and each call to SaveChangesAsync() will be retried as a unit", and EF buffers result sets internally. — [Connection Resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency)
- A user-initiated `BeginTransactionAsync` under a retrying strategy throws `InvalidOperationException: The configured execution strategy 'SqlServerRetryingExecutionStrategy' does not support user-initiated transactions`. The fix is `db.Database.CreateExecutionStrategy().ExecuteAsync(async () => { …BeginTransaction…Commit })`, which replays the whole delegate on a transient failure. — [Connection Resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency)
- "If the connection is dropped while the transaction is being committed the resulting state of the transaction is unknown." By default the strategy retries as if the transaction rolled back, which can duplicate rows that have store-generated keys. The page gives four options: (1) accept rare failure and use client-generated GUID keys; (2) rebuild state from a new `DbContext`; (3) `ExecuteInTransactionAsync(db, operation, verifySucceeded)` with `SaveChangesAsync(acceptAllChangesOnSuccess: false)`; (4) insert a tracking row with a GUID id in each transaction, and on a commit failure check whether that row exists. — [Connection Resiliency](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-resiliency)

**Prisma 7** ([Transactions and batch queries, v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md))
- Three techniques: nested writes for dependent writes, `$transaction([])` for independent writes, and interactive `$transaction(async (tx) => …)` for read-modify-write. — [Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md)
- Interactive options: `maxWait` (default 2000 ms), `timeout` (default 5000 ms) and `isolationLevel`. — [Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md)
- Isolation levels: `ReadUncommitted`, `ReadCommitted`, `RepeatableRead`, `Snapshot` (SQL Server only) and `Serializable`. The default is the database's own: ReadCommitted on PostgreSQL and SQL Server, RepeatableRead on MySQL, Serializable on CockroachDB and SQLite. — [Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md)
- "Use interactive transactions with caution… Try to avoid performing network requests and executing slow queries inside your transaction functions." — [Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md)
- The v7 page has an "Idempotent APIs" section. It contrasts an upsert without a unique constraint (not idempotent) with one on a uniquely constrained email (idempotent), and walks through a Slack-upgrade-plus-Stripe example that charges the customer twice when the database update fails after the payment succeeds. — [Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md)

**Prisma 8** ([Transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions), the default docs)
- The API is `db.transaction(async (tx) => …)`. Prisma 8 "has no `$transaction`", and the array form has no replacement. A single write needs no transaction: "every mutation is already atomic on its own." — [Prisma 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- Calling `db.transaction(...)` inside a callback "does not nest: the inner call is a separate transaction that commits or rolls back on its own, and the outer one cannot roll it back. Pass tx down instead." — [Prisma 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- Options are `isolationLevel` and `timeout` in ms, set per client through `transactionOptions` or per call. Without a timeout, the transaction stays open as long as the callback runs. A timeout rejects with `RUNTIME.TRANSACTION_TIMEOUT`. "There is no maxWait option." — [Prisma 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- "Prisma ORM does not retry write conflicts for you." A conflict at commit surfaces as `RUNTIME.TRANSACTION_COMMIT_FAILED` with `sqlState` on `cause` (40001 for a serialization failure, 40P01 for a deadlock). The page supplies a `withRetry` wrapper. — [Prisma 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- Supported databases are PostgreSQL, SQLite and MongoDB; MySQL is a read-only early preview. MongoDB has no `db.transaction`, so you use the driver's session. — [Prisma 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)
- "Side effects inside the callback… Database writes roll back; emails don't." Run the side effect after commit. Querying through `db` instead of `tx` inside the callback runs "outside the open transaction". — [Prisma 8 transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)

**Drizzle** ([Transactions](https://orm.drizzle.team/docs/transactions))
- `await db.transaction(async (tx) => { … })` returns the callback's value. — [Drizzle](https://orm.drizzle.team/docs/transactions)
- "Drizzle ORM supports savepoints with nested transactions API": `tx.transaction(async (tx2) => …)`. — [Drizzle](https://orm.drizzle.team/docs/transactions)
- `tx.rollback()` "throws an exception that rollbacks the transaction". — [Drizzle](https://orm.drizzle.team/docs/transactions)
- PostgreSQL config: `isolationLevel` (read uncommitted, read committed, repeatable read, serializable), `accessMode` and `deferrable`. — [Drizzle](https://orm.drizzle.team/docs/transactions)
- The page documents no timeout and no automatic retry. — [Drizzle](https://orm.drizzle.team/docs/transactions) (absence on the fetched page)

**Side effects and the transactional outbox**
- Problem: "How to atomically update the database and send messages to a message broker?" 2PC is not an option. Solution: store the message in an outbox table "as part of the transaction that updates the business entities. A separate process then sends the messages." Benefit: "Messages are guaranteed to be sent if and only if the database transaction commits." Drawback: the relay "might publish a message more than once… a message consumer must be idempotent". Relay variants: transaction log tailing and polling publisher. — [microservices.io, Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- Brandur Leach (Stripe) argues that endpoints that mutate only local ACID state can get "a robust and simple idempotency implementation by mapping requests to transactions", and that endpoints with foreign state mutations need idempotency keys, "atomic phases", "recovery points" and background jobs (an enqueuer, a completer and a reaper). Secondary (personal blog, 2017). — [brandur.org, Implementing Stripe-like Idempotency Keys in Postgres](https://brandur.org/idempotency-keys)

### Inferences
- A tool-call handler maps onto one transaction in each ORM: EF Core's `strategy.ExecuteAsync(() => { BeginTransaction; …; insert idempotency row; SaveChanges; Commit })`, Prisma's `db.transaction(tx => …)` wrapped in a retry on 40001 and 40P01, and Drizzle's `db.transaction(tx => …)`. EF Core's option 4 (insert a GUID tracking row and verify it on commit failure) is the same mechanism as an idempotency-key row inserted in the same transaction. The tool call id can be that GUID.
- EF Core's per-request `DbContext` (unit of work) fits a tool-call endpoint when each tool call is one HTTP request. I did not fetch the `AddDbContext` lifetime docs in this pass (see Gaps).
- Prisma 8's non-nesting behaviour means a tool handler that calls a helper which opens its own `db.transaction` silently breaks atomicity. Pass `tx` down explicitly. Drizzle's nested call is safe because it becomes a savepoint.

### Gaps
- I did not fetch EF Core docs on `DbContext` lifetime (scoped per request with `AddDbContext`) or on the Npgsql retrying strategy (`NpgsqlRetryingExecutionStrategy`). Both are stated from memory and need a source before the report uses them.
- I did not confirm EF Core 11.0.0's NuGet publish date.
- Whether Prisma 8 is GA is unresolved: the docs say yes, npm says RC.

## 2. Idempotency keys: Stripe, the IETF draft, storage, concurrency, and tool call ids as keys

### Takeaway
The established design is a client-generated key, scoped per account, stored with a fingerprint of the request and the saved response. A retry with the same key and parameters replays that saved response. A different payload gets a 422 (IETF) or an error (Stripe). A concurrent duplicate gets a 409. Keys are retained for about 24 hours. Model tool call ids (`toolu_…`, `call_…`) can serve as keys when the server scopes them per tenant and per session and hashes the arguments as the fingerprint. They protect only against re-executing a persisted tool call. If the harness regenerates the model turn, the model emits a new id for the same action.

### Cited Findings

**Stripe (API reference, API version `2026-10-28.endive` shown in the page header)**
- "For API v1, Stripe saves the status code and body of the first request made with a given idempotency key after endpoint execution begins. Retries with the same key return the saved response, including 500 errors." With API v2, "retries don't repeat successful operations. Stripe retries failed or partially failed work to completion when possible." — [Stripe, Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Keys are client-generated, V4 UUIDs are suggested, they can be up to 255 characters, and they should not contain sensitive data. — [Stripe, Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- "For API v1, you can remove keys from the system automatically after they're at least 24 hours old. We generate a new request if a key is reused after the original is pruned." — [Stripe, Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- "The idempotency layer compares incoming parameters to those of the original request and errors if they're not the same." — [Stripe, Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- No result is saved if validation fails or "the request conflicts with another request that's executing concurrently". Those requests can be retried. — [Stripe, Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Keys go on POST requests only; GET and DELETE are idempotent by definition. — [Stripe, Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- API v2 "uses different replay behavior and a 30-day window". — [Stripe, Advanced error handling](https://docs.stripe.com/error-low-level)
- "If a 409 indicates that another request with the same key is still executing, wait and retry with that key and the same parameters. A new key can start a second operation." — [Stripe, Advanced error handling](https://docs.stripe.com/error-low-level)
- Treat a 500 as indeterminate: "Don't retry with a new idempotency key until you've resolved the original outcome." — [Stripe, Advanced error handling](https://docs.stripe.com/error-low-level)
- "If your application retries across separate SDK calls or process restarts, generate and persist a key for the operation and supply it to every attempt." The page names two key strategies: random (UUID v4), or "Derive the key from a user-attached object, like the ID of a shopping cart". — [Stripe, Advanced error handling](https://docs.stripe.com/error-low-level)
- A replayed response carries the header `Idempotent-Replayed: true`. The status table defines 409 as "The request conflicts with another request, potentially due to using the same idempotent key". — [Stripe, Advanced error handling](https://docs.stripe.com/error-low-level)
- Stripe's 2017 blog post (secondary; it predates the current docs) gives the rationale: ambiguous network failures, retry until a definitive response, and a cached result for a response that failed in transit. — [Stripe blog, Designing robust and predictable APIs with idempotency](https://stripe.com/blog/idempotency)

**IETF `draft-ietf-httpapi-idempotency-key-header`**
- The current revision is **-08**, dated 2026-10-22 and expiring 2027-04-25, 14 pages. Its states are "Active", "I-D Exists" (IESG) and "WG Document" (HTTPAPI working group). It is not an RFC, and `intended_std_level` is null. — [Datatracker API](https://datatracker.ietf.org/api/v1/doc/document/draft-ietf-httpapi-idempotency-key-header/?format=json); [Datatracker page](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Syntax: an Item Structured Header Field (RFC 9651) whose value MUST be a String, for example `Idempotency-Key: "8e03978e-40d5-43e8-bc93-6894a57f9324"`. — [draft-08 §2.1](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- "The idempotency key MUST be unique and MUST NOT be reused with another request with a different request payload. Uniqueness of the key MUST be defined by the resource owner." A UUID (RFC 9562) is RECOMMENDED. — [draft-08 §2.2](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Expiry: the resource MAY require time-based keys and SHOULD publish the expiration policy. — [draft-08 §2.3](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Fingerprint: the resource MAY generate one from the payload: a checksum of all or part of the payload, field matching, or a digest or signature. — [draft-08 §2.4](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Enforcement: on a first request, process normally. On a retry after completion, the resource "SHOULD respond with a response consistent with the request being completed". On a concurrent request, the resource "SHOULD respond with a resource conflict error". — [draft-08 §2.6](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Errors: a missing key on an operation that requires one gets 400. Key reuse with a different payload gets 422 Unprocessable Content. A retry while the original is still processing gets 409 Conflict. All three use RFC 9457 problem+json or a `Link rel="describedby"` header. — [draft-08 §2.7](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Security: low-entropy keys can leak other clients' cached responses. The draft recommends a fixed, published key format, validating every key, and "a unique composite key… combining the idempotency key sent by the client with other client specific attributes known only to the resource". — [draft-08 §5](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- The draft lists implementers with the `Idempotency-Key` header: Stripe, Adyen, Dwolla, Interledger, WorldPay, Yandex, http4s, Finastra and Datatrans. It lists implementers of the concept under other header names: Django `HTTP_IDEMPOTENCY_KEY`, Chargebee, Twilio `I-Twilio-Idempotency-Token` and PayPal `PayPal-Request-Id`, among others. — [draft-08 §4](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- Appendix A lists the -07 to -08 changes, which are mostly reference updates (RFC 7231 to RFC 9110, RFC 7807 to RFC 9457, RFC 4122 to RFC 9562, RFC 8941 to RFC 9651). — [draft-08 App. A](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)

**Storing keys with a unique constraint in the same transaction (reference implementation)**
- Brandur's Postgres schema has an `idempotency_keys` table with `idempotency_key`, `locked_at`, `last_run_at`, `request_method`, `request_path`, `request_params JSONB`, `response_code`, `response_body JSONB`, `recovery_point` and `user_id`, plus `CREATE UNIQUE INDEX … ON idempotency_keys (user_id, idempotency_key)`. Uniqueness is per user, so two accounts can send the same key. `locked_at` marks a key that a request is actively working on. `request_params` is stored so a mismatched retry can error. Secondary. — [brandur.org](https://brandur.org/idempotency-keys)
- Each "atomic phase" runs in `DB.transaction(isolation: :serializable)`. A `SerializationFailure` returns 409, and on error the key is unlocked (`locked_at: nil`) so a later retry can proceed. Keys are recycled "beyond a horizon… say 24 hours or so". Secondary. — [brandur.org](https://brandur.org/idempotency-keys)

**Tool call ids**
- Anthropic `tool_use` blocks carry an `id` such as `"toolu_01A09q90qw90lq917835lq9"`. — [Claude docs, Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use)
- The Claude Agent SDK Python reference describes `tool_use_id` as a "Unique identifier for this tool use". — `docs/reference/claude-agent-sdk/source/python.md:2237` (repo mirror)
- OpenAI Responses function calls carry a `call_id` (example `"call_12345xyz"`), and the `function_call_output` must reference it. — [OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling.md)
- OpenAI Agents SDK (v0.21.0 mirror), hosted agents: "The Responses API's call ID is the routing token… If a tool has side effects, make it idempotent by call ID so an interrupted continuation cannot repeat the effect." — `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/models.mdx:209-213` (repo mirror of the openai-agents-js docs at tag v0.21.0)
- OpenAI Agents SDK sessions: `SessionHistoryTransactionAwareSession.applyHistoryTransaction(...)` receives "a stable `operationId`". The guide says to "Persist the operation identifier and history mutation in the same backend transaction. Repeating an operation identifier with the same transaction must succeed without applying it twice. Reusing the identifier with different content… must fail". — `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/sessions.mdx:119-125` (repo mirror)
- Cloudflare Agents (0.33.0 mirror): on chat recovery after eviction, "If the latest persisted message is still the unanswered user message from the interrupted turn, the framework retries that turn automatically unless `continue` is `false`." Settled tool results ("completed, often non-idempotent work") are always persisted. Where "Retries or side effects are unsafe", the docs say to return `{ continue: false }` from `onChatRecovery()` and to "Persist idempotency keys or completion records before external side effects so a recovered turn can tell whether work already happened." — `docs/reference/cloudflare-agents/source/agents/docs/agents/chat-agents.md:645-653` (repo mirror, tag `agents@0.33.0`)
- LangGraph: "Because interrupts work by re-running the nodes they were called from, side effects called before `interrupt` should (ideally) be idempotent", and "If a node fails after committing a side effect but before completing, retrying the node can repeat the effect. Use idempotent operations or deduplicate writes in the external system." — `docs/reference/langchain/source/src/oss/langgraph/interrupts.mdx:1365-1375` (repo mirror)

**This repo's plans**
- `SessionStore.append(key, entries, { expectedLastId })` is "idempotent by id" and has an expected-last-id compare-and-swap. A conformance suite pins "idempotent append by id". — `docs/plans/build-harness.md:294`, `docs/plans/build-harness.md:709`; todo `docs/todos/ready/N3-session-store.md:14,27`
- The agent plan's resume test requires that "an approval resolved in a second process sends the reply exactly once". — `docs/plans/build-agent.md:676`
- The plans do not say how a backend tool endpoint should deduplicate tool calls; they give idempotency only to the session log. — grep of `build-harness.md` and `build-agent.md` for "idempot" (only the two lines above match)

### Inferences
- **Key derivation.** Use the composite key `(tenant_id, session_id, tool_call_id)` with a unique constraint, and store `sha256(tool_name + canonical JSON args)` as the fingerprint. This follows the IETF §5 advice to combine the client key with server-known attributes and Brandur's per-user unique index. Scoping matters because providers document ids as unique per tool use, but I found no provider statement that ids are globally unique across accounts or over time.
- **Where ids repeat or change.**
  - (a) A resume replays a *persisted* assistant message, so the same `toolu_…` or `call_…` id comes back. Deduplication works here, and this is the crash-after-side-effect case that the OpenAI Agents SDK, Cloudflare and LangGraph warn about.
  - (b) A harness that retries or regenerates the *model call*, for example after a crash before the assistant message was persisted or after Cloudflare's automatic retry of an unanswered turn, gets a fresh id for what may be the same intended action. Deduplication by id fails.
  - (c) A forked or rewound session tree can replay an old tool call id on a new branch. Scoping by session alone does not separate the branches.
- **Mitigations for (b) and (c).** Persist the assistant tool-call entry before executing it, so the session log's idempotent append is the source of truth. Include the branch or entry id in the key. For high-stakes tools, add a business-level natural key such as "one refund per order", in line with Stripe's "derive the key from a user-attached object".
- **Status mapping for a tool endpoint.** Same key and same fingerprint, completed: replay the stored result, optionally with an `Idempotent-Replayed: true` header. Same key, different fingerprint: 422, which the harness should surface to the model as a tool error and not retry. Same key in progress: 409, which the harness retries with backoff using the same key. A 500 or a commit-unknown outcome: check the idempotency row (EF Core option 4) before re-executing.
- **Unique-constraint race.** Two concurrent first requests both try to insert the key row. One wins; the other gets a unique violation (Postgres 23505) and should answer 409. This follows from the IETF "concurrent request" rule. The Postgres error code is from general knowledge, not a fetched source.

### Gaps
- I found no Anthropic or OpenAI API documentation that states the uniqueness scope or lifetime of `toolu_` or `call_` ids (per response, per account, global), or that warns ids can collide.
- I found no SDK documentation stating explicitly that a regenerated model turn yields new tool call ids. Inference (b) is reasoning from how generation works and needs a test, for example a mock-model run in `verify/`.
- How each of our eight SDKs re-issues a tool call after a crash or resume is only partly covered above (OpenAI Agents hosted continuation, Cloudflare chat recovery, LangGraph interrupts). Claude Agent SDK, Pi, Vercel AI SDK, Copilot and ADK were not checked in this pass.

## 3. Libraries and middleware (ASP.NET Core, Node/Express/Nest)

### Takeaway
I found no built-in idempotency middleware in ASP.NET Core, Express or NestJS. The community packages are small, single-maintainer projects. The most active Node option is `@node-idempotency/*` (MIT, updated August 2026). The .NET option, `IdempotentAPI`, has not had a new version since late 2024. A hand-written table plus a unique index, inside the tool call's own transaction, is about as much code and gives the atomicity the packages may not.

### Cited Findings
- `IdempotentAPI` (NuGet): latest versions `2.6.0` and `2.7.0-issue-85-01` (prerelease, published 2024-11-09); project https://github.com/ikyriak/IdempotentAPI. — [NuGet flat container](https://api.nuget.org/v3-flatcontainer/idempotentapi/index.json); [NuGet registration](https://api.nuget.org/v3/registration5-gz-semver2/idempotentapi/index.json)
- `@node-idempotency/express` `1.1.0` (2026-08-09) and `@node-idempotency/nestjs` `1.0.9` (2025-10-26), both MIT, repo `github.com/mahendraHegde/node-idempotency`. — [npm express](https://registry.npmjs.org/@node-idempotency/express); [npm nestjs](https://registry.npmjs.org/@node-idempotency/nestjs)
- `express-idempotency` `2.1.0` (2026-06-25), MIT, repo `github.com/VilledeMontreal/express-idempotency`. — [npm](https://registry.npmjs.org/express-idempotency)
- `@nestjs/core` latest is `12.5.1` (2026-11-16), which is under one week old and so not pinnable under the repo rule. — [npm](https://registry.npmjs.org/@nestjs/core)

### Inferences
- These packages work as HTTP middleware with their own storage, so the key record is probably written outside the handler's database transaction. That breaks "key and write commit together". I have not verified this against their source.

### Gaps
- I did not read these packages' READMEs or source, so their storage backends, concurrency handling (409), fingerprinting and transactional behaviour are unverified.
- I did not confirm from Microsoft docs that ASP.NET Core (.NET 10 or 11) has no built-in idempotency middleware. A grep of the fetched ASP.NET Core middleware overview page for "idempot" returned nothing, which is weak evidence.

## 4. Agent-specific vendor guidance on idempotent, retry-safe tools

### Takeaway
Vendors agree that a tool with side effects must be idempotent because frameworks re-execute work on retry, resume or replay. The concrete mechanisms are idempotency keys enforced by the downstream service (Temporal), keying by tool call id (OpenAI Agents SDK), persisting keys or completion records before the side effect (Cloudflare), and enabling retries only for idempotent tools (Vercel AI SDK MCP, Anthropic programmatic tool calling). MCP's `idempotentHint` is advisory only.

### Cited Findings
- Temporal: "Temporal recommends that Activities be idempotent." An Activity can complete and then the Worker can crash "just before it notifies the Temporal Service", in which case the Activity is retried. The fix is "idempotency keys… enforced by the service you are calling from your Activity, not by the Activity itself". The docs also suggest more granular Activities, so that only the failed step reruns. — [Temporal, Activity Definition](https://docs.temporal.io/activity-definition)
- Temporal: Workflow Executions do not retry by default, unlike Activities. — [Temporal, Retry policies](https://docs.temporal.io/encyclopedia/retry-policies)
- Anthropic engineering lists "Operations safe to retry (idempotent)" among the tools that suit programmatic tool calling. — [Anthropic, Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
- Claude Agent SDK custom tools: `idempotentHint` defaults to `false` and means "Repeated calls with the same arguments have no additional effect." — `docs/reference/claude-agent-sdk/source/custom-tools.md:337` (repo mirror)
- The repo's own research notes record that MCP `ToolAnnotations` are "hints", "not guaranteed to provide a faithful description of tool behavior". — `docs/research/agent/notes/safety-gates.md:38`
- Vercel AI SDK (ai@7.0.162 mirror): "Only enable retries for MCP tools where retrying is safe. Retrying non-idempotent tools, such as tools that send emails or create records, can duplicate side effects." — `docs/reference/vercel-ai-sdk/source/content/docs/03-ai-sdk-core/16-mcp-tools.mdx:396-398`
- Vercel AI SDK, OpenAI programmatic invocation: "avoid programmatic access to side-effecting tools unless the operation is idempotent". — `docs/reference/vercel-ai-sdk/source/content/providers/01-ai-sdk-providers/03-openai.mdx:763-764`
- OpenAI Agents SDK says to make side-effecting tools "idempotent by call ID"; Cloudflare says to persist idempotency keys before external side effects; LangGraph says side effects before `interrupt` should be idempotent (citations in §2).
- Prisma 7 docs: "Idempotency is something you can and should actively design into your application wherever possible." — [Prisma v7](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions.md)

### Inferences
- The vendor guidance puts idempotency in the tool implementation or the downstream service, not in the harness. For our design, the backend tool endpoint should own the transaction and the key table, and the harness should pass the tool call id (plus session and branch) through so the endpoint can deduplicate.

### Gaps
- The public LangGraph "durable execution" page (`docs.langchain.com/oss/javascript/langgraph/durable-execution`) now redirects to the persistence page, and the fetched text had no idempotency guidance. I used the repo mirror of `interrupts.mdx` instead.
- I found no first-party OpenAI API platform guidance (outside the Agents SDK) or Anthropic API guidance on making tools idempotent by tool call id.
