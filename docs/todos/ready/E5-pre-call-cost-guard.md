# E5: A pre-call USD cap for the AI SDK through model middleware

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E5` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E1](E1-safety-core-outcomes.md), [B5](B5-usage-cost-catalog.md) |
| Size | M |

## Goal

Refuse a model call before it is sent when its projected cost would push a run or session over its USD cap, on agents built with `ai` 7.0.162 and on Cloudflare `agents`, which runs the AI SDK's loop (gap 5). Our own SDK already plans this check in D9 and B14; the AI SDK has `stopWhen` but "no spend cap" ([feature table](../../comparison/feature-table.md)).

## Context

- [build-sdk.md, D9](../../plans/build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost): the projection formula and the overshoot bound.
- [B14](B14-budget-progress.md): the same check in our loop, and its overshoot test, which this todo copies.
- [ADR 0043](../../decisions/0043-standalone-safety-core.md) (proposed): `projectCallCost()` moves to the gateway beside B5's catalog, so the loop and this guard share one formula.
- [Cloudflare reference §8](../../reference/cloudflare-agents/guide.md#8-aichatagent-and-think-both-run-the-vercel-ai-sdk-loop-and-they-differ-in-who-calls-it): both Cloudflare agent classes run the AI SDK loop, so one guard covers both SDKs.
- The AI SDK's `wrapLanguageModel()` and middleware pages in our mirror (`docs/reference/vercel-ai-sdk/source/content/docs/07-reference/01-ai-sdk-core/60-wrap-language-model.mdx` and `docs/03-ai-sdk-core/40-middleware.mdx`): `wrapGenerate` and `wrapStream` wrap the model's `doGenerate` and `doStream`.
- The shipped `ai` 7.0.162 source (`src/generate-text/generate-text.ts` and `stream-text.ts`): each step resolves `prepareStepResult?.model ?? model` and calls its `doGenerate` or `doStream` inside the retry wrapper, so a wrapped model's middleware sees every step and every retry ([fact-check rows 37–38](../../plans/reviews/fact-check-close-sdk-gaps.md)).

## Scope

**In scope**

- `costGuard({ capUsd, spend, catalog })`, a language-model middleware that projects each call and refuses it before `doGenerate` or `doStream` runs, and `guardedProvider()`, which applies it to every model of a provider through `wrapProvider`
- Spend tracking from each call's reported usage, folded with B5's catalog
- A typed refusal that the agent sees as a stop, not as a provider error

**Out of scope** (and which todo covers it)

- Our SDK's loop check (B14)
- Platform quotas across a tenant's tasks (F13)

## Design notes

```ts
interface Spend { get(): Promise<number>; add(usd: number): Promise<void> }  // per run or per session
declare function costGuard(opts: { capUsd: number; spend: Spend; catalog: CostCatalog;
  maxOutputTokens?: number }): LanguageModelMiddleware;
class BudgetExceeded extends Error { readonly projectedUsd: number; readonly spentUsd: number }
```

Before each call, the middleware estimates the input tokens from the `params.prompt` it receives, with B14's rule (the previous call's reported input plus a character estimate of new messages), and prices it with the gateway's token-level `projectCost()` from the [B5 revision](B5-usage-cost-catalog.md). It cannot call `projectCallCost()` itself, because that function takes our gateway's `Model` and `ModelContext`, not an AI SDK prompt. If `spent + projected > capUsd`, it throws `BudgetExceeded` without calling the provider. `ai`'s retry wrapper retries only an `APICallError` or `GatewayError` marked retryable, so the error reaches the caller of `generateText`, or `streamText`'s `onError`, on the first attempt; the caller treats it as a stop. After each call, the guard adds the reported cost; on `doStream` it reads usage from the stream's final `finish` part through a `TransformStream`. The catalog lookup maps `model.provider` and `model.modelId` to a catalog entry, and a model with no catalog price is refused before any call, the same rule as B14's `unknown_price`.

## Tasks

- [ ] Pin in a test that a `wrapLanguageModel` middleware sees every request of a multi-step `generateText` and `streamText` run in 7.0.162, including tool-loop steps and retries (the source read in fact-check rows 37–38).
- [ ] Write `costGuard` and the `Spend` interface with an in-memory implementation.
- [ ] Write the overshoot test from B14 against `MockLanguageModelV4`.
- [ ] Wire the guard into a Cloudflare `agents` test agent in workerd.

## Acceptance criteria

- [ ] A run whose next projected call would cross the cap stops before that call: the mock model records no extra request.
- [ ] The overshoot is at most one call's projection error, measured the way B14 measures it.
- [ ] A model with no price in the catalog is refused before its first request.
- [ ] The same guard stops a Cloudflare `agents` test agent before the crossing call.
- [ ] A `prepareStep` that switches to another model from the same `guardedProvider()` is still capped, and a streamed run's spend matches its `finish` usage.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/cost-guard.test.ts` (mock model) and `test/cloudflare-cost-guard.test.ts` (workerd).

## Docs to update

The package README (setting a cap per run and per session).

## Risks and open questions

- A model that never passes through the guard escapes the cap: an unwrapped model returned by `prepareStep`, or a string model id resolved through the global provider ([plan §6](../../plans/close-sdk-gaps.md#6-risks-and-sequence)). `guardedProvider()` covers the first, and E6's refusal of string ids covers the second.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
