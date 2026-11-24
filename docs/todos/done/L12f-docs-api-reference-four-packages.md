# L12f: Generate the API reference for protocol, harness, CLI and agent-safety

| Field | Value |
| --- | --- |
| ID | `L12f` |
| Status | `done` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](../ongoing/L12-docs-redesign.md) (L12c, merged) |
| Size | S to M |

## Goal

Add `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety` to the docs site's generated API reference, so every published package has its own sidebar topic and export pages at `docs.buildanagent.fyi`. Measure the built site's page count, largest page, mean page, total `dist/` size, Pagefind index and build time with all six packages in place, and verify that every built HTML page stays inside the 200 KiB budget.

## Context

- [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) and the [L12 umbrella todo](../ongoing/L12-docs-redesign.md): L12c split the sidebar into one topic per package's generated reference so the four additional packages stay inside the page budget.
- [`apps/docs/src/api/packages.ts`](../../../apps/docs/src/api/packages.ts): `API_PACKAGES` lists the packages TypeDoc generates pages for; `CHECKED_PACKAGES` already checks all six packages' TSDoc.
- [`apps/docs/src/api/check.ts`](../../../apps/docs/src/api/check.ts), [`apps/docs/test/api-docs.test.ts`](../../../apps/docs/test/api-docs.test.ts) and [`apps/docs/test/topics.test.ts`](../../../apps/docs/test/topics.test.ts): export listing and topic checks, which must handle both multi-entry packages and single-entry packages (`protocol` and `cli`).
- [`apps/docs/src/content/docs/reference/packages.md`](../../../apps/docs/src/content/docs/reference/packages.md) and [`apps/docs/README.md`](../../../apps/docs/README.md): document the generated reference packages and their output folders.

## Scope

**In scope**

- Add `@buildanagent/protocol`, `@buildanagent/harness`, `@buildanagent/cli` and `@buildanagent/agent-safety` to `API_PACKAGES` in `apps/docs/src/api/packages.ts`, and simplify `CHECKED_PACKAGES` to match.
- Ignore the four new generated folders under `apps/docs/src/content/docs/reference/` in `apps/docs/.gitignore`.
- Handle single-entry packages cleanly in `listExports()` and the API/topic tests.
- Measure page count, largest page, mean page, `dist/` size, Pagefind index and build time with all six packages, and record the numbers in the L12 umbrella todo and fact-check log.
- Update `apps/docs/src/content/docs/reference/packages.md`, `apps/docs/README.md` and `docs/todos/ongoing/L12-docs-redesign.md`.

**Out of scope** (and which todo covers it)

- Written guide and concept pages for protocol, CLI, harness and agent-safety (L12g, L12h, L12i, L12j).
- Updating the home page's package cards to point at written quick starts (L12g to L12j).
- Any `.github/workflows/` edit.

## Tasks

- [x] Add the four packages to `API_PACKAGES` and `apps/docs/.gitignore`.
- [x] Update `listExports()` and the built-site tests so single-entry and multi-entry packages are checked accurately.
- [x] Build `apps/docs` and measure page count, largest page, mean page, `dist/` size, Pagefind index and build time; confirm every page stays under the 200 KiB budget (or adjust/document if a single package exceeds it).
- [x] Update `apps/docs/src/content/docs/reference/packages.md`, `apps/docs/README.md` and the L12 umbrella todo with the new packages and measurements.
- [x] Log fact-check rows (`L12f-1`, …) in `docs/plans/reviews/fact-check-publish-and-docs.md` and run `pnpm fact-check-logs --write`.
- [x] Run `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm check:api-docs` and `pnpm --filter @buildanagent/docs build`.

## Acceptance criteria

- [x] `API_PACKAGES` includes all six published packages (`gateway`, `sdk`, `agent-safety`, `protocol`, `harness`, `cli`).
- [x] Every export of all six packages has a generated reference page in `apps/docs/dist/reference/<pkg>/`, and every generated page belongs to its package's sidebar topic.
- [x] Every built HTML page stays inside the 200 KiB budget, and the measurements are recorded in the L12 umbrella todo and fact-check log.
- [x] `pnpm check`, `pnpm typecheck`, `pnpm test` and `pnpm check:api-docs` pass offline.

## Tests

`apps/docs/test/api-docs.test.ts`, `apps/docs/test/topics.test.ts`, `apps/docs/test/content.test.ts` and `apps/docs/test/twins-built.test.ts`.

## Docs to update

`apps/docs/src/content/docs/reference/packages.md`, `apps/docs/README.md`, `docs/todos/ongoing/L12-docs-redesign.md`, and `docs/plans/reviews/fact-check-publish-and-docs.md`.

## Risks and open questions

- `@buildanagent/harness` has 20 entry points and many exports; its sidebar topic could push its largest generated page close to or over the 200 KiB HTML budget. Measure before assuming it fits.
- Single-entry packages (`protocol` and `cli`) emit exports directly under `reference/<pkg>/` rather than under a `@buildanagent/<pkg>/` module folder, so `listExports()` and tests must handle both layouts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description


## Outcome

- Added `@buildanagent/agent-safety`, `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` to `API_PACKAGES` (`apps/docs/src/api/packages.ts`), unified `CHECKED_PACKAGES` with `API_PACKAGES`, and ignored all four generated directories in `apps/docs/.gitignore`.
- Added `@module <import-path>` TSDoc tags to the 30 entry points across those four packages that lacked them, resolving the Astro `/reference/agent-safety` and `/reference/harness` route collisions.
- Updated `listExports()` (`apps/docs/src/api/check.ts`) and `api-docs.test.ts` / `topics.test.ts` to handle single-entry packages (`protocol` and `cli`) alongside multi-entry packages.
- Measured the six-package build: with full leaf links in `@buildanagent/harness`'s sidebar (20 entry points, 446 pages), 27 pages exceeded the 200 KiB budget (largest 233,112 bytes / 227.6 KiB) and `dist/` reached 129 MB. Added `sidebar: "modules"` (`moduleSidebarGroup()`) for `@buildanagent/harness`, which lists its 20 entry-point modules in the sidebar while still generating every export page and Markdown twin. That brought harness's largest page to 94,510 bytes (92.3 KiB), `dist/` to 70 MB, and kept all 965 HTML pages under 200 KiB (largest overall: `reference/sdk/buildanagent/sdk/interfaces/continueoptions/index.html` at 146,947 bytes / 143.5 KiB; mean 61,907 bytes; Pagefind 4.9 MB; 964 Markdown twins totaling 1,281,177 bytes; warm build ~23 s).
- Updated `apps/docs/test/twins-built.test.ts`'s total twin cap from 1 MB (set for two packages) to 2.5 MB for six packages, added a `topics.test.ts` test verifying `modules`-sidebar packages omit leaf export links, updated `apps/docs/src/content/docs/reference/packages.md` and `apps/docs/README.md`, recorded measurements in `docs/todos/ongoing/L12-docs-redesign.md`, and logged rows `L12f-1` to `L12f-7` in `docs/plans/reviews/fact-check-publish-and-docs.md`.
