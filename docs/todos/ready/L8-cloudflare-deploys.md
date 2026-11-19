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

Deploy `apps/site` to `buildanagent.fyi` and `apps/docs` to `docs.buildanagent.fyi` as Workers static assets, with a Cloudflare Preview for each pull request ([DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-proposed), ADR 0049).

## Context

- [DS3](../../plans/publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-proposed) and [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md)
- Cloudflare's [Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/) and [Previews](https://developers.cloudflare.com/workers/previews/)
- Lamina PDF's `apps/docs/wrangler.toml` and `.github/workflows/docs.yml` (split build and deploy jobs)

## Scope

**In scope**

- A `wrangler.toml` per app: `[assets] directory = "./dist"`, `not_found_handling = "404-page"`, a custom domain with `custom_domain = true`, `workers_dev = false`; the docs app also has `[env.next]` for `next.docs.buildanagent.fyi`
- Wrangler pinned (4.160.1 on 2026-11-19, or newer and at least a week old; Previews need 4.135.0 or later)
- `site.yml` and `docs.yml`: a build job with no secrets that uploads `dist/`, and a deploy job that holds the Cloudflare secrets, never checks out or runs the pull request's code, takes `wrangler.toml` from `main`, and runs `wrangler preview` for pull requests or `wrangler deploy` for `main`
- The docs deploy `main` to `docs.buildanagent.fyi` until 0.1.0 ships; after it, release tags deploy production and `main` deploys `next`, marked unreleased and `noindex`

**Out of scope** (and which todo covers it)

- Search, analytics

## Acceptance criteria

- [ ] A pull request that changes `apps/docs` gets a Preview URL in a comment, from a job that never ran the pull request's code with secrets
- [ ] A push to `main` updates `buildanagent.fyi`, and `docs.buildanagent.fyi` serves the docs over HTTPS
- [ ] A fork's pull request builds both sites and skips the deploy without failing
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
