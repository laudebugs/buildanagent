# 0049. Serve the website at buildanagent.fyi and the docs at docs.buildanagent.fyi, both on Cloudflare Workers static assets

- **Status:** Accepted (owner, 2026-11-19), including Workers static assets, per-PR Previews and the docs' version policy
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, DS2 to DS4](../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted)

## Context

The owner said on 2026-11-19 "We'll use cloudflare to deploy docs and the website - buildanagent.fyi", and chose two sites over one. Cloudflare's Astro guide deploys a static Astro site to Workers with static assets and no Worker script, and Cloudflare recommends Previews over Version URLs for testing a pull request ([Cloudflare docs](https://developers.cloudflare.com/workers/previews/compare-workflows/)).

## Decision

`apps/site` serves `buildanagent.fyi` and `apps/docs` serves `docs.buildanagent.fyi`. Each deploys as Workers static assets, with its custom domain in its `wrangler.toml`, `workers_dev` off and `preview_urls` on, because Previews are served on `workers.dev`. A pull request's sites build in a workflow with no secrets, and deploy as Cloudflare Previews from a separate `workflow_run` workflow that GitHub always runs from `main`. Only that workflow holds the Cloudflare token, and it never checks out or runs the pull request's code. It deploys production only for a `push` run from this repository to `main`, and it finds a preview's pull request from the run's `head_sha` through the API, not from the artifact. The docs serve `main` until 0.1.0 ships, then the latest release, with `main` at `next.docs.buildanagent.fyi`; `release.yml` starts the release deploy with a `workflow_dispatch`, which GitHub runs even when `GITHUB_TOKEN` sends it.

## Consequences

- The owner adds the `buildanagent.fyi` zone and two GitHub secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (todo L8).
- Fork pull requests get previews too, because the secrets live only in the deploy workflow.
- The token's permissions (Workers Scripts edit, Zone Workers Routes edit) come from Lamina PDF's config and are confirmed in todo L8; Cloudflare creates each custom domain's DNS record and certificate ([Cloudflare docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
- All four site workflows go in `.github/workflows/actions.lock`.
