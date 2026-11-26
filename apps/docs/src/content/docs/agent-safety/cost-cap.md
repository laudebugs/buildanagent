---
title: The cost cap
description: How a cost guard refuses a model call that could pass a USD cap before the call is sent, and how to cap one run or a whole session.
---

You will stop an agent loop before the model call that would pass a spending cap in US dollars. You need this when a loop can run many model calls, and one expensive call near the end could cost more than the budget left.

A loop that checks its spend after each response stops only once a response has already crossed the cap. The AI SDK's `stopWhen` counts steps, not dollars. A cost guard checks before the call instead: it projects a high estimate of what the call can cost and refuses to send it if the spend so far plus that projection would pass the cap.

## Build every model from the guarded provider

The guard checks only the calls that pass through it. A model that you build another way, such as with `createAnthropic()`, never reaches the guard, and a string model id such as `"anthropic/claude-haiku-5-5"` escapes it too, because the AI SDK resolves the id through its default provider. The [own-key guard](/agent-safety/own-key/) makes such an id throw.

The guard also caps language models only. `guardedProvider()` passes embedding, image, transcription, speech and reranking models through unguarded, so their calls are never counted. A model that `prepareStep` switches to must come from the same guarded provider.

## Cap a run at 50 cents

This function builds a guard with a cap of 0.5 USD, wraps a provider in it and answers a prompt. When the guard refuses a call, `budgetRefusal()` finds the refusal and the function says why the run stopped:

```ts file="packages/agent-safety/examples/capped-answer.ts" region="answer"
```

`costGuard()` is a language-model middleware. The guard reads the AI SDK's request, and in `ai` 7.0.173 every step of `generateText` and `streamText`, and every retry, passes through it. Because it wraps the model, the same guard also caps a Cloudflare `AIChatAgent` that calls `streamText`. The guard refuses with a `BudgetExceeded`, a `SafetyError` whose `code` is `budget_exceeded` or `unknown_price`.

## Read what the guard projects

The projection prices every input token at the model's dearest input rate and adds the call's output limit at the output rate.

The input side is an estimate, not a bound. The guard counts 2.5 characters to a token as of November 2026, which errs high on Anthropic's tokenizer, and it uses the usage that an earlier call reported where it can. That limit is the call's `maxOutputTokens`, or the catalog's limit for the model when the call sets none. Pass `maxOutputTokens` to `costGuard()` to price such calls at a lower limit. The prices come from the gateway's catalog, the same one the SDK's `budgetUsd` uses, so both caps agree on what a call can cost.

A call that sets no output limit is projected at the model's full limit. In the example's test, a call on Haiku passes a 0.5 USD cap and a call on Sonnet is refused before anything is sent, because Sonnet's full output limit alone costs more than a dollar at catalog prices.

After each call, the guard adds what the response reported to the spend. It prices the usage with the catalog and, for a stream, reads it from the `finish` part. Three cases charge the projection instead:

- A call whose abort signal stopped it while the request was in flight, because the provider may already have generated tokens.
- A stream that is cancelled or breaks before its `finish` part.
- A stream that reports an `error` part and never finishes.

Any other error before a response arrives, such as a dropped connection or a 5xx, is charged nothing, because the guard cannot tell whether the provider billed the call. The guard under-counts when it was billed. Where a lost response may have cost money, add its cost to your `Spend` from the provider's usage report, or keep headroom under the cap.

## Two codes say why a call was refused

The guard refuses with one of two codes, both on `BudgetExceeded`:

- `budget_exceeded`: the spend so far plus the projection would pass the cap. A cap of 0 refuses the first call.
- `unknown_price`: the guard cannot tell what the call or the spend costs, so it refuses and reports a `projectedUsd` of `null`. The catalog may have no price for the model, or the request may hold a file whose size is unknown.

After a response that reported no usage, the guard also refuses every later call with `unknown_price`, because a spend the guard cannot read is never counted as zero. The [Problems and fixes](/agent-safety/problems-and-fixes/) page shows both messages and their fixes.

## Cap each run, or the whole session

The guard keeps the spend in a `Spend`, an object with `get()` and `add(usd)`. Where the `Spend` lives decides what the cap covers. A fresh `memorySpend()` for each run caps that run. A `Spend` that every run of the session reads, such as a row in your database, caps the session. Pass both guards to `guardedProvider()` as a list, and a call goes out only when each of them allows it.

Calls that run at the same time through one guard share its cap, because the guard holds each call's projection against the cap until the call's cost is known. The guard sees only the calls that pass through it. Another process that adds to the same session `Spend` is counted once its `add()` has finished, not while its call is in flight, so a session cap shared by several processes can be passed.

Next, see how the [own-key guard](/agent-safety/own-key/) keeps each call on the user's own key.
