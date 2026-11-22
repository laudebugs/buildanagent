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

Done 2026-11-22. The wrangler configs, the stage and guard scripts, their tests and the six workflow files are built, and the docs are written ([CI plan §3g](../../plans/ci.md#3g-both-sites-deploy-to-cloudflare-with-a-preview-per-pull-request-l8-added-2026-11-22)). Nothing is deployed, because a session may not edit `.github/`: the six workflow files sit in `scripts/ci/site-workflows/` until the owner moves them, so every acceptance box that needs a deploy stays unticked.

**What shipped.**
- `apps/site/wrangler.toml` and `apps/docs/wrangler.toml`: assets-only Workers (`buildanagent-site`, `buildanagent-docs`, and `buildanagent-docs-next` as the docs' `[env.next]`), with `workers_dev = false`, `preview_urls = true` and a custom domain each.
- `scripts/ci/site-stage-dist.mjs` and `scripts/ci/site-guard-deploy.mjs`, with `scripts/ci/site-deploy.test.mjs`. A `required` option on `readEntries` in `apps/manual/scripts/stage-dist.mjs` lets each site name its required pages.
- `scripts/ci/sites-workflows.test.mjs`, which reads the workflows from `.github/workflows/` once `docs-deploy.yml` is there, otherwise from `SITES_WORKFLOWS_DIR`, otherwise from `scripts/ci/site-workflows/`, so CI runs it on the staged files. Against the six staged files it passes with the stage and guard tests (213 tests, no environment variable).
- Wrangler 4.160.1, the book's pin, as a devDependency of `apps/docs` and `apps/site`; the lockfile gained only importer links.
- Six workflows, staged in `scripts/ci/site-workflows/` for the owner to move into `.github/workflows/`, with `actions.lock-additions.txt` beside them: `docs-build.yml`, `site-build.yml`, `docs-deploy.yml`, `site-deploy.yml`, `docs-pr-closed.yml` and `site-pr-closed.yml`. Each deploy workflow has a `delete-preview` job and a `comment-deleted` job, and the production job checks for a stable tag again just before it deploys and, after it, whether a release deployed during its window. A step "Record when the deploy ended" closes the window (the end time plus 60 seconds): a release `Deploy` step that ended inside it is an error, and one that ended later passes with a notice, because that is the correct order. Job and step names reach the check through `JOB_NAME` and `STEP_NAME`, and a test pins them. A `preview` job that finds its pull request closed deletes the preview itself with the `delete-preview` job's script (a YAML anchor shares it), because a waiting deletion may have been cancelled when the preview joined the concurrency group.

**Decisions.**
- *One environment, `cloudflare`, not the book's two.* Rejected: a preview environment with its own token. Cloudflare's roles page lists no role for previews alone, so that token would likely deploy production too, and a second environment would add a setup step for no isolation.
- *Previews only for pull requests from this repository's branches, which departs from DS3 and from this todo's first acceptance line (pending the owner's confirmation).* Rejected: previews for forks too. An Opus security review of the first drafts found that a fork's build runs the fork's own workflow file, so its artifact could hold any HTML or script, and a preview would serve it publicly from our `workers.dev` subdomain under the owner's Cloudflare account. A fork's pull request still builds and passes its checks, and a maintainer can push its change to a branch for a preview. The book chose the same on 2026-11-19. DS3 and CI plan §3g record the change.
- *Delete a preview when its pull request closes, through a pr-closed workflow like the book's.* Rejected: leaving it for Cloudflare's 100 and 500 limit. A `pull_request: closed` job holding the token would run the pull request's own copy of the file, so the pr-closed files hold nothing and only start `main`'s deploy workflow.
- *The guard compares the config's significant lines with an expected list.* Rejected: parsing the TOML, which could read the file differently from Wrangler.
- *Production sits behind `SITE_DEPLOY_ENABLED` and `DOCS_DEPLOY_ENABLED`; previews do not.* Rejected: one switch for both sites, so the owner can turn them on one at a time.
- *A separate `secrets` job leaves a notice when a secret is missing.* Rejected: letting the deploy jobs fail, which would turn every pull request red until the owner finishes setup.
- *DS4 reads the tag list, counts only `^v\d+\.\d+\.\d+$`, and builds a release from its resolved SHA.* Rejected: trusting the tag input or its name, which could move.

**Not done.** A visible "unreleased" banner on `next.docs.buildanagent.fyi` (it needs a docs-app change), path filters, and a `404.html` for `apps/site`.

**Documented limits.** One `cloudflare` environment and token serve previews and production alike, mitigated by the artifact check and by `wrangler.toml` and the scripts coming from `main`; Cloudflare's roles page lists no role for previews alone, and that a preview token could deploy production anyway is the book's inference. Only `next.docs.buildanagent.fyi` is `noindex`. A fork's pull request can name `main`'s build concurrency group and cancel a running build of `main`, because GitHub gives the fork's copy of the file control of the group; the repository's fork-approval setting is the control (checklist step 8), and the book has the same exposure.

**Changed after the security review.** The tests now compare every job's `if:` exactly and run both `resolve` steps and the record, delete and comment scripts against a stand-in `gh` and crafted files. All 26 deliberate mutations of the drafts failed the tests, and so did 11 more made for the later changes (the fixer's own counts, not independently checked). A later change added three checks: a step before `Deploy` in the docs' `production` and `next` jobs and the website's `production` job that skips the deploy when `main` has moved on; a step before each preview deploy that skips it unless the pull request is still open at that commit (the preview jobs gained `pull-requests: read`); and a rewritten step after the docs' production deploy that fails only if a release's `Deploy` step succeeded since the push's window opened. The head repository's name is validated before it enters `jq`, and values reach `jq` through `--arg`. The production concurrency group is `docs-production-${{ github.event_name }}`, so a waiting push cannot replace a waiting release.

**Documented limits, added later.** A pull request that closes between the still-open check and `wrangler preview` can leave a preview behind. The `secrets` job names the `cloudflare` environment, so each preview or deletion run records a second, URL-less deployment on the pull request; required reviewers added to the environment would mean two approvals per deploy.

**Not verified** (nothing has been deployed). A preview with `workers_dev = false` and `preview_urls = true` getting a `workers.dev` address; `wrangler preview --env ""` and `--ignore-base-config`; `commits/{sha}/pulls` returning a fork's pull request; that `404-page` serves the nearest `404.html` with status 404, which the Cloudflare pages L8 read do not state; and whether the first deploy needs a DNS permission.

**Owner checklist.** The `cloudflare` environment and its two secrets already exist.
1. Move the six workflow files with `git mv` from `scripts/ci/site-workflows/` to `.github/workflows/`: `docs-build.yml`, `docs-deploy.yml`, `docs-pr-closed.yml`, `site-build.yml`, `site-deploy.yml` and `site-pr-closed.yml`. Append the six entries that `actions.lock-additions.txt` holds (its last 24 lines) under `workflows:` in `.github/workflows/actions.lock`, which lists paths alphabetically: `docs-build.yml`, `docs-deploy.yml` and `docs-pr-closed.yml` after `ci.yml`, and `site-build.yml`, `site-deploy.yml` and `site-pr-closed.yml` after `sdk-updates.yml`. The two pr-closed files use no action, so each gets `[]`. Every other action is already locked at the same tag, so nothing is added under `dependencies:`; `gh actions-lock` writes the entries. Delete `actions.lock-additions.txt` and commit.
2. Confirm `buildanagent.fyi` is an active zone in account `a63390b6aa6bd02439170924d65df57f`.
3. Check that the apex, `docs.` and `next.docs.` have no CNAME record, because Cloudflare refuses a custom domain on a hostname that has one. Its docs say nothing about A or AAAA records.
4. Create the three Workers once by hand (`buildanagent-site`, `buildanagent-docs`, `buildanagent-docs-next`), because Workers Scripts Write maps to Editor, which cannot create Workers.
5. Leave DNS Write off the token. Cloudflare's docs list only Zone > Workers Routes > Write for a custom domain and say Cloudflare creates the DNS record itself. If the first deploy fails at the domain step, a CNAME conflict is the likelier cause, and an error that names DNS would point to DNS Write.
6. Keep Workers Routes Write until `next.docs.buildanagent.fyi` is attached, which happens on the first deploy after the first stable release; then it can come off.
7. Set the repository variables `SITE_DEPLOY_ENABLED` and `DOCS_DEPLOY_ENABLED` to `true`.
8. Under the repository's Actions settings, set fork pull request workflows to "Require approval for all outside collaborators", if not already set.
9. Once `docs-deploy.yml` is on `main`, `release.yml` starts dispatching it for each stable release ([CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19)).
10. Do not add required reviewers to the `cloudflare` environment without expecting two approvals per deploy, because the `secrets` job and the deploy job each name it.
