# T1: Scaffold `apps/manual`: workspace wiring, pins, a static build and Pagefind

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).
>
> **History:** during T1 the owner renamed the app (2026-11-19: "Let's make it @buildanagent/manual and apps/manual"), so the scaffold lives in `apps/manual` as `@buildanagent/manual`; the text below keeps the names it was written with.

| Field | Value |
| --- | --- |
| ID | `T1` |
| Status | `done` |
| Plan | [Book plan §5, BK3 and BK4](../../plans/build-book.md#5-round-t-and-its-todos) |
| Round / milestone | Round T (textbook), MT |
| Depends on | None |
| Size | M |

## Goal

Create the book's package so every later Round T todo has a site to build into. The scaffold proves the stack the plan proposes: Astro in static output with no adapter, Markdown through the `unified()` processor, Pagefind over the built site, and a package the root scripts already cover. It also settles whether `astro check` runs under TypeScript 7, and records in LICENSE that code derived from the garment repository is Apache-2.0.

## Context

- [Book plan BK3 and BK4](../../plans/build-book.md#bk3-a-static-astro-site-with-no-adapter-a-unified-markdown-pipeline-and-pagefind-proposed): the stack, the pins and the scripts.
- [ADR 0052](../../decisions/0052-book-in-apps-on-cloudflare.md) and [ADR 0053](../../decisions/0053-book-stack-and-deploy.md): the folder, the licences and the stack.
- [AGENTS.md coding standards](../../../AGENTS.md#coding-standards): exact pins, releases at least a week old, pnpm only, `onlyBuiltDependencies`.
- The garment repository's `astro.config.mjs` at commit `bca44b0`: the render-input hash that clears Astro's content cache ([ADR 0054](../../decisions/0054-reuse-garment-textbook-code.md)).

## Scope

**In scope**

- `apps/*` in `pnpm-workspace.yaml` if L5 or L7 has not added it, and `apps/manual/package.json` as the private `@buildanagent/manual`, with Astro 7.4.11, the pin `apps/docs` uses ([DS1](../../plans/publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted))
- `astro.config.mjs` with static output, `trailingSlash: 'always'`, the `unified()` processor and the render-input hash
- One placeholder chapter, the build script `astro build && pagefind --site dist`, and a search page
- `apps/manual` in LICENSE under both terms, and the first THIRD-PARTY-NOTICES.md entry for the garment repository

**Out of scope** (and which todo covers it)

- The design tokens and components ([T2](T2-book-design.md))
- The content model and its checks ([T3](T3-book-content-model.md))
- CI and deploy ([T8](T8-book-ci.md), [T9](../ongoing/T9-book-deploy.md))

## Tasks

- [x] Re-run `npm view <package> time` for `astro`, `@astrojs/markdown-remark`, `pagefind`, `remark-directive`, `unist-util-visit` and `wrangler`, and pin the newest release at least a week old; update BK3's table if a pin moves.
- [x] Confirm that CI's `node-version-file: .nvmrc` and a fresh local install both resolve Node 22 to 22.23.4 or later, which Astro 7.4.11's `engines` requires; if not, pin `.nvmrc` to a full version in its own commit.
- [x] Add `apps/*` to `pnpm-workspace.yaml` only if it is not there yet: whichever of [L5](../ready/L5-docs-app.md), [L7](../ready/L7-website-app.md) or this todo lands first adds it ([DS2](../../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted)). Then create `apps/manual` with `build`, `dev`, `check:book`, `typecheck` and `test` scripts, following `apps/docs` and `apps/site` where they exist (private `@buildanagent/<name>` packages, the same Astro pin), and install with `pnpm install` at the root.
- [x] Write `astro.config.mjs` with the render-input hash adapted from the garment repository, with a header comment naming its origin, the source commit and its Apache-2.0 licence, and add the THIRD-PARTY-NOTICES.md section.
- [x] Add `data-pagefind-body` to the chapter layout only, and a search page that loads Pagefind's UI.
- [x] Try `astro check` under the root's TypeScript 7.0.2; if it fails, type-check the book's `.ts` files with `tsc -p` and record the result in the plan's risks.
- [x] Add `apps/manual` to LICENSE: prose and figures under CC BY 4.0; code and figure generators under Apache-2.0 OR MIT, except files derived from the garment repository, which are Apache-2.0 only (the owner's answer, 2026-11-19: "Apache 2.0"; [ADR 0054](../../decisions/0054-reuse-garment-textbook-code.md)).

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/manual build` writes `apps/manual/dist/` with one chapter page and a working `dist/pagefind/` index
- [x] Every dependency in `apps/manual/package.json` is pinned exactly to a release at least a week old on the day of the pull request
- [x] The root `pnpm typecheck` and `pnpm test` run the book's `typecheck` and `test` scripts
- [x] THIRD-PARTY-NOTICES.md names the garment repository, its commit and the copied file; LICENSE names `apps/manual`
- [x] LICENSE records that files derived from the garment repository are Apache-2.0, and each such file opens with a header comment naming its origin and licence
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

A Vitest smoke test in `apps/manual/test/` runs the Markdown processor on a fixture chapter. The build itself is the main check.

## Docs to update

- The plan's BK3 pins and risks, if they change
- [AGENTS.md](../../../AGENTS.md) layout and the root [README](../../../README.md), if the `apps/` lines added with the plan need detail

## Risks and open questions

- `astro check` may not support TypeScript 7 (plan risk 2).
- A new pin may need an `onlyBuiltDependencies` entry (for example `sharp` if Astro's image service loads it); allow only what the build needs.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `apps/manual` (`@buildanagent/manual`, private) builds with `pnpm --filter @buildanagent/manual build` into `dist/`: the contents page, one placeholder chapter at `/welcome/`, a search page on Pagefind's component UI and `dist/pagefind/`. Pagefind indexes one page, because only the chapter layout carries `data-pagefind-body`. A query run against the built index in Node returned the chapter.
- Pins, re-checked on 2026-11-19 at 11:25 UTC: `astro` 7.4.11 (2026-11-11), `@astrojs/markdown-remark` 7.3.8 (2026-11-11) and `pagefind` 1.6.0 (2026-11-01). None moved. `remark-directive` 4.0.0 and `unist-util-visit` 5.2.0 are re-confirmed but wait for T3, which uses them, and `wrangler` 4.160.1 waits for T9; 4.161.0 was still about two hours short of a week old. No new package needs a build script.
- `astro check` cannot run under TypeScript 7.0.2: Astro 7.4.11 refuses it before loading `@astrojs/check`. `typecheck` runs the root `tsc` over the app's `.ts` files. Until T3's checks replace it, `check:book` runs `astro sync`, which fails on chapter frontmatter outside the strict schema. BK3 and risk 2 record the result.
- `.nvmrc` stays `22`: the `ubuntu-24.04` image caches Node 22.23.4, and the newest Node 22 is 22.23.5. The app's `engines` names Astro's floor, 22.23.4, so an older Node 22 fails with a clear message.
- The render-input hash covers every file under `src/markdown/`, where T3's plugins will live, and T3 adds its data files to the list.
- `biome.json` turns off `noUnusedVariables` and `noUnusedImports` for `apps/manual/**/*.astro` only, because Biome reads only an `.astro` file's frontmatter; AGENTS.md records the exception.
- `src/content.config.ts` holds a minimal strict chapter schema (`title`, `description`), because a content collection needs one. T3 owns that schema and extends it.
- The smoke test renders its fixture chapter through the processor `astro.config.mjs` gives Astro, so a config that drops the `unified()` processor fails the test. The root Vitest projects and the gateway's Vite-conditions guard both cover `apps/*`.
- The lockfile also moves `verify/cloudflare-agents`' Vite peer from `yaml` 2.9.0 to 2.9.1, because Astro's `@astrojs/internal-helpers` needs `^2.9.1`.
- `pnpm check` and `pnpm typecheck` pass. `pnpm test` passes for every package except `verify/copilot-sdk`, whose harness needs Linux's `unshare` and refuses to run on macOS; CI runs it on Linux.
- The rename to `apps/manual` in the plan, ADRs, other todos, `docs/design/book-tokens.json` and the README landed separately in #52 (ADR 0055).
