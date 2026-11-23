# T67a: Make the manual installable and readable offline

| Field | Value |
| --- | --- |
| ID | `T67a` |
| Status | `ongoing` |
| Plan | [Build the book §1](../../plans/build-book.md) (the non-goal this todo reverses) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | None |
| Size | L (a service worker with its build step, its tests and an ADR; T67b adds the reader's control) |

## Goal

Let a reader install the manual at manual.buildanagent.fyi as an app and open it with no connection. The owner answered yes on 2026-11-23 to [issue #175](https://github.com/laudebugs/buildanagent/issues/175), which asked whether to reverse the book plan's decision that an offline service worker is out of scope. This todo adds the web app manifest, the icons, a service worker with a per-build list of the book's files, an offline page, an update notice and the ADR that records the reversal. T67b adds the "Save the manual for offline reading" control that fills the cache on request.

## Context

- [`docs/research/book/offline-reading-and-caching.md`](../../research/book/offline-reading-and-caching.md): what the deployed Worker already caches (every file revalidates before reuse, except the hashed files under `/_astro/`) and what a service worker adds. Its fact-check rows are in the book plan's log.
- [`apps/manual/public/_headers`](../../../apps/manual/public/_headers): the book's CSP already allows `worker-src 'self'`; `book-deploy.yml` always uses main's copy of this file.
- [`apps/manual/scripts/stage-dist.mjs`](../../../apps/manual/scripts/stage-dist.mjs) and [`guard-deploy.mjs`](../../../apps/manual/scripts/guard-deploy.mjs): the deploy refuses any top-level name that starts with `_` except `_astro` and `_headers`, and caps the unpacked book at 100 MiB. A root-level `sw.js`, `manifest.webmanifest` and `icons/` fit both limits.
- `apps/manual/dist/` holds 91 files and 5.0 MB today: pages, `/pagefind/` (1.3 MB, 41 files), `/fonts/` (476 KB, 10 files), `/_astro/` (92 KB), `/scripts/` (120 KB).
- The owner's rules: no `.github/workflows` edits; the book's deploy is security-sensitive, so the service worker, its caching and its headers get an Opus builder and an Opus first review.

## Scope

**In scope**

- A manifest (`name` "Build An Agent manual", `short_name`, `start_url`, `scope`, `display: standalone`, colours from the book tokens) linked in the page head, with the prompt mark as 192 and 512 pixel icons, a maskable icon and an apple-touch icon, drawn from `public/favicon.svg`.
- A module service worker served from the site root, with cache names versioned by a hash of the build, a precache of the application shell (the home page, the offline page, the styles, scripts and fonts every page needs, the search page) and a navigation fallback to an offline page.
- A generator that writes the build's file list (path, size, hash) as `/offline-manifest.json`, with a test that fails when the committed or built list is stale.
- An update flow: a waiting worker shows a small "A new version is ready. Reload" notice; the page never reloads by itself.
- Pagefind's search working offline once the pages are saved, and notes and highlights (localStorage) working offline.
- Registration on the production host only, with a test that a preview host (`pr-<n>.manual.buildanagent.fyi`) registers nothing and unregisters a worker an earlier visit left.
- The ADR that records the reversal of the non-goal.

**Out of scope**

- The "Save the manual for offline reading" control, its progress, size and remove button (T67b).
- Chapter content, PDF or EPUB.
- Push notifications and background sync.
- `.github/workflows/`.

## Tasks

- [x] Claim the todo and tell the manager.
- [ ] Write ADR 0059, the reversal of the offline non-goal, with its cost and its rollback (unregister the worker and drop the caches).
- [ ] Draw the icons from `favicon.svg` with a script (Playwright's Chromium, which `figures:audit` already uses) and commit them with a test that checks their sizes, their format and that the source SVG's hash matches the one the script recorded.
- [ ] Add the manifest and the head links, and a test of the manifest's fields, the icons' presence and `start_url` and `scope`.
- [ ] Write the service worker and its logic module (routing, cache names, precache, navigation fallback, update message) so a unit test can run it against a fake cache and fetch.
- [ ] Write the offline-manifest generator, run at build, and its stale test.
- [ ] Write the registration script (production host only, update notice), served from `/scripts/`.
- [ ] Add the offline page.
- [ ] Update `public/_headers` for the worker file (`Cache-Control: no-cache`) and the manifest's content type, and check `stage-dist.mjs` and `guard-deploy.mjs` accept the build, changing them only with tests.
- [ ] Add a Playwright check that, after the pages are cached, `context.setOffline(true)` still opens a page, a deep link and the search, and that notes still save.
- [ ] Fact-check every claim in the reader-facing copy about browser behaviour (storage limits, eviction on iOS Safari, install prompts, which browsers support what, as of November 2026), with rows in the book's log.

## Acceptance criteria

- [ ] The manual passes Lighthouse's installability check in Chrome and installs from the address bar.
- [ ] With the pages saved and the network off, a chapter, a deep link, the glossary and the search open, and the offline page appears for a page that was not saved.
- [ ] A new deploy shows the update notice; the page does not reload until the reader chooses.
- [ ] A preview host registers no worker.
- [ ] `pnpm --filter @buildanagent/manual test`, `check:book`, the build, `pnpm check` and `pnpm typecheck` pass, and `stage-dist.mjs --preview` accepts the new `dist/`.

## Tests

Unit tests of the worker's logic against a fake cache and fetch; the manifest, icon and offline-manifest tests in `apps/manual/test/`; a Playwright offline check beside `notes-browser-check.mjs`; a host-scoping test of the registration script.

## Docs to update

[`apps/manual/README.md`](../../../apps/manual/README.md) (the worker, the manifest and how to bust the cache), the book plan's Out-of-scope row and §1 (reversed, with the ADR), the research report's status line, and `AGENTS.md`'s description of the book.

## Risks and open questions

- **Stale pages.** A saved book can hold old chapters while new hashed files deploy. The per-build list and the update notice handle this; the cache of a build is deleted only after the new build has finished saving.
- **Storage.** iOS Safari may evict a site's storage after a week without use, and a quota can refuse the save. T67b says so to the reader.
- **First-visit cost.** The worker precaches only the application shell on install. Downloading all 91 files (about 5 MB) happens when the reader asks, in T67b.
- **Owner decision.** Should the first visit cache every page without a click? The default here is no, because it spends a visitor's data without asking.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (Opus high first), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
