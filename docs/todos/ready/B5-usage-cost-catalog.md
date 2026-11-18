# B5: Usage, the cost catalog and fold, and the caching policy

| Field | Value |
| --- | --- |
| ID | `B5` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-foundations) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B4](B4-gateway-runtime.md) |
| Size | M |

## Goal

Put usage and cost on every assistant message, including failed attempts, so the loop's budget (B14) and the harness's usage entries have numbers to work with.

## Context

- [D3](../../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name) and [D4](../../plans/build-sdk.md#d4-prices-come-from-a-versioned-catalog-and-a-provider-billed-total-overrides-it)
- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): usage and cost on every message, one caching policy

## Scope

**In scope**

- `catalog.json` with per-model tiered rates by token class, `asOf` and a source URL
- `Model.price(usage)` and the fold onto every message, with `basis` `provider`, `catalog` or `unknown`
- Pricing of failed attempts
- A test that warns when an entry's `asOf` is older than 90 days
- The portable `cacheRetention` option, passed to adapters

**Out of scope** (and which todo covers it)

- Per-adapter cache breakpoints (B8, B9)
- The pre-emptive budget check (B14)

## Tasks

- [ ] Define the catalog schema and validate `catalog.json` against it in a test.
- [ ] Add entries for the models B8 and B9 will test, with prices copied from each provider's pricing page and the page URL and date recorded.
- [ ] Fold cost onto each `AssistantMessage`; accumulate failed attempts into the call's cost.
- [ ] Return `{ total: null, basis: "unknown" }` for a model missing from the catalog.
- [ ] Prefer a provider-billed total when the adapter reports one.

## Acceptance criteria

- [ ] Cost for a scripted message equals the sum of each token class times its catalog rate, in a test with fixed numbers
- [ ] A model missing from the catalog yields `total: null` and `basis: "unknown"`
- [ ] Two failed attempts and one success yield a cost that includes all three
- [ ] The staleness test warns on an entry dated more than 90 days before the test clock
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/cost.test.ts`, `catalog.test.ts`.

## Docs to update

`packages/gateway/README.md`: how to refresh the catalog and pass a custom one. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Prices change often; the catalog states its `asOf` date, and the owner may later want a different refresh cadence.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
