# L12p: One shared header source for the book, the docs and the site

| Field | Value |
| --- | --- |
| ID | `L12p` |
| Status | `done` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#one-shared-header-source-l12p) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](../ongoing/L12-docs-redesign.md) (L12b, merged) |
| Size | S to M |

## Goal

Give `apps/manual`, `apps/docs` and `apps/site` one shared data source for their header chrome: the four cross-site links (Docs, Manual, Site and GitHub), each site's wordmark and the inline prompt mark SVG. Each app keeps its own markup and adds a test proving its rendered header matches the shared source.

## Context

- [DS5: One shared header source (L12p)](../../plans/publish-and-docs.md#one-shared-header-source-l12p) specifies exporting a data module (`./site-chrome`) from `apps/manual` through the same `exports` pattern `apps/docs` and `apps/site` already use for tokens.
- Both `apps/docs` and `apps/site` already depend on `@buildanagent/manual` via `workspace:*`, and `apps/manual` is private, so nothing reaches npm and no new package is needed.
- `apps/docs/src/chrome.ts` and `apps/site/src/landing/chrome.ts` previously held hard-coded copies with comments noting that `L12p` replaces them, and `apps/manual/src/components/SiteHeader.astro` showed only local book links without the shared mark or cross-site links.

## Scope

**In scope**

- One shared chrome data source in `apps/manual` exported as `@buildanagent/manual/site-chrome` with a shape test in `apps/manual/test/`.
- Updating `apps/manual`, `apps/docs` and `apps/site` to read the four cross-site links (`Docs`, `Manual`, `Site`, `GitHub`), their site wordmarks and the inline mark SVG from `@buildanagent/manual/site-chrome`.
- Keeping the manual's sticky header layout intact (56 px desktop, 52 px phone, local links Contents/Glossary/Sources preserved, cross-site links and mark integrated without breaking `header-static.test.ts`, `reading-settings.test.ts` or `styles.test.ts`).
- Tests in each of the three apps checking that its rendered header matches the shared source.
- Updating `apps/manual/README.md`, `apps/docs/README.md`, `docs/plans/publish-and-docs.md`, `docs/todos/ongoing/L12-docs-redesign.md`, and logging fact-check rows in `docs/plans/reviews/fact-check-publish-and-docs.md`.

**Out of scope**

- Redesigning the manual's layout or turning the shared data into a shared Astro component package.
- Changing `.github/workflows/` or any published package under `packages/`.

## Tasks

- [x] Add the shared chrome data file and `./site-chrome` export in `apps/manual`, with a shape test.
- [x] Update `apps/docs` (`src/chrome.ts`, `SiteTitle.astro`, `astro.config.mjs`) to read links, wordmark and mark from `@buildanagent/manual/site-chrome`, and update its tests.
- [x] Update `apps/site` (`src/landing/chrome.ts`, `src/landing/copy.ts`) to read links, wordmark and mark from `@buildanagent/manual/site-chrome`, and update its tests.
- [x] Update `apps/manual` (`SiteHeader.astro`, `header.css`) to read its wordmark, mark and cross-site links from the shared source, keeping the sticky 56 px / 52 px header, reading scale rules and phone menu working, and add built-header tests.
- [x] Update `apps/manual/README.md`, `apps/docs/README.md`, `docs/plans/publish-and-docs.md`, `docs/todos/ongoing/L12-docs-redesign.md` and `docs/plans/reviews/fact-check-publish-and-docs.md`.

## Acceptance criteria

- [x] `@buildanagent/manual/site-chrome` is the single source of truth for the cross-site links (Docs, Manual, Site, GitHub), each site's wordmark and the inline mark SVG, guarded by a shape test.
- [x] `apps/manual`, `apps/docs` and `apps/site` all read their header links, wordmark and mark from `@buildanagent/manual/site-chrome` with no duplicate hard-coded copies.
- [x] Each of the three apps has tests verifying its rendered header carries the links, mark and wordmark from the shared source.
- [x] `pnpm check`, `pnpm typecheck`, `pnpm fact-check-logs` and tests for `apps/manual`, `apps/docs` and `apps/site` pass.

## Tests

- `apps/manual/test/site-chrome.test.ts`: shape test on `site-chrome.json` and `siteChromeLinks()`, plus built-header checks on both desktop and phone menu markup.
- `apps/docs/test/chrome.test.ts` and `apps/docs/test/logo.test.ts`: checks `src/chrome.ts`, `SiteTitle.astro` and built header links against `@buildanagent/manual/site-chrome`.
- `apps/site/test/landing.test.ts`: checks rendered header links, `aria-current="true"`, wordmark and inline mark against `@buildanagent/manual/site-chrome`.

## Docs to update

- `apps/manual/README.md`
- `apps/docs/README.md`
- `docs/plans/publish-and-docs.md`
- `docs/todos/ongoing/L12-docs-redesign.md`
- `docs/plans/reviews/fact-check-publish-and-docs.md`

## Outcome

- Added `apps/manual/src/design/site-chrome.json` and `apps/manual/src/design/site-chrome.ts`, exported from `apps/manual/package.json` as `./site-chrome` and `./site-chrome.json`.
- Wired all three apps to read their header links, wordmarks and inline prompt mark from `@buildanagent/manual/site-chrome`:
  - `apps/manual`: `SiteHeader.astro`, `header.css` and `scripts/header-check.mjs`.
  - `apps/docs`: `src/chrome.ts`, `astro.config.mjs` and `SiteTitle.astro`.
  - `apps/site`: `src/landing/copy.ts`, `src/landing/chrome.ts`, `SiteHeader.astro` and `site.css`.
- Added shape and built-header tests across all three apps (`apps/manual/test/site-chrome.test.ts`, `apps/docs/test/chrome.test.ts` and `apps/site/test/landing.test.ts`).
- Updated `apps/manual/README.md`, `apps/docs/README.md`, `docs/plans/publish-and-docs.md` §4 and `docs/todos/ongoing/L12-docs-redesign.md`, and logged fact-check rows `L12p-1` to `L12p-4` in `docs/plans/reviews/fact-check-publish-and-docs.md`.
