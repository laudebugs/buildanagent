# 0052. Build the book as a static Astro site, checked at build time, and deploy it as an assets-only Worker

- **Status:** Proposed
- **Date:** 2026-11-19
- **Plan:** [Book plan, BK3, BK4 and BK15](../plans/build-book.md#bk3-a-static-astro-site-with-no-adapter-a-unified-markdown-pipeline-and-pagefind-proposed)

## Context

[ADR 0051](0051-book-in-apps-on-cloudflare.md) puts a public book at `apps/book` and on Cloudflare. The owner's garment engineering textbook runs Astro 7.4.2 with `@astrojs/cloudflare` 14.4.2, Wrangler 4.153.0 and Pagefind 1.5.2 at commit `bca44b0`. It needs the adapter and a Worker only to check sign-in in front of its pages. Cloudflare documents a static Astro build deployed with an `assets.directory` and no `main` ([Cloudflare, Astro](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)). It also documents custom domains through `routes` with `custom_domain: true` ([custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)), and per-branch Previews through `wrangler preview`, from Wrangler 4.135.0 ([Previews](https://developers.cloudflare.com/workers/previews/)).

## Decision

- **Stack.** The book uses Astro 7.4.11 in static output with no adapter, and chapters in Markdown through the `unified()` processor of `@astrojs/markdown-remark` 7.3.8. It adds `remark-directive` 4.0.0 for listings, tabs and asides, and runs Pagefind 1.6.0 over the built site. Wrangler 4.160.1 deploys it. Each pin was the newest release at least a week old on 2026-11-19.
- **Workspace.** `apps/*` joins `pnpm-workspace.yaml`, added by whichever of L5, L7 or T1 lands first. The book is the private package `@buildanagent/book`, with `build`, `check:book`, `typecheck` and `test` scripts, so the root scripts cover it.
- **Checks at build time.** The build computes chapter, figure, listing and table numbers from the outline. It fails on an unknown citation, cross-reference or glossary term, and on a figure without alt text or a caption. It also fails on a listing whose file, region or package is missing.
- **Deploy.** One `wrangler.jsonc` describes an assets-only Worker on the custom domain manual.buildanagent.fyi, with `not_found_handling: "404-page"`, `workers_dev: false` and `preview_urls: true`. It is JSONC rather than the TOML the docs and website use, because Cloudflare recommends `wrangler.jsonc` for new projects and says some newer Wrangler features need a JSON config. A guard script checks that configuration before every deploy.
- **Workflows.** Deploys run from GitHub Actions, not Cloudflare's Workers Builds, by the owner's choice (2026-11-19: "We'll set up gh actions with cloudflare"). They follow the publish-and-docs plan's DS3 split. `book-build.yml` builds with no secrets on every pull request and push to `main`, and uploads `dist/`. `book-deploy.yml` runs on `workflow_run` from `main` and never runs pull-request code. It deploys production from the `book-production` environment only for a push to `main` while the repository variable `BOOK_DEPLOY_ENABLED` is `true`, and never cancels a deploy mid-way. Every other run, a fork's included, gets a Preview on `workers.dev` from the `book-preview` environment.

## Consequences

- The owner creates the buildanagent.fyi zone in the deploy account, the `book-production` and `book-preview` GitHub environments with their protection rules, and the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. The owner also creates two account-owned tokens: production gets Workers Editor plus Workers Routes Write on the zone, and preview gets Workers Editor on the book's Worker only. The owner creates the book's Worker itself once, with Admin rights, so the stored tokens never need them. T9 writes against those names and fails closed when one is missing.
- Todos T1, T3, T4 and T9 build these pieces, and T8 writes `book-build.yml`, the build half of the split. Every action they add is locked in `.github/workflows/actions.lock`.
- `@astrojs/check` 0.9.12 accepts TypeScript 5 or 6, while the root pins TypeScript 7.0.2, so T1 checks the book's `.ts` files with the root `tsc` and records whether `astro check` can run.
- If the book later needs server code, `@astrojs/cloudflare` (14.4.7 by the same rule) and a `main` entry return through a new record that supersedes this one.
