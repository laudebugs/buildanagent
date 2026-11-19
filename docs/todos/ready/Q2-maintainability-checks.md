# Q2: Check unused code, package boundaries, duplication and todo ids in CI

| Field | Value |
| --- | --- |
| ID | `Q2` |
| Status | `ready` |
| Plan | [Guidelines, Known gaps](../../guidelines/README.md#known-gaps) |
| Round / milestone | Q (code quality, added 2026-11-19) |
| Depends on | [Q1](../ongoing/Q1-strict-compiler-and-lint.md) |
| Size | S |

## Goal

Make CI enforce the [maintainability guideline](../../guidelines/maintainability.md)'s checkable rules, as Lamina PDF's `check:deps`, `check:duplicates` and `check:unused` scripts do.

## Context

- [maintainability.md](../../guidelines/maintainability.md): one home per concept, one public path, comments without todo ids
- Lamina PDF's `.dependency-cruiser.json`, `.jscpd.json` and `knip.config.ts`

## Scope

**In scope**

- `dependency-cruiser`: fail on an import cycle or a relative import from one package into another, across `packages/`
- `jscpd`: fail on a block of 10 lines or more repeated in any package's `src/`
- `knip`: fail on an unused file, export or dependency in `packages/`, reading each package's entries from its `exports`
- A check that fails on a todo id (`B4`, `E2a`) in `packages/*/src`, comments included
- Root scripts `check:deps`, `check:duplicates`, `check:unused` and `check:ids`, run by `ci.yml`
- Each tool pinned exactly to a release at least a week old

**Out of scope** (and which todo covers it)

- The compiler and Biome rules (Q1)

## Acceptance criteria

- [ ] Each check fails on a seeded violation (a cycle, a copied block, an unused export, a `B4` comment) and passes on `main`'s code
- [ ] `ci.yml` runs all four, and the PR's CI shows them
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Tests

The seeded-violation runs, recorded in the pull request description; the checks themselves run in CI.

## Docs to update

[maintainability.md](../../guidelines/maintainability.md) (a "How it's checked" section), AGENTS.md coding standards and `ci.yml`'s description in AGENTS.md's layout.

## Risks and open questions

knip may report the `testing` exports as unused until their first consumer lands; list them as entries, not ignores.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
