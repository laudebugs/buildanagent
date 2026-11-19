# T1: Scaffold `apps/book`: workspace wiring, pins, a static build and Pagefind

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T1` |
| Status | `ready` |
| Plan | [Book plan §5, BK3 and BK4](../../plans/build-book.md#5-round-t-and-its-todos) |
| Round / milestone | Round T (textbook), MT |
| Depends on | None |
| Size | M |

## Goal

Create the book's package so every later Round T todo has a site to build into. The scaffold proves the stack the plan proposes: Astro in static output with no adapter, Markdown through the `unified()` processor, Pagefind over the built site, and a package the root scripts already cover. It also settles whether `astro check` runs under TypeScript 7, and records in LICENSE that code derived from the garment repository is Apache-2.0.

## Context

- [Book plan BK3 and BK4](../../plans/build-book.md#bk3-a-static-astro-site-with-no-adapter-a-unified-markdown-pipeline-and-pagefind-proposed): the stack, the pins and the scripts.
- [ADR 0051](../../decisions/0051-book-in-apps-on-cloudflare.md) and [ADR 0052](../../decisions/0052-book-stack-and-deploy.md): the folder, the licences and the stack.
- [AGENTS.md coding standards](../../../AGENTS.md#coding-standards): exact pins, releases at least a week old, pnpm only, `onlyBuiltDependencies`.
- The garment repository's `astro.config.mjs` at commit `bca44b0`: the render-input hash that clears Astro's content cache ([ADR 0053](../../decisions/0053-reuse-garment-textbook-code.md)).

## Scope

**In scope**

- `apps/*` in `pnpm-workspace.yaml` if L5 or L7 has not added it, and `apps/book/package.json` as the private `@buildanagent/book`, with Astro 7.4.11, the pin `apps/docs` uses ([DS1](../../plans/publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted))
- `astro.config.mjs` with static output, `trailingSlash: 'always'`, the `unified()` processor and the render-input hash
- One placeholder chapter, the build script `astro build && pagefind --site dist`, and a search page
- `apps/book` in LICENSE under both terms, and the first THIRD-PARTY-NOTICES.md entry for the garment repository

**Out of scope** (and which todo covers it)

- The design tokens and components ([T2](T2-book-design.md))
- The content model and its checks ([T3](T3-book-content-model.md))
- CI and deploy ([T8](T8-book-ci.md), [T9](T9-book-deploy.md))

## Tasks

- [ ] Re-run `npm view <package> time` for `astro`, `@astrojs/markdown-remark`, `pagefind`, `remark-directive`, `unist-util-visit` and `wrangler`, and pin the newest release at least a week old; update BK3's table if a pin moves.
- [ ] Confirm that CI's `node-version-file: .nvmrc` and a fresh local install both resolve Node 22 to 22.23.4 or later, which Astro 7.4.11's `engines` requires; if not, pin `.nvmrc` to a full version in its own commit.
- [ ] Add `apps/*` to `pnpm-workspace.yaml` only if it is not there yet: whichever of [L5](L5-docs-app.md), [L7](L7-website-app.md) or this todo lands first adds it ([DS2](../../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted)). Then create `apps/book` with `build`, `dev`, `check:book`, `typecheck` and `test` scripts, following `apps/docs` and `apps/site` where they exist (private `@buildanagent/<name>` packages, the same Astro pin), and install with `pnpm install` at the root.
- [ ] Write `astro.config.mjs` with the render-input hash adapted from the garment repository, with a header comment naming its origin, the source commit and its Apache-2.0 licence, and add the THIRD-PARTY-NOTICES.md section.
- [ ] Add `data-pagefind-body` to the chapter layout only, and a search page that loads Pagefind's UI.
- [ ] Try `astro check` under the root's TypeScript 7.0.2; if it fails, type-check the book's `.ts` files with `tsc -p` and record the result in the plan's risks.
- [ ] Add `apps/book` to LICENSE: prose and figures under CC BY 4.0; code and figure generators under Apache-2.0 OR MIT, except files derived from the garment repository, which are Apache-2.0 only (the owner's answer, 2026-11-19: "Apache 2.0"; [ADR 0053](../../decisions/0053-reuse-garment-textbook-code.md)).

## Acceptance criteria

- [ ] `pnpm --filter @buildanagent/book build` writes `apps/book/dist/` with one chapter page and a working `dist/pagefind/` index
- [ ] Every dependency in `apps/book/package.json` is pinned exactly to a release at least a week old on the day of the pull request
- [ ] The root `pnpm typecheck` and `pnpm test` run the book's `typecheck` and `test` scripts
- [ ] THIRD-PARTY-NOTICES.md names the garment repository, its commit and the copied file; LICENSE names `apps/book`
- [ ] LICENSE records that files derived from the garment repository are Apache-2.0, and each such file opens with a header comment naming its origin and licence
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

A Vitest smoke test in `apps/book/test/` runs the Markdown processor on a fixture chapter. The build itself is the main check.

## Docs to update

- The plan's BK3 pins and risks, if they change
- [AGENTS.md](../../../AGENTS.md) layout and the root [README](../../../README.md), if the `apps/` lines added with the plan need detail

## Risks and open questions

- `astro check` may not support TypeScript 7 (plan risk 2).
- A new pin may need an `onlyBuiltDependencies` entry (for example `sharp` if Astro's image service loads it); allow only what the build needs.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
