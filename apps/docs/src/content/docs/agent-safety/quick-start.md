---
title: Agent safety quick start
description: Build a refund tool that tells the model what happened and cannot refund one order twice, even when a turn is regenerated.
---

You will build a refund tool that tells the model exactly what happened and cannot refund the same order twice. You need this when a tool changes something outside your agent, such as paying out money, and a crash or a regenerated model turn could repeat the change.

A write is a tool call that changes the world. Agent safety wraps each write in a record that exists before the write runs, and it reports every result as an outcome: a typed answer that says what happened and what the model may do next.

## Install the package

The package needs Node 22 or later. Install it with the `alpha` tag, which npm serves for every release until the first stable one:

```bash
pnpm add @buildanagent/agent-safety@alpha
```

The root entry imports no other package, so this example needs nothing else. The other pages use subpaths that need the AI SDK, and each says which packages to add.

## Write the refund tool

The tool below refunds an order through a payment API. The API dedupes by an idempotency key, a string that tells it to ignore a second request with the same key. The tool's business key names the real-world operation, here `refund:` plus the order id. `guardedWrite()` hashes the tenant and the business key into one effect key. Every attempt to refund that order for that tenant sends the same key:

```ts file="packages/agent-safety/examples/quick-start.ts" region="tool"
```

The example keeps its records in `memoryEffectStore()`, which lives and dies with the process. A restarted process forgets every record, including the knowledge that an earlier attempt was rejected or left unknown. The same key still reaches the payment API, which ignores a repeat only inside its idempotency window, the time it remembers a key. An API with no idempotency keys would refund twice.

Where a crash must not repeat a write, pass a durable store and keep its records longer than that window. The [package README](https://github.com/laudebugs/buildanagent/blob/main/packages/agent-safety/README.md) lists the stores for Durable Object SQLite, DynamoDB and Postgres.

The `scope` says who asked: the tenant (one user), the session, the branch of the conversation and the model's tool call id. `guardedWrite()` writes a record before it calls `run`, and settles the record with the outcome after. The outcome is what `renderOutcome()` turns into the tool's result.

## Run it

This function asks for the same refund twice, as a regenerated turn does, and returns the text the model reads each time. Pass it your payment API, or a stub with a `refund()` method:

```ts file="packages/agent-safety/examples/quick-start.ts" region="run"
```

## See what the model reads

For a refund that works, the model reads this text, and the tool result also carries the outcome's fields as a payload and `isError: false`, the flag that tells the provider whether the call failed:

> The refund_create call took effect. Next: Tell the user refund re_1 is issued. Do not run it again for the same request.

A regenerated turn asks for the same refund under a fresh tool call id. The business key maps both calls to one effect key, so `guardedWrite()` finds the first record, sends nothing and returns the first outcome. The payment API sees one request. A business key names one operation for good, so a second legitimate refund of the same order needs a new business key.

## See a declined refund

The payment API throws `RefundDeclined` when the card issuer says no. The tool's `onError` turns that into a `not_applied` outcome, one whose write changed nothing, and the model reads this text with `isError: true`:

> The refund_create call did not take effect, and nothing changed. Next: Ask the requester for another payment method. Retrying this same call is safe; it takes effect at most once. Do not say that it happened.

Any other error from `run` reaches `onError`, which rethrows it, so the tool throws too. The record still settles as `unknown`, the outcome for a write whose result nobody knows. A later call for the same order then sends nothing and returns that `unknown` outcome, because the first attempt may have refunded the order.

Next, learn what [the five outcomes mean](/agent-safety/outcomes/) and how to build your own.
