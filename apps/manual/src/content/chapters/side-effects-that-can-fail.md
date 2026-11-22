---
title: "Side effects that can fail: outcomes, idempotency and plan approvals"
summary: A tool that writes to the world can fail in five different ways, and the model must be told which one happened. This chapter shows how a write reports applied, not_applied, compensated, partial or unknown, why a key saved before the call lets a crash be settled safely, and why a plan of several writes needs one approval before its first step.
opening: incident
sources: [stripe-idempotent-requests, stripe-advanced-error-handling, aws-safe-retries, azure-saga-pattern, stripe-refunds, openai-practical-guide-to-building-agents]
glossary: [idempotency-key, saga]
switchTo: [E1, E2, E3, E4a, E4b]
---

In November 2026 we killed a payment tool in the one gap that matters: after the payment server wrote the charge for order 42 and before the tool wrote down that it had. The server held one charge. The tool's log held the key for that charge and no result. A fresh run of the same tool had to tell the model something, and both easy answers were wrong. "It failed" invites a second charge, and "it worked" is a guess that the log could not back. The truthful answer was a state with its own name, `unknown`, and a rule for what may happen next.

A write to the outside world can end in more than success or failure, and an agent that cannot tell the endings apart will repeat a write or report one that never happened. This chapter follows one charge tool through its endings. It names five outcomes and the retry rule for each, shows why the tool saves its key before it calls the server, replays the killed run until the server has seen exactly one write, and ends on the case where several writes belong to one plan and a single approval has to cover all of them.

## A write reports one of five outcomes, and each carries its own retry rule

A model reads a tool's answer as text and cannot tell a declined payment from a payment that may or may not have gone through unless the answer says so. The wire formats give little help. Anthropic's `tool_result` and MCP's `CallToolResult` carry an error flag, OpenAI's function output is a string whose "format is up to you", and several SDKs pass the raw exception message to the model. The outcome therefore has to live in the body of the result, in words the model reads and in a field the harness can act on.

Our harness's plan names five outcomes. `applied` means the write took effect. `not_applied` means it was rejected before any effect, for a reason such as validation or policy. `compensated` means it took effect and was then undone, so the world matches its state before the call. `partial` means some steps took effect and the undo failed or was skipped. `unknown` means a timeout or a lost response left nobody able to tell. The kinds are our proposal from distributed-API practice, not a vendor vocabulary. [[fig:outcomes]] puts each next to the rule that says what may happen next.

:::figure[The five outcomes of a write, and the rule for what may happen next: only unknown is settled by asking the other side]{#outcomes}
::svg{alt="Two columns of five rows joined by arrows. The left column lists applied, not_applied, compensated, partial and unknown. The right column gives the matching rule. Applied: done, a repeat reads the saved result. Not_applied: retry after a fix, with the same key. Compensated: a new operation, only if still wanted. Partial: resume with the same key, or ask a person. Unknown, drawn in the accent: ask the other side, never a fresh key."}
:::

The row that matters most is the last. A write that timed out is neither a success nor a failure, and the safe move is to resolve it before doing anything else. Stripe says to treat a 500 as indeterminate: "Don't retry with a new idempotency key until you've resolved the original outcome" [@stripe-advanced-error-handling]. Amazon's engineers call the same step reconciliation, and fix it with a token the caller supplies and the server echoes back [@aws-safe-retries]. A fresh key would be a new request, so the server would treat the retry as a second payment.

The model must also be told what it may not claim. After `not_applied`, it must not say the change happened. After `compensated`, it must not hide an effect that cannot be undone, such as an email already sent. After `partial` it must not present the result as success, and after `unknown` it must not retry with a fresh key. These are our rules, and no published study measures how models react to "rolled back" versus "failed" wording, so an eval has to test them.

## The tool saves its key before it calls the server, so a crash leaves a trace

A shop that sends orders by courier writes each order in :analogy[a ledger before the courier leaves]{#ledger-before-courier}. If the courier never returns, the ledger still says the order went out, and the shop can phone the customer instead of guessing. The second line, the result, is written only when the courier is back. A charge tool should keep the same ledger. It writes the intent first, makes the call, and writes the outcome second. The first entry records intent, never success, and an intent with no result after it is the unknown outcome, as [[fig:ledger]] shows.

:::figure[A ledger written before the courier leaves: the intent comes first, the result second, and a missing second line means nobody knows]{#ledger analogy="ledger-before-courier"}
::svg{alt="Two columns. On the left, a ledger with two lines: line 1, intent, send order 42, and line 2, result, delivered, drawn in the accent. On the right, a courier who leaves with order 42 and comes back delivered, with arrows to and from the ledger. A note says line 1 is written before the courier leaves and line 2 after the courier is back. A line below says a line 1 with no line 2 means: ask the customer."}
:::

The key is what lets the shop and the server find the same order again. Think of :analogy[a raffle ticket stub]{#raffle-ticket-stub}: one stub, one prize, however often the holder shows it. An idempotency key works the same way. The caller sends the same key with every attempt at one write, and the server applies the write once and answers a repeat with the first result. Stripe saves the status and body of the first request that used a key and replays them on retries, even for a 500 error [@stripe-idempotent-requests]. A stub is printed before anyone wins and the holder keeps it. The key must likewise exist before the call is made, or a crash loses it and the write can repeat.

[[lst:write-tool]] is the charge tool from our example. It builds the key from the order, checks its log, writes the intent and only then calls the server.

:::listing[The charge tool saves its key first, asks before it repeats, and logs the outcome last]{#write-tool file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="write-tool" replay}
::note[The key comes from the business fact, one charge for one order, not from a random id. Every attempt at this write carries the same key.]{#key}
::note[A log entry that says a previous attempt started and never finished sends the tool to the server's records, before it writes again.]{#reconcile}
::note[The intent is saved before the request leaves. This is the ledger's first line.]{#persist}
::note[The example kills its own process here, after the server's reply and before the outcome is logged.]{#crash}
:::

Three choices in the listing carry the chapter's argument. The key is the business fact, so a second run that asks for the same charge finds the first run's entry. A write the log has already settled is answered from the log, whether it applied or was declined, and no request goes out. Only a definite decline, a 402 from this server, becomes `not_applied`; any other failure stays `unknown`, because a 500 or a dropped connection says nothing about whether the write landed.

Agent vendors point at the tool call id as the natural key, and the advice to persist it is consistent. The OpenAI Agents SDK says that a tool with side effects should be made "idempotent by call ID so an interrupted continuation cannot repeat the effect". Cloudflare's agents documentation tells developers to "Persist idempotency keys or completion records before external side effects". Neither page says how long a call id is unique or what it is unique within. A backend should therefore scope any key by tenant and session, and a key built from the business fact, as the example does, survives a resume that regenerates the model's call and so issues a fresh id for the same charge.

## A crash between the write and the result leaves unknown, and only the other side can settle it

Suppose you phone a restaurant to place an order and :analogy[the line goes dead mid-order]{#dropped-phone-order}. You cannot tell whether the kitchen heard you. Ordering again may feed you twice, and not ordering may leave you hungry. The sensible move is to phone back and ask whether the order is in. The agent's charge tool faces the same silence after a crash, and it needs the same move: ask the server before writing again. A restaurant has no order number to look up, though. That is why the write carried a key that the other side can be asked about.

The tool reads its state from a small log of entries. The state of one operation is the outcome in its last entry, and a last entry that only says the write started means `unknown`.

:::listing[The state of an operation is read from its last log entry]{#effect-log file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="effect-log"}
:::

The example then crashes the tool on purpose. A child process runs the charge tool for order 42 and kills itself with `SIGKILL` after the server has answered and before the tool logs the outcome. The kill leaves exactly the state in the opening: the server has written once, and the log holds the key and no outcome.

:::listing[A child process is killed between the server's reply and the log entry]{#crash file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="crash"}
::note[The log has the key and no outcome, so the state is unknown.]{#unknown}
:::

A fresh run of the same tool now reads the log, sees `unknown` and asks the server for the key, and the server says it has the write. The tool records `applied` and tells the model so, and it sends nothing.

:::listing[The resume asks the server instead of writing again]{#resume file="verify/vercel-ai-sdk/examples/15-write-crash-idempotency.ts" region="resume"}
::note[The server received exactly one write request for order 42, though the tool ran twice.]{#once}
:::

The tool's other branches follow from the same rule. A 404 from the lookup proves the write never reached the server, and only then may the tool send it, under the same key. Any other answer leaves the outcome `unknown` and the model is told so. The model never sees a fresh key.

Two limits belong with the example. The log is a small file that survives a killed process and not a power cut, because nothing is synced to disk before the call, so a real deployment replaces it with a store that makes the entry durable first. And the lookup works because the example's server can answer "have you seen this key?". A server that offers neither a lookup nor a replay for a reused key leaves the outcome `unknown` for a person to settle.
