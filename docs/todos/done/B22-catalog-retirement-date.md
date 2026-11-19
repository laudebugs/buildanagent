# B22: An optional retirement date on catalog entries, with a CI warning 90 days before it

| Field | Value |
| --- | --- |
| ID | `B22` |
| Status | `done` |
| Plan | [Build SDK §4.5](../../plans/build-sdk.md#45-two-catalog-todos-from-the-fine-tuning-research-added-2026-11-19) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B5](../done/B5-usage-cost-catalog.md), [B21](../done/B21-catalog-tuned-model-docs.md) |
| Size | S |

## Goal

Give `CatalogEntry` an optional retirement date, and make `scripts/ci/catalog-staleness.mjs` warn when a shipped entry's date is 90 days away or less. Base models retire on dates their providers publish, and a tuned model retires with its base. U21's research found that a tuned model's life runs 16 to 30 months from its base model's release, so a caller who prices a model needs warning before it stops answering ([U21 report, Cost](../../research/fine-tuning/fine-tuning-vs-prompting.md#training-is-cheap-so-the-price-per-token-the-data-and-the-base-models-lifespan-decide-what-tuning-costs)). The catalog already records each entry's sources and `asOf` date, so the date belongs beside them. The owner approved this change, U21's change 5, on 2026-11-19.

## Context

- [U21 report, proposed changes](../../research/fine-tuning/fine-tuning-vs-prompting.md#six-proposed-changes-await-the-owners-decision), change 5
- [`packages/gateway/src/catalog.ts`](../../../packages/gateway/src/catalog.ts): `CatalogEntry`, `parseCatalog()` and `staleCatalogEntries()`
- [`scripts/ci/catalog-staleness.mjs`](../../../scripts/ci/catalog-staleness.mjs) and its test: the 90-day `asOf` warning, which CI prints as `::warning::` annotations
- [ADR 0004](../../decisions/0004-cost-catalog-and-basis.md): its consequence "A test warns when a catalog entry is older than 90 days". The new field is optional and additive, so the ADR's decision holds as written
- [CI plan](../../plans/ci.md) and [AGENTS.md, layout](../../../AGENTS.md#layout): where the staleness warning is described

## Scope

**In scope**

- An optional `retires?: string` field (`YYYY-MM-DD`) on `CatalogEntry`, checked by `parseCatalog()` like `asOf`, with TSDoc that says where the date comes from
- A warning in `catalog-staleness.mjs` for each shipped entry whose retirement date is 90 days or less away, or past, with its test
- A retirement date on any shipped entry whose provider publishes one, with the source page recorded
- A `minor` or `patch` changeset, as the 0.x rule in [`.changeset/README.md`](../../../.changeset/README.md) decides for a new optional field

**Out of scope** (and which todo covers it)

- Refusing to call a retired model: the provider's own error already does that, and a refusal would need its own decision
- The tuned-model docs: [B21](../done/B21-catalog-tuned-model-docs.md)

## Tasks

- [x] Use one name for the field in the type, the parser, the JSON and the script: `retires`, unless the code review picks a clearer one.
- [x] Extend `parseCatalog()` and its tests: a valid date parses, a malformed one throws `invalid_catalog`, and a missing one stays absent.
- [x] Extend `staleWarnings()`, or add a sibling function, and its test with a fixed `now`, so the warning fires at 90 days and not at 91.
- [x] Add each published retirement date to `catalog.json`, with the page it came from. (None qualified: see the Outcome.)
- [x] Update the gateway README's catalog section, AGENTS.md's description of the CI warning, and the CI plan.
- [x] Draft the TSDoc and the doc changes with `/anthropic-skills:writing`, fact-check each date against its provider page, then review the copy with `/anthropic-skills:writing-review` and fix every finding.

## Acceptance criteria

- [x] `CatalogEntry` has the optional field, and `parseCatalog()` checks it
- [x] `node --test scripts/ci/*.test.mjs` passes with the new cases
- [x] A changeset is in the pull request, and CI's `changesets` job passes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/`, `node --test scripts/ci/*.test.mjs`, and the root `pnpm test`.

## Docs to update

- `packages/gateway/README.md`, AGENTS.md (the CI workflow description), the [CI plan](../../plans/ci.md) and the SDK plan's §4.5 row

## Risks and open questions

- Providers move retirement dates. A date in the shipped catalog is a copy with an `asOf`, like a price, and the warning says to refresh it, not that the model has gone.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `CatalogEntry` has an optional `retires` (`YYYY-MM-DD`), which `parseCatalog()` checks like `asOf`. The TSDoc says to copy it from the provider's deprecations page, to leave it out when no date is published, and to give a tuned model its base model's date.
- `scripts/ci/catalog-staleness.mjs` has `retirementWarnings(catalog, now, withinDays = 90)`, which warns for a date 90 days or fewer after `now`'s UTC day, or past, and `check` prints it beside the `asOf` warning. Its tests fix `now`, cover the 90 and 91 day boundary at three hours of the day, and cover a past date and an undated entry.
- No shipped entry gets a date. Anthropic's deprecations page lists `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5` as Active with a "Not sooner than" floor (September 22, September 28 and October 7, 2027), which is not a published retirement date. OpenAI's page lists no shutdown date for `gpt-5.4-mini`; its only line for the model ends EU data residency with `fast` or `priority` service on Jan 11, 2027. Rows B22-1 to B22-5 in [the U21 fact-check log](../../research/fine-tuning/fact-check-fine-tuning-vs-prompting.md#b22-retirement-date-checked-2026-11-19) record this, three of them ⚠️.
- The gateway README, AGENTS.md and the CI plan describe the field and the warning, and a minor changeset covers the addition.
- The two code-review rounds and the writing review remain for the pull request.
