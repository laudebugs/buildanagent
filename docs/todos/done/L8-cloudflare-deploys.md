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
- `docs-deploy.yml` and `site-deploy.yml` on `workflow_run` after their build workflow, which GitHub always runs from `main`:
  - Run in `environment: cloudflare`, whose deployment branches are limited to `main` and which holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` ([plan §3](../../plans/publish-and-docs.md#3-what-the-owner-sets-up)).
  - Download the artifact, take `wrangler.toml` from `main`, and never check out or run the pull request's code.
  - Deploy production only when `github.event.workflow_run.event == 'push'`, `github.event.workflow_run.head_repository.full_name == github.repository` and the head branch is `main`.
  - Otherwise run `wrangler preview`, and find the pull request for the comment from `GET /repos/{repo}/commits/{head_sha}/pulls`, never from the artifact.
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
- [ ] A fork's pull request builds both sites and gets previews, and a fork pull request from a branch named `main` gets a preview, not a production deploy
- [ ] A `workflow_dispatch` of `docs-deploy.yml` with a tag deploys that tag's docs to production; with no tag present, a push to `main` deploys production, and with one present it deploys `next.docs.buildanagent.fyi`
- [ ] Every new workflow and action is in `.github/workflows/actions.lock`: run `gh actions-lock`, or copy verified entries and check each tag's commit with `git ls-remote` ([CI plan §3d](../../plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)); `ci.yml`'s `lockfile` job passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

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

Done 2026-11-22. The wrangler configs, the stage and guard scripts, their tests and the four workflow drafts are built, and the docs are written ([CI plan §3g](../../plans/ci.md#3g-both-sites-deploy-to-cloudflare-with-a-preview-per-pull-request-l8-added-2026-11-22)). Nothing is deployed, because a session may not edit `.github/`: the owner commits the four workflow files, so every acceptance box that needs a deploy stays unticked.

**What shipped.**
- `apps/site/wrangler.toml` and `apps/docs/wrangler.toml`: assets-only Workers (`buildanagent-site`, `buildanagent-docs`, and `buildanagent-docs-next` as the docs' `[env.next]`), with `workers_dev = false`, `preview_urls = true` and a custom domain each.
- `scripts/ci/site-stage-dist.mjs` and `scripts/ci/site-guard-deploy.mjs`, with `scripts/ci/site-deploy.test.mjs`. A `required` option on `readEntries` in `apps/manual/scripts/stage-dist.mjs` lets each site name its required pages.
- `scripts/ci/sites-workflows.test.mjs`, which skips until the workflows are committed or `SITES_WORKFLOWS_DIR` names a directory that holds them. Against the four drafts it passes with the stage and guard tests (63 tests).
- Wrangler 4.160.1, the book's pin, as a devDependency of `apps/docs` and `apps/site`; the lockfile gained only importer links.
- Four workflows, `docs-build.yml`, `site-build.yml`, `docs-deploy.yml` and `site-deploy.yml`, handed to the owner to commit into `.github/workflows/`.

**Decisions.**
- *One environment, `cloudflare`, not the book's two.* Rejected: a preview environment with its own token. Cloudflare's roles page lists no role for previews alone, so that token would likely deploy production too, and a second environment would add a setup step for no isolation.
- *`workers.dev` previews for every pull request, forks included, as DS3 says.* Rejected: previews only for pull requests from this repository. The cost is that a fork's static content is publicly served on our `workers.dev` subdomain, marked `noindex`.
- *The guard compares the config's significant lines with an expected list.* Rejected: parsing the TOML, which could read the file differently from Wrangler.
- *Production sits behind `SITE_DEPLOY_ENABLED` and `DOCS_DEPLOY_ENABLED`; previews do not.* Rejected: one switch for both sites, so the owner can turn them on one at a time.
- *A separate `secrets` job leaves a notice when a secret is missing.* Rejected: letting the deploy jobs fail, which would turn every pull request red until the owner finishes setup.
- *DS4 reads the tag list, counts only `^v\d+\.\d+\.\d+$`, and builds a release from its resolved SHA.* Rejected: trusting the tag input or its name, which could move.

**Not done.** A visible "unreleased" banner on `next.docs.buildanagent.fyi` (it needs a docs-app change), deleting a preview when its pull request closes (Cloudflare keeps 100 on the Free plan and 500 on a paid one, and deletes the oldest), path filters, and a `404.html` for `apps/site`.

**Not verified** (nothing has been deployed). A preview with `workers_dev = false` and `preview_urls = true` getting a `workers.dev` address; `wrangler preview --env ""` and `--ignore-base-config`; `commits/{sha}/pulls` returning a fork's pull request; that `404-page` serves the nearest `404.html` with status 404, which the Cloudflare pages L8 read do not state; and whether the first deploy needs a DNS permission.

**Owner checklist.** The `cloudflare` environment and its two secrets already exist.
1. Commit the four workflow files into `.github/workflows/`, and add four entries under `workflows:` in `.github/workflows/actions.lock` (`docs-build.yml` and `docs-deploy.yml` after `ci.yml`, `site-build.yml` and `site-deploy.yml` after `sdk-updates.yml`). Every action they use is already locked at the same tag, so no `dependencies:` entry is needed; `gh actions-lock` writes the entries.
2. Confirm `buildanagent.fyi` is an active zone in account `a63390b6aa6bd02439170924d65df57f`.
3. Check that the apex, `docs.` and `next.docs.` have no CNAME record, because Cloudflare refuses a custom domain on a hostname that has one. Its docs say nothing about A or AAAA records.
4. Create the three Workers once by hand (`buildanagent-site`, `buildanagent-docs`, `buildanagent-docs-next`), because Workers Scripts Write maps to Editor, which cannot create Workers.
5. Leave DNS Write off the token. Cloudflare's docs list only Zone > Workers Routes > Write for a custom domain and say Cloudflare creates the DNS record itself. If the first deploy fails at the domain step, a CNAME conflict is the likelier cause, and an error that names DNS would point to DNS Write.
6. Keep Workers Routes Write until `next.docs.buildanagent.fyi` is attached, which happens on the first deploy after the first stable release; then it can come off.
7. Set the repository variables `SITE_DEPLOY_ENABLED` and `DOCS_DEPLOY_ENABLED` to `true`.
8. Once `docs-deploy.yml` is on `main`, `release.yml` starts dispatching it for each stable release ([CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19)).
