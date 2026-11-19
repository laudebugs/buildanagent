# L8: Deploy both sites to Cloudflare, with a Preview per pull request

| Field | Value |
| --- | --- |
| ID | `L8` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L5](L5-docs-app.md), [L7](L7-website-app.md) |
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
- `docs-deploy.yml` and `site-deploy.yml` on `workflow_run` after their build workflow, which GitHub always runs from `main`: download the artifact, take `wrangler.toml` from `main`, and never check out or run the pull request's code. Deploy production only when `github.event.workflow_run.event == 'push'`, `github.event.workflow_run.head_repository.full_name == github.repository` and the head branch is `main`; otherwise run `wrangler preview`, and find the pull request for the comment from `GET /repos/{repo}/commits/{head_sha}/pulls`, never from the artifact
- Confirming the deploy token's permissions against Cloudflare's docs, and recording them in the CI plan
- The docs' version policy, DS4: `docs-deploy.yml`'s `workflow_run` path deploys `main` to `docs.buildanagent.fyi` while no release tag exists, and to `next.docs.buildanagent.fyi` (marked unreleased and `noindex`) once one does; its `workflow_dispatch` path, which `release.yml` starts with the tag, builds the docs at that tag and deploys production

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

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
