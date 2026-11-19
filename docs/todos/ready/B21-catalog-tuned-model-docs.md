# B21: Document how a tuned model gets a price: a catalog entry in a catalog that lists every model

| Field | Value |
| --- | --- |
| ID | `B21` |
| Status | `ready` |
| Plan | [Build SDK §4.5](../../plans/build-sdk.md#45-two-catalog-todos-from-the-fine-tuning-research-added-2026-11-19) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B5](../done/B5-usage-cost-catalog.md) |
| Size | S |

## Goal

Say in the gateway's catalog docs what a caller must do to price a fine-tuned model. A tuned model is a new model id with its own rates: OpenAI charges twice the base rate for a tuned GPT-4.1 mini, for example. The shipped catalog lists none, so the gateway gives a tuned model an unknown price, which is correct. A caller who wants a price must pass a catalog with an entry for the tuned model, and because a passed catalog replaces the shipped one, that catalog must also list every other model the caller uses. A caller who passes only the tuned entry loses the shipped prices of every other model. U21's research found the trap ([U21 report, TypeScript](../../research/fine-tuning/fine-tuning-vs-prompting.md#in-typescript-a-tuned-model-is-just-a-new-model-id-and-our-gateway-prices-it-only-from-a-catalog-entry)), and the owner approved this change, U21's change 4, on 2026-11-19.

## Context

- [U21 report, TypeScript](../../research/fine-tuning/fine-tuning-vs-prompting.md#in-typescript-a-tuned-model-is-just-a-new-model-id-and-our-gateway-prices-it-only-from-a-catalog-entry): how `createModel()` treats a model the catalog lacks, and the tuned rates
- [`packages/gateway/src/catalog.ts`](../../../packages/gateway/src/catalog.ts): the module doc comment, `CatalogEntry`, `defaultCatalog` and `findCatalogEntry()`
- [`packages/gateway/README.md`](../../../packages/gateway/README.md#every-message-carries-its-cost-priced-from-a-catalog-you-can-replace): it already tells a caller to spread `defaultCatalog.models` into a passed catalog, but it names no tuned model
- [ADR 0004](../../decisions/0004-cost-catalog-and-basis.md): the catalog, the `asOf` date and the unknown basis, which this todo documents and does not change
- [Docs writing guideline](../../guidelines/docs-writing.md) and the [comment rule](../../../AGENTS.md#coding-standards): exported TSDoc names no todo or decision id

## Scope

**In scope**

- TSDoc on `catalog.ts`'s module comment and on `CatalogEntry` or `defaultCatalog`: a fine-tuned model needs its own entry with its tuned rates, `asOf` and source page, and a passed catalog must list every model the caller uses
- A short paragraph and code sample in the gateway README's catalog section, built on the existing `defaultCatalog` spread
- An empty changeset (`pnpm changeset --empty`), because the change alters no behaviour

**Out of scope** (and which todo covers it)

- A retirement date on `CatalogEntry`: [B22](B22-catalog-retirement-date.md)
- Adding tuned models to the shipped catalog: they belong to one caller's account, so no shipped entry fits them

## Tasks

- [ ] Draft the TSDoc and the README paragraph with `/anthropic-skills:writing`.
- [ ] Use a tuned model id in the sample written the way OpenAI writes one (`ft:<base>:<org>::<suffix>`), and give it an `asOf` date and source page.
- [ ] Add a test that a catalog spread from `defaultCatalog` with a tuned entry prices both the tuned model and a shipped model, and that a catalog holding only the tuned entry leaves the shipped model's price unknown.
- [ ] Fact-check every claim in the new copy against the gateway's code and the provider's pricing page, into U21's fact-check log, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [ ] `catalog.ts` and the README both say that a tuned model needs an entry and that a passed catalog replaces the shipped one
- [ ] The README's sample type-checks, and the new test passes
- [ ] An empty changeset is in the pull request, and CI's `changesets` job passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The new test in `packages/gateway/test/`, and the root `pnpm test`.

## Docs to update

- `packages/gateway/README.md`
- The SDK plan's §4.5 row

## Risks and open questions

- The provider's tuned rates change. The sample should mark its numbers as an example dated to the day they were copied, not as a price to rely on.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
