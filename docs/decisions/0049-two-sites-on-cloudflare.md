# 0049. Serve the website at buildanagent.fyi and the docs at docs.buildanagent.fyi, both on Cloudflare Workers static assets

- **Status:** Accepted (owner, 2026-11-19) for two sites on Cloudflare at these domains; Proposed for Workers static assets and per-PR Previews
- **Date:** 2026-11-19
- **Plan:** [publish-and-docs.md, DS2 and DS3](../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted)

## Context

The owner said on 2026-11-19 "We'll use cloudflare to deploy docs and the website - buildanagent.fyi", and chose two sites over one. Cloudflare's Astro guide deploys a static Astro site to Workers with static assets and no Worker script, and Cloudflare recommends Previews over Version URLs for testing a pull request ([Cloudflare docs](https://developers.cloudflare.com/workers/previews/compare-workflows/)).

## Decision

`apps/site` serves `buildanagent.fyi` and `apps/docs` serves `docs.buildanagent.fyi`. Each deploys as Workers static assets, with its custom domain in its `wrangler.toml` and `workers_dev` off. A pull request's sites deploy as Cloudflare Previews from a job that holds the Cloudflare token but never runs the pull request's code. The docs serve `main` until 0.1.0 ships, then the latest release, with `main` at `next.docs.buildanagent.fyi`.

## Consequences

- The owner adds the `buildanagent.fyi` zone and two GitHub secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (todo L8).
- Fork pull requests get no preview, because they can't receive secrets.
