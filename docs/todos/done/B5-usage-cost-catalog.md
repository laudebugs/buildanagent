# B5: Usage, the cost catalog and fold, and the caching policy

| Field | Value |
| --- | --- |
| ID | `B5` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-builds-the-gateway-types-and-the-scripted-model-that-every-later-todo-tests-against) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B4](../done/B4-gateway-runtime.md) |
| Size | M |

## Goal

Put usage and cost on every assistant message, including failed attempts, so the loop's budget (B14) and the harness's usage entries have numbers to work with.

## Context

- [D3](../../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name) and [D4](../../plans/build-sdk.md#d4-prices-come-from-a-versioned-catalog-and-a-provider-billed-total-overrides-it)
- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): usage and cost on every message, one caching policy

## Scope

**In scope**

- `catalog.json` with per-model tiered rates by token class, `contextWindow`, `maxOutputTokens`, `asOf` and a source URL
- `Model.price(usage)` and the fold onto every message, with `basis` `provider`, `catalog` or `unknown`
- Pricing of failed attempts
- A test that warns when an entry's `asOf` is older than 90 days
- The portable `cacheRetention` option, passed to adapters
- `projectCost({ inputTokens, maxOutputTokens }, entry)` over one catalog entry, and `projectCallCost(model, context, options)`, which estimates the input and then calls it (ADR 0043: moved here from B14, so B14's loop check and E5's AI SDK guard share one formula)

**Out of scope** (and which todo covers it)

- Per-adapter cache breakpoints (B8, B9)
- The pre-emptive budget check that calls `projectCallCost()` (B14)

## Tasks

- [x] Define the catalog schema and validate `catalog.json` against it in a test.
- [x] Add entries for the models B8 and B9 will test, with prices copied from each provider's pricing page and the page URL and date recorded.
- [x] Fold cost onto each `AssistantMessage`; accumulate failed attempts into the call's cost.
- [x] Return `{ total: null, basis: "unknown" }` for a model missing from the catalog.
- [x] Prefer a provider-billed total when the adapter reports one.
- [x] Export `projectCost()` and `projectCallCost()` from `cost.ts`. E5 sees an AI SDK prompt, not a `ModelContext`, so it calls `projectCost()` directly.

## Acceptance criteria

- [x] Cost for a scripted message equals the sum of each token class times its catalog rate, in a test with fixed numbers
- [x] A model missing from the catalog yields `total: null` and `basis: "unknown"`
- [x] Two failed attempts and one success yield a cost that includes all three
- [x] The staleness test warns on an entry dated more than 90 days before the test clock
- [x] Every catalog entry carries `contextWindow` and `maxOutputTokens`, each with its source URL (a schema test)
- [x] `projectCallCost()` and `projectCost()` agree on one scripted context
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/cost.test.ts`, `catalog.test.ts`.

## Docs to update

`packages/gateway/README.md`: how to refresh the catalog and pass a custom one. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Prices change often; the catalog states its `asOf` date, and the owner may later want a different refresh cadence.

## Outcome

- `src/catalog.ts` defines the catalog schema, and `parseCatalog()` checks it. `src/catalog.json` lists `claude-sonnet-5-5` and `claude-haiku-5-5` (with its two prompt-length tiers) from Anthropic's pricing and models pages, and `gpt-5.4-mini` from OpenAI's pricing and model pages, all as of 2026-11-19.
- `src/cost.ts` holds `priceUsage()`, `projectCost()`, `estimateInputTokens()` and `projectCallCost()`; `Model.price()` prices with the model's entry, and `createModel()` defaults to the shipped catalog.
- The retry loop prices each attempt before summing, so failed attempts count and each pays its own tier.
- For B9: OpenAI's newer models bill 30-minute and 12-hour cache writes, while `Usage.cacheWrite` has `5m` and `1h` keys. `gpt-5.4-mini` has no cache-write charge, so the shipped entry avoids the mismatch; B9 decides the mapping for models that do charge.

## History

The SDK-gaps revision of 2026-11-18 moved the cost projection here, for gap 5 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) under the accepted [ADR 0043](../../decisions/0043-standalone-safety-core.md); plan review 2 (2026-11-19) folded it into the sections above.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
