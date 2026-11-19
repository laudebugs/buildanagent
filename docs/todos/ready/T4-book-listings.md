# T4: Code listings from real file regions, with path, lines and pin

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T4` |
| Status | `ready` |
| Plan | [Book plan §5, BK8 and BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T3](../done/T3-book-content-model.md) |
| Size | M |

## Goal

Let a chapter include code only from a file that CI type-checks and runs. The `::listing` directive cuts a named region from a real file, shows its listing number, path, line range and the pinned SDK version, and fails the build when anything it names is missing. The `book:switch-report` script then tells us which chapters can move to our own packages.

## Context

- [Book plan BK8 and BK9](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted): the owner's decision on code sources and the listing design.
- Each `verify/<sdk>/tsconfig.json` includes `examples/**/*.ts`, and each harness's `test` script runs `tsc -p` before the examples ([`verify/vercel-ai-sdk/package.json`](../../../verify/vercel-ai-sdk/package.json)).
- [ci.yml](../../../.github/workflows/ci.yml) and `scripts/ci/results-drift.mjs`: what CI already runs on every push.

## Scope

**In scope**

- The `::listing{#id file region}` directive, region extraction, marker stripping and Shiki highlighting
- The caption line: listing number, repo path, line range, and the pinned version of the harness's main package
- The check that each listed file sits under a `tsconfig.json` that a workspace package's `typecheck` runs
- `// #region` markers in the `verify/` examples the Part I chapters name
- `book:switch-report`, which reads each chapter's `switchTo` and `docs/todos/done/`

**Out of scope** (and which todo covers it)

- Annotations, tabs and replays ([T5](T5-book-interactive-listings.md))

## Tasks

- [ ] Write the directive with `remark-directive`, reading files relative to the repo root.
- [ ] Map each `verify/<sdk>` harness to its main package (for example `ai` for `vercel-ai-sdk`) in one table in `apps/manual/src/data/harnesses.json`, and read the pin from that harness's `package.json`.
- [ ] Add `// #region` and `// #endregion` comments to the examples §4.1 of the plan names; run that harness's `pnpm test` to confirm the results do not change.
- [ ] Write the tsconfig-coverage check and the missing-file, missing-region and missing-package failures.
- [ ] Write `book:switch-report` and run it in `pnpm test` as a report that never fails.

## Acceptance criteria

- [ ] A fixture chapter's listing shows `Listing N.M`, the path, the line range and the pin read from the harness's `package.json`
- [ ] Renaming a region, deleting a listed file or listing a file outside every checked `tsconfig.json` fails the build
- [ ] `node scripts/ci/results-drift.mjs` passes after the region markers are added
- [ ] `book:switch-report` lists, for each chapter, its `switchTo` todos and which are done
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest tests for the directive on fixture files, one per failure. The region markers are covered by the existing `pnpm test` of each harness.

## Docs to update

- `apps/manual/README.md`: how to add a listing and a region
- The `verify/<sdk>/README.md` of each harness whose examples gain markers, with one line on why they are there

## Risks and open questions

- The weekly SDK-update job rewrites `verify/*/package.json`; the displayed pin follows it, which is correct, but prose that names a version must say "as of".

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
