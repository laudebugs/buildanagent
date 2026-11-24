# L12p: One shared header source for the book, the docs and the site

| Field | Value |
| --- | --- |
| ID | `L12p` |
| Status | `ongoing` |
| Plan | [Publish and docs DS5](../../plans/publish-and-docs.md#one-shared-header-source-l12p) |
| Round / milestone | Round L (publish and docs) |
| Depends on | [L12](../ongoing/L12-docs-redesign.md) (L12b, merged) |
| Size | S to M |

## Goal

Give `apps/manual`, `apps/docs` and `apps/site` one shared data source for their header chrome: the four cross-site links (Docs, Manual, Site and GitHub), each site's wordmark and the inline prompt mark SVG. Each app keeps its own markup and adds a test proving its rendered header matches the shared source.

## Context

- [DS5: One shared header source (L12p)](../../plans/publish-and-docs.md#one-shared-header-source-l12p) specifies exporting a data module (`./site-chrome`) from `apps/manual` through the same `exports` pattern `apps/docs` and `apps/site` already use for tokens.
- Both `apps/docs` and `apps/site` already depend on `@buildanagent/manual` via `workspace:*`, and `apps/manual` is private, so nothing reaches npm and no new package is needed.
- `apps/docs/src/chrome.ts` and `apps/site/src/landing/chrome.ts` currently hold hard-coded copies with comments noting that `L12p` replaces them, and `apps/manual/src/components/SiteHeader.astro` currently shows only local book links without the shared mark or cross-site links.

## Scope

**In scope**

- One shared chrome data source in `apps/manual` exported as `@buildanagent/manual/site-chrome` with a shape test in `apps/manual/test/`.
- Updating `apps/manual`, `apps/docs` and `apps/site` to read the four cross-site links (`Docs`, `Manual`, `Site`, `GitHub`), their site wordmarks and the inline mark SVG from `@buildanagent/manual/site-chrome`.
- Keeping the manual's sticky header layout intact (56 px desktop, 52 px phone, local links Contents/Glossary/Sources preserved, cross-site links and mark integrated cleanly without breaking `header-static.test.ts`, `reading-settings.test.ts` or `styles.test.ts`).
- Tests in each of the three apps checking that its rendered header matches the shared source.
- Updating `apps/manual/README.md`, `apps/docs/README.md`, `docs/plans/publish-and-docs.md`, `docs/todos/ongoing/L12-docs-redesign.md`, and logging fact-check rows in `docs/plans/reviews/fact-check-publish-and-docs.md`.

**Out of scope**

- Redesigning the manual's layout or turning the shared data into a shared Astro component package.
- Changing `.github/workflows/` or any published package under `packages/`.

## Tasks

- [ ] Add the shared chrome data file and `./site-chrome` export in `apps/manual`, with a shape test.
- [ ] Update `apps/docs` (`src/chrome.ts`, `SiteTitle.astro`, `astro.config.mjs`) to read links, wordmark and mark from `@buildanagent/manual/site-chrome`, and update its tests.
- [ ] Update `apps/site` (`src/landing/chrome.ts`, `src/landing/copy.ts`) to read links, wordmark and mark from `@buildanagent/manual/site-chrome`, and update its tests.
- [ ] Update `apps/manual` (`SiteHeader.astro`, `header.css`) to read its wordmark, mark and cross-site links from the shared source, keeping the sticky 56 px / 52 px header, reading scale rules and phone menu working, and add built-header tests.
- [ ] Update `apps/manual/README.md`, `apps/docs/README.md`, `docs/plans/publish-and-docs.md`, `docs/todos/ongoing/L12-docs-redesign.md` and `docs/plans/reviews/fact-check-publish-and-docs.md`.

## Acceptance criteria

- [ ] `@buildanagent/manual/site-chrome` is the single source of truth for the cross-site links (Docs, Manual, Site, GitHub), each site's wordmark and the inline mark SVG, guarded by a shape test.
- [ ] `apps/manual`, `apps/docs` and `apps/site` all read their header links, wordmark and mark from `@buildanagent/manual/site-chrome` with no duplicate hard-coded copies.
- [ ] Each of the three apps has tests verifying its rendered header carries the links, mark and wordmark from the shared source.
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm fact-check-logs` and tests for `apps/manual`, `apps/docs` and `apps/site` pass.

## Tests

- `apps/manual/test/`: shape test on `site-chrome` plus built-header checks in `build.test.ts` / `header-static.test.ts`.
- `apps/docs/test/`: `chrome.test.ts`, `logo.test.ts`, built-header link checks.
- `apps/site/test/`: `landing.test.ts`, `site.test.ts` checking rendered header against `@buildanagent/manual/site-chrome`.

## Docs to update

- `apps/manual/README.md`
- `apps/docs/README.md`
- `docs/plans/publish-and-docs.md`
- `docs/todos/ongoing/L12-docs-redesign.md`
- `docs/plans/reviews/fact-check-publish-and-docs.md`
