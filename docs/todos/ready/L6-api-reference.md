# L6: Generate the API reference from TSDoc, and fail CI on undocumented exports

| Field | Value |
| --- | --- |
| ID | `L6` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L1](L1-build-dist-packages.md), [L5](L5-docs-app.md) |
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

- [ ] The built docs have a reference page for every export of both packages' entries
- [ ] Removing the TSDoc from one exported function fails `check:api-docs`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The removed-TSDoc case, recorded in the pull request description.

## Docs to update

[B20](B20-versioning-docs.md)'s revision, CI plan, the plan's todo table.

## Risks and open questions

If TypeDoc reads a TypeScript 7 construct differently, record the gap and the type it affects.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
