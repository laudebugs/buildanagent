# T8: The book's build workflow: every check, no secrets, `dist/` as an artifact

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T8` |
| Status | `done` |
| Plan | [Book plan §5, BK14](../../plans/build-book.md#bk14-one-ci-job-builds-the-book-and-runs-every-check-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T4](../done/T4-book-listings.md), [T6](../done/T6-book-flat-figures.md) |
| Size | S |

## Goal

Fail a pull request that breaks the book, and hand the deploy workflow a built site it can trust as files only. `book-build.yml`, the build half of DS3's split, runs on every pull request and push to `main`. It builds the site with no secrets, runs every book check, and uploads only `apps/manual/dist/` as an artifact, so an unknown citation, a stale figure, a broken listing or a missing caption never reaches `main`.

## Context

- [Book plan BK14 and BK15](../../plans/build-book.md#bk14-one-ci-job-builds-the-book-and-runs-every-check-proposed).
- [Publish-and-docs plan, DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted) and [L8](../ready/L8-cloudflare-deploys.md): the same split for the docs and the website.
- [ci.yml](../../../.github/workflows/ci.yml), [`actions.lock`](../../../.github/workflows/actions.lock) and the [CI plan §3d](../../plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19): how workflows and actions are added.

## Scope

**In scope**

- `book-build.yml` on `pull_request` and pushes to `main`: install, `check:book`, the register and glossary checks, `book:switch-report`, the build, and an upload of `apps/manual/dist/` only
- Any new action locked in `actions.lock`

**Out of scope** (and which todo covers it)

- The anatomy audits, which [T7](../ready/T7-book-isometric-figures.md) adds to this workflow
- Deploys and previews ([T9](T9-book-deploy.md))

## Tasks

- [x] Write `book-build.yml` on `ubuntu-24.04`, with `permissions: contents: read`, `persist-credentials: false`, no secrets and the same setup steps as `ci.yml`'s `checks` job.
- [x] Run `pnpm --filter @buildanagent/manual check:book` and the build, then upload `apps/manual/dist/` as the workflow's only artifact.
- [x] Run `gh actions-lock` for the new workflow, and commit the lockfile.
- [x] Open a draft pull request with a deliberately broken citation to see the workflow fail, then revert it (#77, closed).

## Acceptance criteria

- [x] `book-build.yml` runs on every pull request and push to `main`, references no secret, and passes on `main` (it passed on #76, and [its first run on `main`](https://github.com/laudebugs/buildanagent/actions/runs/44561633583) passed on `fec8e35`)
- [x] Its only artifact is `apps/manual/dist/`
- [x] A pull request with an unknown citation fails the workflow (#77)
- [x] `gh actions-lock --verify` passes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (on macOS all pass except `verify/copilot-sdk`, which needs Linux's `unshare` and runs in CI, and `scripts/ci/packages-pack.test.mjs`'s offline install, which fails the same way on `main` at `46e6721`)

## Tests

The workflow itself, proved by the deliberate failure in the tasks.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout: `book-build.yml` in the workflows line
- The [CI plan](../../plans/ci.md): one line on the workflow

## Risks and open questions

- The book build adds minutes to every pull request; if it grows past five minutes, run it only when `apps/manual/`, `verify/`, `docs/` or the workflow change, and let the deploy workflow skip runs that uploaded nothing.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally (on macOS all pass except `verify/copilot-sdk`, which needs Linux's `unshare` and runs in CI, and `scripts/ci/packages-pack.test.mjs`'s offline install, which fails the same way on `main` at `46e6721`); pushed as #76
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `.github/workflows/book-build.yml` runs on pushes to `main` and on every pull request, on `ubuntu-24.04`, with `permissions: contents: read`, `persist-credentials: false` and no secret or environment. It copies the setup of `ci.yml`'s `checks` job, except the user-namespace step that only the Copilot harness's examples need.
- After `pnpm install --frozen-lockfile` it runs `check:book`, `book:switch-report`, the figure staleness test (`test/figures.test.ts`) and the build, then uploads `apps/manual/dist/` as `book-dist`, its only artifact. The upload keeps it 7 days and fails when the folder is empty, and T9's deploy reads that name.
- The source register and glossary checks have no command of their own: `check:book` runs them with the outline, the analogy register and the listings. `check:book` reads the committed SVGs and never redraws a figure, so the workflow runs the figure test as well.
- The workflow has no path filter. The book's checks read fact-check logs under `docs/`, the listed files in `verify/` and their harness pins, `pnpm-workspace.yaml` and each package's `typecheck` script and tsconfig. A filter that missed one would let a pull request break the book unchecked. The steps after the install took 8.6 seconds locally, far below the five-minute limit the risk above sets for adding a filter.
- `ci.yml`'s `pnpm test` already includes the figure test and `book:switch-report`, so both run twice on each pull request, for about 4 seconds. We chose to keep them so that `book-build.yml` alone vouches for the artifact T9 deploys.
- `gh actions-lock` v0.4.1 added the workflow's four actions to `actions.lock` at the commits already locked for `ci.yml` and `release.yml`, and `gh actions-lock --verify` passes. The repository's tooling has no actionlint; a local actionlint 1.7.12 reported nothing on the workflow.
- The book has no written chapter yet, so its only checked citations are the glossary's register sources. Changing one to an id the register lacks fails `check:book`, naming the file and the id. Draft pull request #77 did that in CI: three glossary entries share the changed source, and [its run](https://github.com/laudebugs/buildanagent/actions/runs/44559753914) failed at `check:book` with three problems, one per entry. #77 is closed and its branch deleted.
- The first `book-build` run on `main`, [run 44561633583](https://github.com/laudebugs/buildanagent/actions/runs/44561633583), passed on the merge commit `fec8e35`, a `push` event, so every acceptance criterion is now met (fact-check row 370).
- The book's log holds fact-check rows 350–369. Row 357 corrects an unmeasured timing in the first draft, and row 364 corrects the one-line edit instruction for the deliberate failure.
- Root gate, rerun after the first review: `pnpm check` and `pnpm typecheck` pass, and `pnpm -r --no-bail test` passes for every package except `verify/copilot-sdk`. `node --test scripts/ci/*.test.mjs` runs 138 tests: 135 pass, 2 skip and 1 fails. The failing test, the packed packages' offline install, fails the same way in a checkout of `46e6721`, because corepack fetches pnpm 12.21.0 in the test's fresh home and that pnpm finds no offline metadata.
