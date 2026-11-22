# L6: Generate the API reference from TSDoc, and fail CI on undocumented exports

| Field | Value |
| --- | --- |
| ID | `L6` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L1](../done/L1-build-dist-packages.md), [L5](../done/L5-docs-app.md) |
| Size | M |

## Goal

Generate the docs' API reference from each package's TSDoc, and turn TypeDoc's `notDocumented` validation into ADR 0008's undocumented-export check ([DS1](../../plans/publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted)).

## Context

- [ADR 0048](../../decisions/0048-docs-on-astro-starlight.md) and [ADR 0008](../../decisions/0008-versioning-and-doc-checks.md)
- Lamina PDF's `apps/docs/astro.config.mjs` (`starlight-typedoc`) and its TypeScript catalog pinned for TypeDoc

## Scope

**In scope**

- `typedoc` 0.28.20, `typedoc-plugin-markdown` 4.14.1 and `starlight-typedoc` 0.23.2 in `apps/docs`, with TypeScript 6.0.3 pinned for TypeDoc alone, because TypeDoc 0.28.20 accepts TypeScript up to 6.0
- Entry points read from each package's `exports`, so the reference matches what users import
- A `check:api-docs` script running TypeDoc with `notDocumented` as an error, wired into CI
- A reference section in the sidebar, generated at build time

**Out of scope** (and which todo covers it)

- B20's second export diff (documented names missing from the `.d.ts`) and `llms.txt`

## Acceptance criteria

- [x] The built docs have a reference page for every export of both packages' entries
- [x] Removing the TSDoc from one exported function fails `check:api-docs`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The removed-TSDoc case, recorded in the pull request description.

## Docs to update

[B20](B20-versioning-docs.md)'s revision, CI plan, the plan's todo table.

## Risks and open questions

If TypeDoc reads a TypeScript 7 construct differently, record the gap and the type it affects.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`apps/docs` now generates an API reference page for every export of the gateway and the SDK, and `pnpm check:api-docs` fails on an exported function, class, interface, type alias, variable or enum without TSDoc.

- **The reference follows each package's `exports`.** `src/api/packages.ts` reads the entry points from the manifest's `source` conditions, and one TypeDoc plugin and sidebar group for each package write the pages under `reference/gateway/` and `reference/sdk/` at build time. The pages are not committed. A test builds the site and requires a page for each of the packages' declarations, 20 or more for each package, with re-exports skipped.
- **CI enforces it through `pnpm test`.** The docs app's tests run the check over both packages and over a fixture with and without TSDoc, so `ci.yml` needs no new step. Removing the TSDoc from `modelRequestsAreAllowed()` made the check exit 1 and name it.
- **The check covers exports, not every member.** With `notDocumented` over everything, TypeDoc warned on 344 properties and methods. Limited to the six kinds of export, it found 16 declarations. This change documents them, with a patch changeset for both packages, because the comments ship in the declaration files. A property or method stays a reader's judgement.
- **TypeScript 6.0.3 is the docs app's own.** TypeDoc 0.28.20 reads TypeScript up to 6.0, so the app's `typescript` devDependency is 6.0.3 while the repo builds with 7.0.2. TypeDoc converted every entry point of both packages without a compiler error, so there is no gap to record.
- **The pins are the plan's.** `starlight-typedoc` 0.23.3 appeared on 2026-11-19, less than a week old, so 0.23.2 stays.
