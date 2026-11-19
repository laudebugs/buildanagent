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
- Deploys and previews ([T9](../ready/T9-book-deploy.md))

## Tasks

- [x] Write `book-build.yml` on `ubuntu-24.04`, with `permissions: contents: read`, `persist-credentials: false`, no secrets and the same setup steps as `ci.yml`'s `checks` job.
- [x] Run `pnpm --filter @buildanagent/manual check:book` and the build, then upload `apps/manual/dist/` as the workflow's only artifact.
- [x] Run `gh actions-lock` for the new workflow, and commit the lockfile.
- [ ] Open a draft pull request with a deliberately broken citation to see the workflow fail, then revert it.

## Acceptance criteria

- [ ] `book-build.yml` runs on every pull request and push to `main`, references no secret, and passes on `main`
- [x] Its only artifact is `apps/manual/dist/`
- [ ] A pull request with an unknown citation fails the workflow
- [x] `gh actions-lock --verify` passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

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
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `.github/workflows/book-build.yml` runs on pushes to `main` and on every pull request, on `ubuntu-24.04`, with `permissions: contents: read`, `persist-credentials: false` and no secret or environment. Its setup is `ci.yml`'s `checks` job's, except the user-namespace step, which only the Copilot harness's examples need.
- After `pnpm install --frozen-lockfile` it runs `check:book`, `book:switch-report`, the figure staleness test (`test/figures.test.ts`) and the build, then uploads `apps/manual/dist/` as `book-dist`, its only artifact, kept 7 days, failing when the folder is empty. T9's deploy reads that name.
- The source register and glossary checks have no command of their own: `check:book` runs them with the outline, the analogy register and the listings. `check:book` reads the committed SVGs and never redraws a figure, so the workflow runs the figure test as well.
- The workflow has no path filter. The book's checks read fact-check logs under `docs/`, the listed files in `verify/` and their harness pins, `pnpm-workspace.yaml` and each package's `typecheck` script and tsconfig, so a filter that missed one would let a pull request break the book unchecked. The steps after the install took 8.6 seconds locally, far below the five-minute limit the risk above sets for adding a filter.
- `gh actions-lock` v0.4.1 added the workflow's four actions to `actions.lock` at the commits already locked for `ci.yml` and `release.yml`, and `gh actions-lock --verify` passes. The repository's tooling has no actionlint; a local actionlint 1.7.12 reported nothing on the workflow.
- The book has no written chapter yet, so its only checked citations are the glossary's register sources. Changing one to an id the register lacks fails `check:book` locally, naming the file and the id; the draft pull request that proves it in CI is still to come.
- Fact-check rows 350–362 in the book's log; row 357 corrects an unmeasured timing in the first draft.
