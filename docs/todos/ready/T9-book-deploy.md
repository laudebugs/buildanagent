# T9: Deploy to manual.buildanagent.fyi from GitHub Actions: guard, switch and branch previews

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T9` |
| Status | `ready` |
| Plan | [Book plan §5, BK15](../../plans/build-book.md#bk15-an-assets-only-worker-on-a-custom-domain-behind-a-guard-and-a-switch-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T2](../done/T2-book-design.md), [T8](../ongoing/T8-book-ci.md) |
| Size | M |

## Goal

Publish the book from GitHub Actions. An assets-only Worker serves the built site on the custom domain manual.buildanagent.fyi, and a guard script refuses a deploy whose configuration drifts. A repository variable switches deploys on, and every pull request, a fork's included, gets a public preview on `workers.dev` from a deploy run that never runs its code. The owner creates the Cloudflare and GitHub pieces; this todo writes against their names, documents them exactly, and fails closed when one is missing.

## Context

- [Book plan BK2 and BK15](../../plans/build-book.md#bk15-an-assets-only-worker-on-a-custom-domain-behind-a-guard-and-a-switch-proposed), including the table of what the owner sets up, and [ADR 0053](../../decisions/0053-book-stack-and-deploy.md).
- Cloudflare docs: [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [authorization](https://developers.cloudflare.com/workers/authorization/), [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/), [Previews](https://developers.cloudflare.com/workers/previews/), [Previews examples](https://developers.cloudflare.com/workers/previews/examples/), [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/).
- [GitHub, environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments): environment secrets reach only jobs that reference the environment.
- [Publish-and-docs plan, DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted) and [L8](L8-cloudflare-deploys.md): the same split for the docs and the website. L8 uses repository secrets; the book uses the owner's two environments and Cloudflare's current role names (BK15).
- The garment repository at commit `bca44b0`: `scripts/guard-deploy.mjs` and the deploy workflow's concurrency, switch and clean install ([ADR 0054](../../decisions/0054-reuse-garment-textbook-code.md)); copy none of its account identifiers.
- The `/wrangler` and `/workers-best-practices` skills.

## Scope

**In scope**

- `apps/manual/wrangler.jsonc`: assets-only, `./dist`, the custom-domain route, `not_found_handling: "404-page"`, `workers_dev: false`, `preview_urls: true`; JSONC because Cloudflare recommends it for new projects (BK15)
- `public/_headers` with a content security policy, `X-Content-Type-Options`, `Referrer-Policy` and long caching for hashed assets
- `scripts/guard-deploy.mjs` and its tests, and a secrets check that runs first in every job
- `book-deploy.yml`, the deploy half of DS3's split: on `workflow_run` after `book-build.yml`, run from `main`, deploy production behind `BOOK_DEPLOY_ENABLED` in `book-production`, and preview every other run in `book-preview`, deleting a closed pull request's preview
- `apps/manual/README.md`: the exact list of what the owner must create

**Out of scope** (and which todo covers it)

- Creating the zone, the GitHub environments, their protection rules, the tokens and the secrets: the owner does these (owner prerequisite below)
- Cloudflare's Git integration (Workers Builds): not used, by the owner's choice
- Sign-in or analytics (none, by BK2)
- PDF and EPUB (BK13, later)

## Tasks

- [ ] **Owner prerequisite, not a builder task.** The owner said "we'll set this up" (2026-11-19). The owner puts the buildanagent.fyi zone in the deploy account and creates both GitHub environments with their protection rules. The owner also creates two account-owned tokens and stores each, with `CLOUDFLARE_ACCOUNT_ID`, as `CLOUDFLARE_API_TOKEN` in its environment: for `book-production`, Account › Workers › Editor plus Zone › Workers Routes › Write on the buildanagent.fyi zone; for `book-preview`, Account › Workers › Editor scoped to the book's Worker, with no zone permission. Because Editor cannot create a Worker, the owner creates the book's Worker once by hand, or runs the first deploy with a short-lived Admin token, so the stored tokens never hold Admin. After the custom domain is attached, the owner may remove the zone permission until the domain changes. Then the owner sets `BOOK_DEPLOY_ENABLED`. As of 2026-11-19 the `book-production` and `book-preview` environments exist and each holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and `book-production` allows only protected branches (`main`), so the workflow uses those names and still fails closed if a secret goes missing; before the first deploy, check by name only that each holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and that `book-production` allows only `main`. This todo may merge before the rest of the setup exists.
- [ ] Write the owner's checklist into `apps/manual/README.md` from BK15's table: environment names (`book-production`, `book-preview`), which branches may deploy to each, the secret names (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), each token's exact permissions as listed in BK15, the one-time Worker creation with Admin rights, and the variable `BOOK_DEPLOY_ENABLED`.
- [ ] Check that manual.buildanagent.fyi has no CNAME record, since Cloudflare refuses a custom domain there.
- [ ] Write `wrangler.jsonc` and `_headers`, and build locally with `pnpm exec wrangler dev` to check headers and routes.
- [ ] Port the guard from the garment repository with a header comment naming its origin, commit and Apache-2.0 licence. It parses JSONC and refuses unless the config has exactly the one custom-domain route, no `main`, `assets.directory: "./dist"`, `not_found_handling: "404-page"`, `workers_dev: false`, `preview_urls: true` and a `_headers` file.
- [ ] Write a first step for each job that checks its environment's secrets and fails with a message naming the missing secret and pointing to the README checklist.
- [ ] Write `book-deploy.yml` on `workflow_run` after `book-build.yml`, following [DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted): GitHub runs its definition from `main`. It downloads the `dist/` artifact, takes `wrangler.jsonc`, `_headers` and the guard from `main`, and never checks out or runs the pull request's code.
- [ ] Production job: only when `github.event.workflow_run.event == 'push'`, `github.event.workflow_run.head_repository.full_name == github.repository`, the head branch is `main` and `vars.BOOK_DEPLOY_ENABLED == 'true'`; `environment: book-production`; `concurrency` with `cancel-in-progress: false`; the secrets check, the guard, then `wrangler deploy`.
- [ ] Preview job, for every other run: `environment: book-preview`; find the pull request from `GET /repos/{repo}/commits/{head_sha}/pulls`, never from the artifact; run `wrangler preview --name pr-<number>`; and delete the preview with `wrangler preview delete` when the pull request closes.
- [ ] Lock the workflow's actions in `actions.lock`. Once the owner has set everything up, watch the first deploy and one preview.

## Acceptance criteria

- [ ] `apps/manual/README.md` lists every environment, protection rule, secret, token permission and variable the owner must create, by exact name
- [ ] With a secret missing, the job fails at its first step with a message naming that secret; with `BOOK_DEPLOY_ENABLED` unset, a push to `main` skips the deploy job
- [ ] The guard fails on each of its seven rules, in its tests
- [ ] After the owner's setup, https://manual.buildanagent.fyi/ serves the built book with the `_headers` values present
- [ ] A pull request gets a `workers.dev` preview that carries `X-Robots-Tag: noindex`, from a deploy run that never ran the pull request's code with secrets; closing it deletes the preview. A fork's pull request gets a preview too, and a fork's branch named `main` gets a preview, never a production deploy
- [ ] Editing `book-deploy.yml` on a pull request's branch changes nothing that runs with the secrets
- [ ] `gh actions-lock --verify` passes, and no account identifier is committed
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`node --test` over the guard's and the secrets check's tests in `pnpm test`. The first live deploy and one preview are checked by hand after the owner's setup and recorded in the pull request or a follow-up comment.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout: `book-deploy.yml` in the workflows line
- `apps/manual/README.md`: the owner's checklist, how deploys and previews work, and how to turn deploys off

## Risks and open questions

- Nothing deploys until the owner's setup is done (plan risk 5); the fail-closed check keeps a half-done setup from deploying.
- A deploy job that ran branch code would expose a token (plan risk 7); DS3's split means it never does, and the preview token is separate, holds Editor on the book's Worker only, and has no zone permission.
- `preview_urls: true` also turns on Version URLs, which serve production resources; the book has none beyond static files, so this exposes nothing new.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
