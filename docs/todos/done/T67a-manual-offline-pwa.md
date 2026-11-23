# T67a: Make the manual installable and readable offline

| Field | Value |
| --- | --- |
| ID | `T67a` |
| Status | `done` |
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
- [x] Write ADR 0059, the reversal of the offline non-goal, with its cost and its rollback (unregister the worker and drop the caches).
- [x] Draw the icons from `favicon.svg` with a script (Playwright's Chromium, which `figures:audit` already uses) and commit them with a test that checks their sizes, their format and that the source SVG's hash matches the one the script recorded.
- [x] Add the manifest and the head links, and a test of the manifest's fields, the icons' presence and `start_url` and `scope`.
- [x] Write the service worker and its logic module (routing, cache names, precache, navigation fallback, update message) so a unit test can run it against a fake cache and fetch.
- [x] Write the offline-manifest generator, run at build, and its stale test.
- [x] Write the registration script (production host only, update notice), served from `/scripts/`.
- [x] Add the offline page.
- [x] Update `public/_headers` for the worker file (`Cache-Control: no-cache`) and the manifest's content type, and check `stage-dist.mjs` and `guard-deploy.mjs` accept the build, changing them only with tests.
- [x] Add a Playwright check that, after the pages are cached, `context.setOffline(true)` still opens a page, a deep link and the search, and that notes still save.
- [x] Fact-check every claim in the reader-facing copy about browser behaviour (storage limits, eviction on iOS Safari, install prompts, which browsers support what, as of November 2026), with rows in the book's log.

## Acceptance criteria

- [ ] The manual passes Lighthouse's installability check in Chrome and installs from the address bar.
- [x] With the pages saved and the network off, a chapter, a deep link, the glossary and the search open, and the offline page appears for a page that was not saved.
- [x] A new deploy shows the update notice; the page does not reload until the reader chooses.
- [x] A preview host registers no worker.
- [x] `pnpm --filter @buildanagent/manual test`, `check:book`, the build, `pnpm check` and `pnpm typecheck` pass, and `stage-dist.mjs --preview` accepts the new `dist/`.

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
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (Opus high first), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Done on 2026-11-23 ([ADR 0059](../../decisions/0059-offline-manual-service-worker.md)). The worker stores only the bytes its build lists, so a cache never mixes builds; the README's section "The book installs as an app and opens offline" describes it, and the ADR records the message protocol T67b builds on.

- **Decisions beyond the brief.** Assets that are not content-addressed come from the network first, not stale-while-revalidate, unless their page came from the cache or matched the list, because stale-while-revalidate would serve an old build's script under a new page. A page the reader opens online is saved when its bytes match, which costs no extra download; saving the whole book stays with T67b. Install carries every unchanged file over from the older build's cache, so an update keeps what a reader saved. The worker is bundled with esbuild 0.28.2, already in the lockfile, into one classic script. The offline page is an Astro page at `/offline/`, so it uses the book's stylesheet and fonts from the shell.
- **Security.** Only same-origin GETs for listed paths are cached, keyed by origin and path; a response is stored only as a plain 200 of type `basic` with the listed size and SHA-256, and never with `Set-Cookie`, `Vary: *`, `no-store` or `private`. `/sw.js` and `/offline-manifest.json` never enter a cache. The worker never calls `skipWaiting()` itself and deletes old caches only at activate. Registration needs a host from the build's meta tag; `MANUAL_OFFLINE_TEST_HOST` accepts only a loopback name. `_headers` gained `manifest-src 'self'`, which the manifest needs under `default-src 'none'`.
- **First review round (Opus high, 8 findings and one risk, all fixed).** Assets of a page served from this build's cache come from the network only when the bytes are this build's, and the worker records such pages in its cache, so the rule survives a restart. Reload asks the worker waiting at the press. The landing page is saved through `SAVE_PAGE`. The shell holds Pagefind's search files (56 files, 1.62 MB), so a search never run online works offline. The build id hashes a format version, the worker's code and the shell. Paths are normalised, and a slashless page redirects offline. The icon script gets a fresh HOME. For the risk that Cloudflare rewrites pages (Email Address Obfuscation is on by default and the chapters hold example addresses), every page carries a stamped `<meta name="manual-build">`. A rewritten page that keeps it is stored and reported under `rewritten`, and every failed save is reported under `failed`. `offline:verify` checks a deployed copy after a deploy.
- **Second review round (Sonnet medium, 4 unverified nits, all real and fixed).** Activate keeps an older build's cache while a page it served is still open, and serves that page its own build's files, which the deploy removed from the server. The problems and clients records are read once and written only when they change. The build-specific sizes carry their date. The 404 page gets the real build mark.
- **Second review round (Sonnet low, 1 finding, fixed).** Saved pages never carried over to a new build, because each build stamps its id into every page. The list now hashes a page with the placeholder in its mark, the worker compares a page the same way and stores it with the new build's mark, and a test on two real fixture builds that differ in one stylesheet shows the saved pages carry over while a changed chapter does not. A kept older cache is also deleted once its last page closes, and a deleted cache is never reopened.
- **Verification.** 62 tests cover the offline work (worker, registration, assets, a fixture build through the offline step, the post-deploy check). The manual's 556 Vitest tests and 157 `node --test` tests pass. `scripts/offline-browser-check.mjs` passed its 26 checks in Chromium against a server that rewrites addresses as Cloudflare does. They include Chrome's own installability check with no errors, the landing page saved, a rewritten page reported, offline reading, two searches never run online, notes, the update notice and a host that registers nothing; with Pagefind left out of the shell the check fails. `stage-dist.mjs --preview` staged a zip of the real `dist/`. The first acceptance criterion stays open: Chrome's check passes, but installing from the address bar on the deployed site needs a person after the deploy, as does running `offline:verify` against it.
- **AGENTS.md.** The coordinator added the book's description to `AGENTS.md`, which `CLAUDE.md` links to, in `a8f432b7`.
