# T75: Give each of the manual's build tests its own build directory

| Field | Value |
| --- | --- |
| ID | `T75` |
| Status | `ongoing` |
| Plan | [Book plan BK14](../../plans/build-book.md#bk14-one-ci-job-builds-the-book-and-runs-every-check-proposed) |
| Round / milestone | Round T (textbook), test infrastructure |
| Depends on | None |
| Size | S |

## Goal

The manual's `pnpm test` intermittently skips 15 to 40 tests. Several test files (`test/build.test.ts`, `test/offline-build.test.ts` and others) each run `astro build` in `apps/manual` in parallel, and the builds share one `.astro/.prerender` directory. One build deletes chunks another is importing, so a test fails with `ERR_MODULE_NOT_FOUND` under `.astro/.prerender/chunks/` and the suite skips the tests behind it. `main` has the same exposure: CI can go red or silently skip tests. This todo gives each build its own directory, or shares one build through a global setup, and adds a test that fails if the sharing returns.

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

- [ ] Reproduce the failure and find every test file that runs `astro build`.
- [ ] Isolate each build (a per-build temp `cacheDir` and `outDir`) or share one build through a global setup.
- [ ] Add the concurrency proof and the guard.
- [ ] Run the manual's `test` repeatedly, `check:book`, `pnpm check`, `pnpm typecheck`; move this todo to `done/`.

## Acceptance criteria

- [ ] The build tests run in parallel with no skip in N consecutive runs
- [ ] A test file that runs `astro build` without an isolated directory fails the guard
- [ ] The diff touches test files and the Vitest config only (or says why not)

## Outcome

To be written when the todo is done.
