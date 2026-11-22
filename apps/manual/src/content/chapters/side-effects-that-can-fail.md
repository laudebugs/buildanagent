---
title: "Side effects that can fail: outcomes, idempotency and plan approvals"
summary: A tool that writes to the world can fail in five different ways, and the model must be told which one happened. This chapter shows how a write reports applied, not_applied, compensated, partial or unknown, why a key saved before the call lets a crash be settled safely, and why a plan of several writes needs one approval before its first step.
opening: incident
sources: [stripe-idempotent-requests, stripe-advanced-error-handling, aws-safe-retries, azure-saga-pattern, stripe-refunds, openai-practical-guide-to-building-agents, buildanagent-agent-safety-readme, buildanagent-sdk-write-pauses]
glossary: [idempotency-key, saga]
switchTo: [E1, E2, E3, E4a, E4b]
---

In November 2026 we killed a payment tool in the one gap that matters: after the payment server wrote the charge for order 42 and before the tool wrote down that it had. The server held one charge. The tool's log held the key for that charge and no result. A fresh run of the same tool had to tell the model something, and both easy answers were wrong. "It failed" invites a second charge, and "it worked" is a guess that the log could not back. The truthful answer was a state with its own name, `unknown`, and a rule for what may happen next.

A write to the outside world can end in more than success or failure, and an agent that cannot tell the endings apart will repeat a write or report one that never happened. This chapter follows one charge tool through its endings. It names five outcomes and the retry rule for each, shows why the tool saves its key before it calls the server, replays the killed run until the server has seen exactly one write, and ends on the case where several writes belong to one plan and a single approval has to cover all of them.

## A write reports one of five outcomes, and each carries its own retry rule

A model reads a tool's answer as text and cannot tell a declined payment from a payment that may or may not have gone through unless the answer says so. The wire formats give little help. Anthropic's `tool_result`{checked=row-4} and MCP's `CallToolResult`{checked=row-4} carry an error flag, OpenAI's function output is a string whose "format is up to you", and several SDKs pass the raw exception message to the model. The outcome therefore has to live in the body of the result, in words the model reads and in a field the harness can act on.

Our harness's plan names five outcomes. `applied` means the write took effect. `not_applied` means it was rejected before any effect, for a reason such as validation or policy, and a retry after a fix is a new operation with a new key. `compensated`{checked=row-5} means it took effect and was then undone, so the world matches its state before the call. `partial`{checked=row-5} means some steps took effect and the undo failed or was skipped. `unknown` means a timeout or a lost response left nobody able to tell. The five outcomes and the retry rule for each are our proposal from distributed-API practice, not a vendor vocabulary. In the example that follows, a declined charge for order 13 is `not_applied`, and the killed run for order 42 is `unknown`. After `compensated`{checked=row-40}, only a new operation may repeat the work, and only if the user still wants it. After `partial`{checked=row-40}, the rule is an idempotent resume or a person's decision. [[fig:outcomes]] puts each outcome next to the rule that says what may happen next.

:::figure[The five outcomes of a write, and the rule for what may happen next: only unknown is settled by asking the other side]{#outcomes}
::svg{alt="Two columns of five rows joined by arrows. The left column lists applied, not_applied, compensated, partial and unknown. The right column gives the matching rule. Applied: done, a repeat reads the saved result. Not_applied: a new key after a fix. Compensated: a new operation, only if still wanted. Partial: resume with the same key, or ask a person. Unknown, drawn in the accent: ask the other side, never a fresh key."}
:::

The row that matters most is the last. A write that timed out is neither a success nor a failure, and the safe move is to resolve it before doing anything else. Stripe says to treat a 500 as indeterminate: "Don't retry with a new idempotency key until you've resolved the original outcome" [@stripe-advanced-error-handling]. Amazon's engineers call reconciliation, a workflow that finds out whether the work is still running, heavy lifting. They prefer a unique request identifier that the caller supplies, because requests from one caller with the same identifier count as duplicates [@aws-safe-retries]. A fresh key would be a new request, so the server would treat the retry as a second payment.

The model must also be told what it may not claim. These are our rules, and no published study measures how models react to "rolled back" versus "failed" wording, so an eval has to test them. After `not_applied`, it must not say the change happened. After `compensated`{checked=row-5}, it must not hide an effect that cannot be undone, such as an email already sent. After `partial`{checked=row-5} it must not present the result as success. After `unknown` it must never retry with a fresh key.

## The tool saves its key before it calls the server, so a crash leaves a trace

A shop that sends orders by courier writes each order in :analogy[a ledger before the courier leaves]{#ledger-before-courier}. If the courier never returns, the ledger still says the order went out, and the shop can phone the customer instead of guessing. The second line, the result, is written only when the courier is back. A charge tool should keep the same ledger. It writes the intent first, makes the call, and writes the outcome second. The first entry records intent, never success, and an intent with no result after it is the unknown outcome, as [[fig:ledger]] shows.

:::figure[Writing the order in the ledger before the courier leaves: the intent comes first, the result second, and a missing second line means nobody knows]{#ledger analogy="ledger-before-courier"}
::svg{alt="Two columns. On the left, a ledger with two lines: line 1, intent, send order 42, and line 2, result, delivered, drawn in the accent. On the right, a courier who leaves with order 42 and comes back delivered, with arrows to and from the ledger. A note says line 1 is written before the courier leaves and line 2 after the courier is back. A line below says a line 1 with no line 2 means: ask the customer."}
:::

The key is what lets the shop and the server find the same order again. Think of :analogy[a raffle ticket stub]{#raffle-ticket-stub}: one stub, one prize, however often the holder shows it. An idempotency key works the same way. The caller sends the same key with every attempt at one write, and the server applies the write once and answers a repeat with the first result. Stripe saves the status and body of the first request that used a key and replays them on retries, even for a 500 error [@stripe-idempotent-requests]. A stub is printed before anyone wins and the holder keeps it. The key must likewise exist before the call is made, or a crash loses it and the write can repeat.

Each of this chapter's six listings comes in two tabs. The first runs on our own packages, `@buildanagent/sdk` for the tool and the run and `@buildanagent/agent-safety` for the write guard, and the second keeps the listing the chapter showed before. As of November 2026 the SDK is a `0.1.0` alpha release and `@buildanagent/agent-safety` is not on npm yet, so their names may still change.

[[lst:write-tool-ours]] and [[lst:write-tool]] are the charge tool from our example. Each builds the key from the order, checks what it has recorded, writes the intent and only then calls the server. The first saves the outcome last through `guardedWrite()`{checked=row-44}, which stores a record of the write before it runs and settles the record with the outcome after [@buildanagent-agent-safety-readme]. The second keeps a log file of its own.

::::tabs
:::listing[Our SDK]{#write-tool-ours file="packages/sdk/examples/charge-tool.ts" region="write-tool"}
::note[The key comes from the business fact, one charge for one order. `guardedWrite()` hashes it with the tenant into the effect key that `run` receives, so a regenerated turn with a fresh call id maps to the same key.]{#key}
::note[`guardedWrite()` stores a `started` record before it calls `run`, and settles the record with the outcome after. This is the ledger's first line, and `run` sends the key to the server.]{#persist}
::note[A `started` record whose lease has lapsed sends the tool here before it writes again. Only a 404 lets the write run once more, under the same key.]{#reconcile}
::note[Any other answer to the lookup throws, and `guardedWrite()` settles the record as `unknown`.]{#unclear}
:::
:::listing[Vercel AI SDK]{#write-tool file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="write-tool" replay}
::note[The key comes from the business fact, one charge for one order, not from a random id. Every attempt at this write carries the same key.]{#key}
::note[A log entry that says a previous attempt started and never finished sends the tool to the server's records, before it writes again.]{#reconcile}
::note[The intent is saved before the request leaves. This is the ledger's first line.]{#persist}
::note[The example kills its own process here, after the server's reply and before the outcome is logged.]{#crash}
:::
::::

The key is the business fact, so a second run that asks for the same charge finds the first run's entry. A write that entry has already settled is answered from it, whether it applied or was declined, and no request goes out. In ours, a charge for order 7 that was applied and one for order 13 that was declined each reach the server once, however often the model asks. Only a definite decline, a 402 from this server, becomes `not_applied`; any other failure stays `unknown`, because a 500 or a dropped connection says nothing about whether the write landed.

Agent vendors treat the tool call id as the natural key, and both the OpenAI Agents SDK and Cloudflare say to persist it before the effect, as our server rollback report records. The OpenAI Agents SDK says that a tool with side effects should be made "idempotent by call ID so an interrupted continuation cannot repeat the effect". Cloudflare's agents documentation tells developers to "Persist idempotency keys or completion records before external side effects". Neither page says how long a call id is unique or what it is unique within. Our package therefore scopes a key by tenant, and a key with no business fact by session, branch and call id as well [@buildanagent-agent-safety-readme]. A key built from the business fact, as the example's is, also survives a resume that regenerates the model's call, because the resume issues a fresh call id for the same charge.

## A crash between the write and the result leaves unknown, and only the other side can settle it

Suppose you phone a restaurant to place an order and :analogy[the line goes dead mid-order]{#dropped-phone-order}. You cannot tell whether the kitchen heard you. Ordering again may feed you twice, and not ordering may leave you hungry. The sensible move is to phone back and ask whether the order is in. The agent's charge tool faces the same silence after a crash, and it needs the same move: ask the server before writing again. A restaurant has no order number to look up, though. That is why the write carried a key that the other side can be asked about.

The Vercel AI SDK tool reads its state from a small log of entries: the state of one operation is the outcome in its last entry, and a last entry that only says the write started means `unknown`. In ours, `guardedWrite()` keeps one record for each key in an `EffectStore`, and [[lst:effect-log-ours]] reads it by hand. No record means no write has started, a `started` record means `unknown`, and a settled record holds the outcome.

::::tabs
:::listing[Our SDK]{#effect-log-ours file="packages/sdk/examples/charge-tool.ts" region="effect-log"}
::note[A `started` record has no outcome yet, so the state is `unknown`. The store replaces a record as a whole when it settles, so there is no last entry to find.]{#state}
:::
:::listing[Vercel AI SDK]{#effect-log file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="effect-log"}
:::
::::

The example then crashes the tool on purpose. A child process runs the charge tool for order 42 and kills itself with `SIGKILL` after the server has answered and before the tool logs the outcome. The kill leaves exactly the state in the opening: the server has written once, and the log holds the key and no outcome. Ours cannot kill a process, because a book example runs in one process and keeps no durable store: it uses `memoryEffectStore()`. It stands in with a store whose `settle()` never returns once the server has answered, so the run never records its result, as a process killed at that point would not. `packages/agent-safety/test/crash.test.ts` kills a real child with `SIGKILL` at three points, among them while the payment API holds the request unanswered, and then runs the same call in a second process.

::::tabs
:::listing[Our SDK]{#crash-ours file="packages/sdk/examples/11-charge-crash-resume.ts" region="crash"}
::note[The server has the charge, and the record still says `started`.]{#written}
:::
:::listing[Vercel AI SDK]{#crash file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="crash"}
::note[The log has the key and no outcome, so the state is unknown.]{#unknown}
:::
::::

A fresh run of the same tool now reads the log, sees `unknown` and asks the server for the key, and the server says it has the write. The tool records `applied` and tells the model so, and it sends nothing. In ours, the record holds a lease, 60 seconds in the example. A second run that comes while the lease is live is told `unknown` and sends nothing, because the first attempt may still be running. Once the lease has lapsed, the run reaches `reconcile`.

::::tabs
:::listing[Our SDK]{#resume-ours file="packages/sdk/examples/11-charge-crash-resume.ts" region="resume"}
::note[The model's call carries a fresh id, yet the business key finds the same record, and the server is asked before anything is written.]{#resume}
:::
:::listing[Vercel AI SDK]{#resume file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="resume"}
::note[The server received exactly one write request for order 42, though the tool ran twice.]{#once}
:::
::::

A 404 from the lookup shows that this server holds no record of the key, and only then may the tool send the write, under the same key. Any other answer leaves the outcome `unknown` and the model is told so. In ours, the lookup returns `"not_found"` for a 404 only, and `guardedWrite()` then runs the write once under the same key. The model never sees a fresh key.

The Vercel AI SDK tool's log is a small file. It survives a killed process but not a power cut, because nothing is synced to disk before the call. Ours keeps its records in `memoryEffectStore()`, which forgets them when the process ends. A real deployment needs a store that makes the entry durable first, and the package has stores for Durable Object SQLite, DynamoDB and Postgres [@buildanagent-agent-safety-readme]. And the lookup works because the example's server can answer "have you seen this key?". A server that offers neither a lookup nor a replay for a reused key leaves the outcome `unknown` for a person to settle.

## A plan of several writes needs one approval before its first step, and the refund is the pivot

Booking a trip is :analogy[a saga]{#booking-a-trip} you already know. If the flight falls through, you cancel the hotel. Each step commits on its own, and each step that can be undone has an undo step. Microsoft's saga pattern names the parts [@azure-saga-pattern]. A compensable step can be undone. The pivot is "the point of no return", after which "all subsequent actions must be completed". The retryable steps after it "are idempotent". Some steps cannot be undone at all. In our reading, a plan needs one pivot, and nothing before it may depend on something after it.

Take a refund that updates an order, refunds the card and emails the customer. The refund is the pivot. Stripe can cancel only some card refunds, only "for a short period of time", and "only Dashboard cancellations are currently supported for card refunds", so an agent calling the API cannot count on reversing one [@stripe-refunds]. We treat an email as impossible to unsend. A correction email is a new write, not a compensation. That fixes the sequence of steps, which is our design. The update to the order goes first and writes a lock such as a refund-pending status, and its undo restores the earlier status. The refund goes second, under an idempotency key so a timeout can be retried. The email goes third. A last retryable step turns a refund-pending status into `refunded`. Sending the email before the refund is the one sequence to forbid, because "your refund is on its way" followed by a failed refund leaves a false statement that no step can undo.

The approval has to fit that shape. Every SDK the sagas report surveyed approves one tool call at a time, and none of them models a plan. [[lst:needs-approval-ours]] and [[lst:needs-approval]] show the per-call form, on our SDK and in a Cloudflare agent: a rule decides from the call's arguments whether the call waits for a person. Ours is a `beforeToolCall` gate that returns `ask` [@buildanagent-sdk-write-pauses], and Cloudflare's is a `needsApproval`{checked=row-33} function on the tool. As of November 2026, AI SDK 7 deprecates `needsApproval`{checked=row-33} in favour of a call-level `toolApproval`{checked=row-39}, but the Cloudflare chat agent's documentation still uses `needsApproval`, so the listing does too.

::::tabs
:::listing[Our SDK]{#needs-approval-ours file="packages/sdk/examples/12-approval-gate.ts" region="needs-approval"}
::note[The gate reads the call's arguments: a refund above 100 returns `ask`, and every other call returns an explicit `allow`.]{#rule}
:::
:::listing[Cloudflare Agents]{#needs-approval file="verify/cloudflare-agents/examples/06-tool-approval.ts" region="needs-approval"}
::note[The rule reads the call's arguments: a refund above 100 waits.]{#rule}
::note[The effect: it runs only after approval.]{#effect}
:::
::::

The refund in both tabs is for 250, so the rule fires. In ours the run does not block on a callback. It signs a pending request for the call, and ends with `stopReason: "awaiting_approval"`. The request signs a hash of the call's exact input, so a stored pause whose input changed no longer verifies, and `continueRun()` checks the person's answer against it before the call runs [@buildanagent-sdk-write-pauses]. Cloudflare's turn also ends with the call saved and nothing run.

::::tabs
:::listing[Our SDK]{#paused-ours file="packages/sdk/examples/12-approval-gate.ts" region="paused"}
::note[The run ends `awaiting_approval`. The call has no result yet.]{#ends}
::note[`result.pending` holds a signed request for the waiting call, and `verifyResolution()` accepts it under the run's signer.]{#pending}
::note[The refund has not run.]{#not-run}
:::
:::listing[Cloudflare Agents]{#paused file="verify/cloudflare-agents/examples/06-tool-approval.ts" region="paused"}
::note[The gated call is saved as `approval-requested`.]{#pending}
::note[The refund has not run.]{#not-run}
:::
::::

Per-call approval breaks the saga's rule that nothing after the pivot may block. Suppose the refund is approved and runs, and the email waits for a second approval. A reviewer who then rejects or edits the email leaves the plan past its pivot with a required step waiting on a person. The approval therefore has to come before the first compensable step, as one decision whose hash covers every step's arguments, so that a changed amount or email text no longer matches it: the order change, the refund amount and recipient, and the exact text of the email. That placement is our synthesis, because no vendor source discusses approval relative to a pivot. OpenAI's agent guide names "canceling user orders" and "authorizing large refunds" as actions that "should trigger human oversight" [@openai-practical-guide-to-building-agents], and a plan that holds both gets the oversight once, before it starts.

Our `@buildanagent/agent-safety` puts the approval there, and this chapter has no listing of it, because no other SDK in these tabs has the feature to set it beside. `lintPlan()`{checked=row-56} requires every compensable step before the one pivot and every retryable step after it. `signPlan()`{checked=row-56} signs the hash of every step's input and of the state the plan was computed from, with an expiry. `verifyPlanBeforeStep()`{checked=row-56} checks before each step that it is the signed one, and `runPlan()`{checked=row-56} runs the approved steps, undoes the ones that ran if a step fails before the pivot, and never undoes a step after it [@buildanagent-agent-safety-readme].

Steps before the pivot could run speculatively and be undone if the reviewer rejects the plan, but each would hold a lock that the rest of the application can see, such as the order's refund-pending status, while a person decides. We therefore approve the whole plan up front, a judgement that only an eval with realistic approval delays can test.

## Exercises

1. **Kill the run earlier, and say which outcome the resume reports.** In `verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts`{checked=row-37}, move the `process.kill` line in `chargeTool`{checked=row-37} to just before the `fetch` call. Predict what the server holds for order 42 after the child dies, what the log's state is, and what the resume's tool result says. Then change the file's checks to match your prediction and run `pnpm test` in `verify/vercel-ai-sdk`. Which branch of the tool did the resume take this time?
2. **Move the kill to after the log entry, and show nothing repeats.** Put the `process.kill` line after the last `appendEntry`{checked=row-37} instead. Predict the state of `charge:42` and whether the resume sends a request, run it, and explain why this crash leaves no unknown outcome.
3. **Order a plan on paper.** A support agent can update an order, refund a card, post a public comment on the ticket and email the customer. Name each step compensable, pivot or retryable, put them in an order that never leaves a false statement, and mark where the single approval goes and what its hash covers.
