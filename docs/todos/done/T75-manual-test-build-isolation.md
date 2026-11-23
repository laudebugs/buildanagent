# T75: Give each of the manual's build tests its own build directory

| Field | Value |
| --- | --- |
| ID | `T75` |
| Status | `done` |
| Plan | [Book plan BK14](../../plans/build-book.md#bk14-one-ci-job-builds-the-book-and-runs-every-check-proposed) |
| Round / milestone | Round T (textbook), test infrastructure |
| Depends on | None |
| Size | S |

## Goal

The manual's `pnpm test` intermittently skips 15 to 40 tests. Several test files (`test/build.test.ts`, `test/offline-build.test.ts` and others) each run `astro build` in `apps/manual` in parallel, and the builds share one `.astro/.prerender` directory. One build deletes chunks another is importing, so a test fails with `ERR_MODULE_NOT_FOUND` under `.astro/.prerender/chunks/` and the suite skips the tests behind it. `main` has the same exposure: CI can go red or silently skip tests. This todo replaces the parallel builds with one shared build and adds a test that fails if a second build returns.

## Context

- Berry reproduced the failure 3 of 3 times with the render-inputs hash deleted.
- `apps/docs/test/built-site.ts` already shares one build through a Vitest global setup; copy that pattern unless it does not fit.
- `apps/manual/README.md` says how the manual's tests run offline.

## Scope

**In scope**

- Test files and the manual's Vitest config only. No production build config unless unavoidable (then the diff says why).
- A test or script that runs the build tests concurrently several times and asserts that none is skipped.
- A guard that fails when a test file runs `astro build` without an isolated directory.

**Out of scope**

- `.github/workflows`, and serialising the tests unless nothing else works (CI time).

## Tasks

- [x] Reproduce the failure and find every test file that runs `astro build`.
- [x] Isolate each build (a per-build temp `cacheDir` and `outDir`) or share one build through a global setup.
- [x] Add the concurrency proof and the guard.
- [x] Run the manual's `test` repeatedly, `check:book`, `pnpm check`, `pnpm typecheck`; move this todo to `done/`.

## Acceptance criteria

- [x] The build tests run in parallel with no skip in N consecutive runs
- [x] A test file that runs `astro build` without an isolated directory fails the guard
- [x] The diff touches test files and the Vitest config only (or says why not)

## Outcome

**Cause.** `astro build` writes its prerender bundle to `<app>/.astro/.prerender` whatever `--outDir` or `cacheDir` say (the config's `cacheDir` moves only the content cache), so `test/build.test.ts` and `test/offline-build.test.ts`, which each ran `astro build` at once, deleted each other's chunks. Reproduced 3 of 3 times from a clean `.astro`: `ERR_MODULE_NOT_FOUND` under `.astro/.prerender/chunks/`, and all 15 offline tests skipped. A temporary `outDir` or `cacheDir` per build could not fix it, so the builds are shared, as in the docs app.

**Fix.** `test/built-book.ts`, a Vitest global setup (`vitest.config.ts`), builds the fixture book once per run into a temporary folder and provides it, or its error, to the tests; `test/built.ts` gives them `builtBook()`. `build.test.ts` reads that folder; `offline-build.test.ts` copies it and runs Pagefind and the offline step on the copy. No production config changed.

**Proof.** `test/build-isolation.test.ts` fails when any other test file runs `astro build` (with a negative case showing the guard fires), and runs the two build test files together from a clean `.astro` in a child Vitest, failing on any skipped or failed test. Both fail on the old test files. The full manual suite passed three times in a row from a clean cache (671 tests, none skipped).
