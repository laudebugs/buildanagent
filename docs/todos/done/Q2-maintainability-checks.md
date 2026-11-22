# Q2: Check unused code, package boundaries, duplication and todo ids in CI

| Field | Value |
| --- | --- |
| ID | `Q2` |
| Status | `done` |
| Plan | [Guidelines, Known gaps](../../guidelines/README.md#known-gaps) |
| Round / milestone | Q (code quality, added 2026-11-19) |
| Depends on | [Q1](../done/Q1-strict-compiler-and-lint.md) |
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

- [x] Each check fails on a seeded violation (a cycle, a copied block, an unused export, a `B4` comment) and passes on `main`'s code
- [x] `ci.yml` runs all four, and the PR's CI shows them. The owner pushed the four steps, because the session that built Q2 had no `workflow` scope
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Tests

The seeded-violation runs, recorded in the pull request description; the checks themselves run in CI.

## Docs to update

[maintainability.md](../../guidelines/maintainability.md) (a "How it's checked" section), AGENTS.md coding standards and `ci.yml`'s description in AGENTS.md's layout.

## Risks and open questions

knip may report the `testing` exports as unused until their first consumer lands; list them as entries, not ignores.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Four root scripts now check for an import cycle, a relative import between packages, a repeated block, an unused file, export or dependency, and a todo id in a comment, and all four pass on `main`. CI runs them in the `checks` job, through four steps that the owner added. The scripts are `check:deps` (dependency-cruiser), `check:duplicates` (jscpd), `check:unused` (knip) and `check:ids` (`scripts/ci/todo-ids.mjs`). [maintainability.md](../../guidelines/maintainability.md#how-its-checked) says what each fails on, and the tool claims are rows Q2-1 to Q2-6 of [the fact-check log](../../plans/reviews/fact-check-maintainability-checks.md).

What the build found:

- **dependency-cruiser needs `@swc/core` on TypeScript 7.** It supports TypeScript up to 6, and without a parser it passed after reading 11 modules. With `parser: "swc"` it reads all 298, and the script's output shows the count.
- **The cross-package rule must match the dependency type `local`.** An import by package name resolves into the other package's `src/` through the `source` condition, so matching on the resolved path alone flagged 79 legitimate imports.
- **`main` held three real clones, which the build removed.** The Anthropic and OpenAI adapters each had a copy of `failureFromResponse()` and of `toolNames()`; both now live in `wire.ts`. The two import lists that remained are skipped by an `ignorePattern`, because two files that need the same names must list them. The gateway change needs only an empty changeset, since no behaviour moved.
- **knip passes with `ignoreExportsUsedInFile`.** Without it, it listed 21 exports and types that only their own files use. Those stay a reviewer's call; an export that nothing uses fails.
- **knip's config names what it cannot see.** It lists the Workers that the Cloudflare tests bundle by path, the SDK's globals file that its README checks load by path, and the scaffold packages' declared dependencies on packages they will import. The `testing` exports needed no entry, because each package's tests use them.
- **The owner added `ci.yml`'s four steps.** GitHub refused every change to the workflow file from the build's session, by `git push` and by the API, because its token lacks the `workflow` scope, so the owner pushed them. Once they ran on the merged tree, `check:unused` failed on code that had landed on `main` since the build: the SDK's examples and the protocol's schema-check file are run by path, so knip now lists them as entry points, and two scaffold ignores that the harness and protocol had outgrown are gone.
- **The id check reads comments only, against the real todo ids.** It takes the ids from the file names in `docs/todos/`, so `T00:00:00Z` and `D3` never count, and it skips strings and regular expressions. A Node test seeds its violations; the other three were seeded by hand, and the pull request description records the runs.
