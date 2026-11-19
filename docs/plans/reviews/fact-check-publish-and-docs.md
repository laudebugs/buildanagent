# Fact-check: publish and docs

This log checks every factual claim in [publish-and-docs.md](../publish-and-docs.md), ADRs 0047–0050 and todos L1–L8, on 2026-11-19. External facts were read from the npm registry, npm's docs and Cloudflare's docs that day; repo claims were read from `main` at `eddc212`; Lamina PDF claims from `laudebugs/laminapdf` at `7b4b37b`.

## Owner decisions

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 1 | The owner reserved the `@buildanagent` scope on npm and said "We can start publishing as soon as we're ready to" | ✅ | Owner's messages, 2026-11-19 |
| 2 | The owner chose "0.1.0 once a model call works" | ✅ | Owner's answer, 2026-11-19 |
| 3 | The owner said "Changesets wait until we publish" | ✅ | Owner's message, 2026-11-19 |
| 4 | The owner asked "We also need to build documentation for the libraries" and chose Astro Starlight | ✅ | Owner's message and answer, 2026-11-19 |
| 5 | The owner said "We'll use cloudflare to deploy docs and the website - buildanagent.fyi" and chose two sites | ✅ | Owner's message and answer, 2026-11-19 |

## Versions (npm registry, 2026-11-19)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 6 | Astro 7.4.11 (2026-11-11) is the newest release at least a week old; the latest is 7.4.13 (2026-11-18) | ✅ | registry.npmjs.org/astro, `time` |
| 7 | Starlight 0.42.10 (2026-11-06) is the newest at least a week old; the latest is 0.43.1 (2026-11-13) | ✅ | registry.npmjs.org/@astrojs/starlight; its peer is `astro ^7.2.10` |
| 8 | `starlight-typedoc` 0.23.2 (2026-10-30) is the latest | ✅ | registry; peers `typedoc >=0.28.0`, `@astrojs/starlight >=0.39.0`, `typedoc-plugin-markdown >=4.6.0` |
| 9 | TypeDoc 0.28.20 (2026-07-05) is the latest and accepts TypeScript only up to 6.0 | ✅ | registry; peer `typescript` lists 5.0.x to 6.0.x |
| 10 | `typedoc-plugin-markdown` 4.14.1 (2026-10-19) is the latest | ✅ | registry; peer `typedoc 0.28.x` |
| 11 | TypeScript 6.0.3 (2026-04-16) is the newest 6.0 release | ✅ | registry.npmjs.org/typescript |
| 12 | `@changesets/cli` 3.0.3 (2026-09-14) is the latest | ✅ | registry |
| 13 | Wrangler 4.160.1 (2026-11-11) is the newest at least a week old; the latest is 4.165.0 (2026-11-18) | ✅ | registry |
| 14 | `starlight-links-validator` 0.27.0 (2026-10-09) is the latest | ✅ | registry; peers `astro >=7.2.10`, `@astrojs/starlight >=0.42.0` |
| 15 | The repo builds with TypeScript 7.0.2 | ✅ | root `package.json` |

## npm trusted publishing

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 16 | Trusted publishing needs npm CLI 11.5.1 or later and Node 22.14.0 or later | ✅ | [npm docs](https://docs.npmjs.com/trusted-publishers): "requires npm CLI version 11.5.1 or later and Node version 22.14.0 or higher" |
| 17 | It needs `id-token: write` in the workflow | ✅ | npm docs: "The critical requirement is the id-token: write permission" |
| 18 | It accepts GitHub-hosted runners only, not self-hosted ones | ✅ | npm docs: "GitHub Actions (GitHub-hosted runners)… Self-hosted runners are not currently supported" |
| 19 | It adds provenance attestations by default | ✅ | npm docs: "npm automatically generates and publishes provenance attestations… by default" |
| 20 | A trusted publisher is configured on the package's settings page, by user, repository, workflow filename and optional environment | ✅ | npm docs, "Configuring trusted publishing" |
| 21 | A new trusted publisher must complete its first publish within 2 days, or it expires | ✅ | npm docs: "must complete its first successful publish within 2 days" |
| 22 | npm may require the package to exist before a trusted publisher can be added | ⚠️ | The docs describe the setup on "your package settings", which implies an existing package, but don't say so; the plan's risk 1 and todo L4 cover both cases |
| 23 | Node 22 ships npm 10, so the release job must install npm 11.5.1 or later | ⚠️ | From the Node 22 release line's bundled npm (10.x); not checked on today's runner image. L3 installs npm explicitly either way |

## Cloudflare

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 24 | Cloudflare deploys a static Astro site to Workers with static assets, an `[assets]` directory of `./dist`, and no `main` | ✅ | [Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/), "If you have a static site" |
| 25 | `not_found_handling = "404-page"` returns the nearest `404.html` with a 404 status | ✅ | [Static assets docs](https://developers.cloudflare.com/workers/static-assets/) |
| 26 | Cloudflare recommends Previews over Version URLs for branch and pull request testing | ✅ | [Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/): "Previews are the recommended way… Do not use Version URLs for branch or pull request testing" |
| 27 | Previews need Wrangler 4.135.0 or later, through `wrangler preview` | ✅ | [Previews](https://developers.cloudflare.com/workers/previews/) |
| 28 | `wrangler deploy` with `custom_domain = true` creates the DNS record and certificate | ✅ | Lamina PDF's `apps/docs/wrangler.toml` comment (secondary: a repo, not Cloudflare's docs) |
| 29 | The deploy token needs Workers Scripts edit and Zone Workers Routes edit on the zone | ⚠️ | Zone Workers Routes edit from Lamina's `wrangler.toml` comment; Workers Scripts edit is the usual Wrangler permission, not checked in Cloudflare's docs today |

## Lamina PDF

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 30 | Lamina's docs app runs Starlight with `starlight-typedoc` 0.23.2 and TypeDoc 0.28.20, and pins TypeScript for TypeDoc through a `typedoc` catalog | ✅ | `apps/docs/package.json`, `pnpm-workspace.yaml` |
| 31 | Lamina's Changesets config uses one `fixed` group, `access: public` and ignores its apps | ✅ | `.changeset/config.json` |
| 32 | Lamina's docs deploy as Workers static assets with `custom_domain`, `workers_dev = false` and `not_found_handling = "404-page"` | ✅ | `apps/docs/wrangler.toml` |
| 33 | Lamina's `docs.yml` builds a pull request's site with no secrets and deploys it from a job that never runs the pull request's code | ✅ | `.github/workflows/docs.yml` header |
| 34 | Lamina publishes to npm from a GitHub-hosted runner with an OIDC token | ✅ | `.github/workflows/release.yml`, `publish-npm` job |
| 35 | Lamina's packages export `dist/` with `types` first, `files`, `sideEffects: false` and `engines` | ✅ | `packages/sdk/package.json` |

## This repo

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 36 | ADR 0008 keeps both packages private until the owner chooses to publish, and makes a 0.x minor release that breaks the API carry a "Breaking Changes" entry | ✅ | [ADR 0008](../../decisions/0008-versioning-and-doc-checks.md) |
| 37 | B8 depends on B5, B6 and B7; B4 depends on B3 | ✅ | the todos' Depends on fields |
| 38 | B20 listed publishing and a docs website as out of scope | ✅ | [B20](../../todos/ready/B20-versioning-docs.md), before its revision |
| 39 | The TypeScript guideline says packages export `src/` until B20 decides how we publish | ✅ | [typescript.md](../../guidelines/typescript.md), before this change |
| 40 | Every new workflow must be in `.github/workflows/actions.lock`, which this session can't regenerate | ✅ | [CI plan §3d](../ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19) |
| 41 | Our documentation is licensed CC BY 4.0 | ✅ | `LICENSE` and `LICENSE-DOCS` |
| 42 | A pull request opened with `GITHUB_TOKEN` doesn't trigger `ci.yml` | ✅ | [CI plan §3c](../ci.md#3c-weekly-sdk-updates-added-2026-11-19), which records GitHub's rule |

**Totals:** 42 claims: 39 ✅, 0 ✏️, 3 ⚠️.
