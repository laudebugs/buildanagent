# L8: Deploy both sites to Cloudflare, with a Preview per pull request

| Field | Value |
| --- | --- |
| ID | `L8` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L5](../done/L5-docs-app.md), [L7](L7-website-app.md) |
| Size | M |

## Goal

Deploy `apps/site` to `buildanagent.fyi` and `apps/docs` to `docs.buildanagent.fyi` as Workers static assets, with a Cloudflare Preview for each pull request ([DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted), ADR 0049).

## Context

- [DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted) and [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md)
- Cloudflare's [Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/) and [Previews](https://developers.cloudflare.com/workers/previews/)
- Lamina PDF's `apps/docs/wrangler.toml` and `.github/workflows/docs.yml` (split build and deploy jobs)

## Scope

**In scope**

- A `wrangler.toml` per app: `[assets] directory = "./dist"`, `not_found_handling = "404-page"`, a custom domain with `custom_domain = true`, `workers_dev = false`, `preview_urls = true` (Previews are served on `workers.dev`, and a new Worker's `preview_urls` starts from `workers_dev`); the docs app also has `[env.next]` for `next.docs.buildanagent.fyi`
- Wrangler pinned (4.160.1 on 2026-11-19, or newer and at least a week old; Previews need 4.135.0 or later)
- `docs-build.yml` and `site-build.yml` on `pull_request` and pushes to `main`: build the site with no secrets and upload only `dist/` as an artifact
- `docs-pr-closed.yml` and `site-pr-closed.yml` on `pull_request: [closed]`, copying the book's `book-pr-closed.yml`: no secret, no checkout and no action, only a run that starts the deploy workflow
- `docs-deploy.yml` and `site-deploy.yml` on `workflow_run` after their build or pr-closed workflow, which GitHub always runs from `main`:
  - Run in `environment: cloudflare`, whose deployment branches are limited to `main` and which holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` ([plan §3](../../plans/publish-and-docs.md#3-what-the-owner-sets-up)).
  - Download the artifact, take `wrangler.toml` from `main`, and never check out or run the pull request's code.
  - Deploy production only when `github.event.workflow_run.event == 'push'`, `github.event.workflow_run.head_repository.full_name == github.repository` and the head branch is `main`.
  - For a pull request from a branch of this repository, run `wrangler preview`, and find the pull request for the comment from `GET /repos/{repo}/commits/{head_sha}/pulls`, never from the artifact. A fork's pull request gets no preview.
  - After a pull request closes, delete its preview with `wrangler preview delete` and update its comment.
- Confirming the deploy token's permissions against Cloudflare's docs, and recording them in the CI plan
- The docs' version policy, DS4, in `docs-deploy.yml`:
  - The `workflow_run` path deploys `main` to `docs.buildanagent.fyi` while no release tag exists, and to `next.docs.buildanagent.fyi` (marked unreleased and `noindex`) once one does.
  - The `workflow_dispatch` path, which `release.yml` starts on `main` with `-f tag=v<version>`, builds the docs at that tag and deploys production. The input must be named `tag`, because `release.yml` sends `-f tag=v<version>`; until this workflow exists, `release.yml` skips the dispatch ([CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19)).

**Out of scope** (and which todo covers it)

- Search, analytics

## Acceptance criteria

- [ ] A pull request that changes `apps/docs` gets a Preview URL in a comment, from a `workflow_run` deploy that never ran the pull request's code with secrets
- [ ] Editing a deploy workflow on a pull request's branch changes nothing that runs with the secrets
- [ ] A push to `main` updates `buildanagent.fyi`, and `docs.buildanagent.fyi` serves the docs over HTTPS
- [ ] A fork's pull request builds both sites and gets no preview, and a fork pull request from a branch named `main` gets no production deploy (changed from "gets previews", pending the owner's confirmation; see the Outcome)
- [ ] A `workflow_dispatch` of `docs-deploy.yml` with a tag deploys that tag's docs to production; with no tag present, a push to `main` deploys production, and with one present it deploys `next.docs.buildanagent.fyi`
- [ ] Every new workflow and action is in `.github/workflows/actions.lock`: run `gh actions-lock`, or copy verified entries and check each tag's commit with `git ls-remote` ([CI plan §3d](../../plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)); `ci.yml`'s `lockfile` job passes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The preview, recorded in the pull request description.

## Docs to update

CI plan (a sites section), AGENTS.md's `.github/workflows/` line, README.md (site links), the plan's todo table.

## Risks and open questions

The owner's Cloudflare setup (§3) must exist first; without the secrets the deploy job skips with a notice.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Done 2026-11-22. The wrangler configs, the stage and guard scripts, their tests and the six workflow files are built, and the docs are written ([CI plan §3g](../../plans/ci.md#3g-both-sites-deploy-to-cloudflare-with-a-preview-per-pull-request-l8-added-2026-11-22)). Nothing is deployed, because a session may not edit `.github/`: the six workflow files sit in `scripts/ci/site-workflows/` until the owner moves them, so every acceptance box that needs a deploy stays unticked. The owner checklist is in [CI plan §3g](../../plans/ci.md#3g-both-sites-deploy-to-cloudflare-with-a-preview-per-pull-request-l8-added-2026-11-22).

**What shipped.**
- `apps/site/wrangler.toml` and `apps/docs/wrangler.toml`: assets-only Workers (`buildanagent-site`, `buildanagent-docs`, and `buildanagent-docs-next` as the docs' `[env.next]`) with a custom domain each.
- `scripts/ci/site-stage-dist.mjs` and `scripts/ci/site-guard-deploy.mjs`, with `scripts/ci/site-deploy.test.mjs`. A `required` option on `readEntries` in `apps/manual/scripts/stage-dist.mjs` lets each site name its required pages.
- `scripts/ci/sites-workflows.test.mjs`, which reads the workflows from `.github/workflows/` once `docs-deploy.yml` is there, otherwise from `SITES_WORKFLOWS_DIR`, otherwise from `scripts/ci/site-workflows/`, so CI runs it on the staged files.
- Wrangler 4.160.1, the book's pin, as a devDependency of both apps.
- Six workflows, staged with `actions.lock-additions.txt`: `docs-build.yml`, `site-build.yml`, `docs-deploy.yml`, `site-deploy.yml`, `docs-pr-closed.yml` and `site-pr-closed.yml`. The jobs and their checks are in §3g.
- Mutation checks of the workflow tests: the session that fixed the review findings ran 26 deliberate mutations of the drafts and then 11 more, and every one made the tests fail (its own counts, not independently checked).

**Decisions.**
- *One environment, `cloudflare`, not the book's two.* Rejected: a preview environment with its own token, which would likely deploy production too and add a setup step for no isolation (§3g, "One GitHub environment").
- *Previews only for pull requests from this repository's branches, which departs from DS3 and from this todo's first acceptance line (pending the owner's confirmation, checklist item 1).* Rejected: previews for forks too, because a fork's artifact could hold any HTML or script (§3g, "Previews are `workers.dev` previews").
- *Delete a preview when its pull request closes, through a pr-closed workflow like the book's.* Rejected: leaving it for Cloudflare's limit of 100 and 500, and a `pull_request: closed` job that holds the token, which would run the pull request's own copy of the file.
- *The guard compares the config's significant lines with an expected list.* Rejected: parsing the TOML, which could read the file differently from Wrangler.
- *Production sits behind `SITE_DEPLOY_ENABLED` and `DOCS_DEPLOY_ENABLED`; previews do not.* Rejected: one switch for both sites.
- *A separate `secrets` job leaves a notice when a secret is missing.* Rejected: letting the deploy jobs fail, which would turn every pull request red until the owner finishes setup.
- *DS4 reads the tag list, counts only `^v\d+\.\d+\.\d+$`, and builds a release from its resolved SHA.* Rejected: trusting the tag input or its name, which could move (§3g, "DS4's version policy").

**Not done.** A visible "unreleased" banner on `next.docs.buildanagent.fyi` (it needs a docs-app change), path filters, and a `404.html` for `apps/site`.

**Documented limits and what no session could verify.** Both lists are in [CI plan §3g](../../plans/ci.md#3g-both-sites-deploy-to-cloudflare-with-a-preview-per-pull-request-l8-added-2026-11-22): five limits, and the untested behaviours of previews, `wrangler preview --env ""`, `commits/{sha}/pulls`, `404-page` and the first deploy's DNS permission.
