# T8: The book's build workflow: every check, no secrets, `dist/` as an artifact

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T8` |
| Status | `ready` |
| Plan | [Book plan §5, BK14](../../plans/build-book.md#bk14-one-ci-job-builds-the-book-and-runs-every-check-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T4](T4-book-listings.md), [T6](../ongoing/T6-book-flat-figures.md) |
| Size | S |

## Goal

Fail a pull request that breaks the book, and hand the deploy workflow a built site it can trust as files only. `book-build.yml`, the build half of DS3's split, runs on every pull request and push to `main`. It builds the site with no secrets, runs every book check, and uploads only `apps/manual/dist/` as an artifact, so an unknown citation, a stale figure, a broken listing or a missing caption never reaches `main`.

## Context

- [Book plan BK14 and BK15](../../plans/build-book.md#bk14-one-ci-job-builds-the-book-and-runs-every-check-proposed).
- [Publish-and-docs plan, DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted) and [L8](L8-cloudflare-deploys.md): the same split for the docs and the website.
- [ci.yml](../../../.github/workflows/ci.yml), [`actions.lock`](../../../.github/workflows/actions.lock) and the [CI plan §3d](../../plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19): how workflows and actions are added.

## Scope

**In scope**

- `book-build.yml` on `pull_request` and pushes to `main`: install, `check:book`, the register and glossary checks, `book:switch-report`, the build, and an upload of `apps/manual/dist/` only
- Any new action locked in `actions.lock`

**Out of scope** (and which todo covers it)

- The anatomy audits, which [T7](T7-book-isometric-figures.md) adds to this workflow
- Deploys and previews ([T9](T9-book-deploy.md))

## Tasks

- [ ] Write `book-build.yml` on `ubuntu-24.04`, with `permissions: contents: read`, `persist-credentials: false`, no secrets and the same setup steps as `ci.yml`'s `checks` job.
- [ ] Run `pnpm --filter @buildanagent/manual check:book` and the build, then upload `apps/manual/dist/` as the workflow's only artifact.
- [ ] Run `gh actions-lock` for the new workflow, and commit the lockfile.
- [ ] Open a draft pull request with a deliberately broken citation to see the workflow fail, then revert it.

## Acceptance criteria

- [ ] `book-build.yml` runs on every pull request and push to `main`, references no secret, and passes on `main`
- [ ] Its only artifact is `apps/manual/dist/`
- [ ] A pull request with an unknown citation fails the workflow
- [ ] `gh actions-lock --verify` passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The workflow itself, proved by the deliberate failure in the tasks.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout: `book-build.yml` in the workflows line
- The [CI plan](../../plans/ci.md): one line on the workflow

## Risks and open questions

- The book build adds minutes to every pull request; if it grows past five minutes, run it only when `apps/manual/`, `verify/`, `docs/` or the workflow change, and let the deploy workflow skip runs that uploaded nothing.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
