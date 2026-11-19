# Fact-check: publish and docs

This log checks every factual claim in [publish-and-docs.md](../publish-and-docs.md), ADRs 0047–0050 and todos L1–L8 (L4 later split into L4a and L4b), on 2026-11-19. External facts were read from the npm registry, npm's docs and Cloudflare's docs that day; repo claims were read from `main` at `eddc212`; Lamina PDF claims from `laudebugs/laminapdf` at `7b4b37b`.

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
| 22 | npm may require the package to exist before a trusted publisher can be added | ⚠️ | The docs describe the setup on "your package settings", which implies an existing package, but don't say so; the plan's risk 1 and todo L4a cover both cases |
| 23 | Node 22 ships npm 10, so the release job must install npm 11.5.1 or later | ⚠️ | From the Node 22 release line's bundled npm (10.x); not checked on today's runner image. L3 installs npm explicitly either way |

## Cloudflare

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 24 | Cloudflare deploys a static Astro site to Workers with static assets, an `[assets]` directory of `./dist`, and no `main` | ✅ | [Astro guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/), "If you have a static site" |
| 25 | `not_found_handling = "404-page"` returns the nearest `404.html` with a 404 status | ✅ | [Static assets docs](https://developers.cloudflare.com/workers/static-assets/) |
| 26 | Cloudflare recommends Previews over Version URLs for branch and pull request testing | ✅ | [Compare workflows](https://developers.cloudflare.com/workers/previews/compare-workflows/): "Previews are the recommended way… Do not use Version URLs for branch or pull request testing" |
| 27 | Previews need Wrangler 4.135.0 or later, through `wrangler preview` | ✅ | [Previews](https://developers.cloudflare.com/workers/previews/) |
| 28 | `wrangler deploy` with `custom_domain = true` creates the DNS record and certificate | ✅ | Lamina PDF's `apps/docs/wrangler.toml` comment (secondary: a repo, not Cloudflare's docs); row 43 confirms it against Cloudflare's docs |
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

## Checked while fixing the high-effort review

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 43 | Cloudflare creates a Custom Domain's DNS record and issues its certificate | ✅ | [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), read 2026-11-19: "Cloudflare will create DNS records and issue necessary certificates on your behalf" |
| 44 | pnpm's `publishConfig` can override `exports` when it packs | ✅ | [pnpm package.json docs](https://pnpm.io/package_json#publishconfig), read 2026-11-19: the overridable fields include `exports` |
| 45 | Changesets' `privatePackages` takes `version` and `tag` booleans | ✅ | [Changesets config schema](https://github.com/changesets/changesets/blob/main/packages/config/schema.json) on `main`, read 2026-11-19 |
| 46 | The plan said L1 could start now | ✏️ | L1 depends on Q1, which is in `ready/`; corrected to "L1 starts after Q1" in the plan and the roadmap |
| 47 | Fork pull requests get no preview | ✏️ | With the deploy moved to a `workflow_run` workflow, fork pull requests get previews; corrected in DS3, ADR 0049 and L8 |
| 48 | The TypeScript guideline's line reads "export `src/` until B20 decides" | ✏️ | This PR had already changed it to "until todo L1"; PB3, ADR 0050 and L1 now quote the new line |

## The owner's answers

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 49 | The owner accepted PB3 and ADR 0050 | ✅ | Owner's answer, 2026-11-19: "Accept" |
| 50 | The owner accepted DS3 and ADR 0049's deploy design | ✅ | Owner's answer, 2026-11-19: "Accept", applied to the `workflow_run` split |
| 51 | The owner chose DS4: the docs follow `main` until 0.1.0, then releases | ✅ | Owner's answer, 2026-11-19: "main until 0.1.0, then releases" |
| 52 | The owner allowed a one-time token for the first publish if npm needs it | ✅ | Owner's answer, 2026-11-19: "Yes, one-time token if needed" |

## Checked while fixing the medium-effort review

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 53 | Both sites turn off `workers_dev` and still get Preview URLs | ✏️ | Previews are served on `workers.dev`, and a new Worker's `preview_urls` "initial value depends on `workers_dev`" ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), read 2026-11-19). Corrected: both `wrangler.toml` files set `preview_urls = true` (plan DS3, ADR 0049, L8) |
| 54 | A `workers.dev` Preview URL sends `X-Robots-Tag: noindex` | ✅ | [Previews](https://developers.cloudflare.com/workers/previews/), read 2026-11-19 |
| 55 | Vitest's `resolve.conditions` makes Node tests read `source` | ✏️ | Vitest 5.1.0 resolves Vite 8.3.8 here; Vite's `resolve.conditions` defaults to the client conditions and `ssr.resolve.conditions` to `defaultServerConditions`, `['module', 'node', 'development\|production']` ([Vite SSR options](https://vite.dev/config/ssr-options#ssr-resolve-conditions), and the installed `vite` package's export). Corrected to `ssr.resolve.conditions` with `source` before the three defaults (PB3, ADR 0050, L1) |
| 56 | `vitest/config` re-exports `defaultServerConditions` | ✏️ | It doesn't (checked by importing it, 2026-11-19), and pnpm blocks an undeclared `vite` import, so L1 spells out the list and tests it against Vite's |
| 57 | Export conditions match in object order, so `source` must precede `types` in the workspace's `exports` | ✅ | Node's packages docs: "key order is significant. During condition matching, earlier entries have higher priority" (`nodejs/node` `doc/api/packages.md`, read 2026-11-19). Corrects ADR 0050's "types first" for the workspace; "types first" stays for `publishConfig.exports` |
| 58 | Publishing sets `latest` unless `--tag` is given | ✅ | npm's `npm-dist-tag` docs: "Publishing a package sets the `latest` tag to the published version unless the `--tag` option is used" (`npm/cli` docs, read 2026-11-19) |
| 59 | A package's first publish under `--tag bootstrap` leaves `latest` unset | ⚠️ | npm's docs don't cover a package's first publish, and the registry may point `latest` at it; the plan deprecates the placeholder at once and 0.1.0 takes `latest` within 2 days |
| 60 | A tag pushed by `release.yml` with `GITHUB_TOKEN` starts the docs deploy | ✏️ | Events from `GITHUB_TOKEN` create no new runs, except that "`workflow_dispatch` and `repository_dispatch` events always create workflow runs" ([GitHub docs](https://docs.github.com/en/actions/concepts/security/github_token), read 2026-11-19). Corrected: `release.yml` dispatches `docs-deploy.yml` with the tag (DS4, L3, L8) |
| 61 | A pull request opened with `GITHUB_TOKEN` doesn't trigger `ci.yml` (row 42) | ✏️ | The same GitHub page now says such a pull request's runs start in an approval-required state, which a person with write access approves; L3's risk is updated |
| 62 | A `workflow_run` deploy can tell `main` from a pull request by its head branch | ✏️ | A fork's branch can be named `main`. Corrected: production deploys need `workflow_run.event == 'push'` and `head_repository.full_name == github.repository`, and the preview's pull request comes from the API by `head_sha`, not the artifact (DS3, ADR 0049, L8) |
| 63 | The bootstrap job can publish with provenance | ✏️ | Provenance needs the OIDC token, so the job now has `id-token: write` (PB2, ADR 0047, L3) |
| 64 | L2's criteria can all pass while the packages are private | ✏️ | With `privatePackages.version: false`, `changeset version` bumps nothing; the bump check moves to a throwaway branch with `private` removed (L2, L3) |
| 65 | B20 still owns the undocumented-export diff and a changelog test | ✏️ | L6 owns the first export diff and changesets write the changelogs; B20's scope and criteria now keep only the second diff and check for a changeset |
| 66 | One todo, L4, ships the first release | ✏️ | Its steps span more than one pull request, so L4 is split into L4a (public packages, bootstrap, trusted publishers) and L4b (0.1.0, the changeset gate, removing the bootstrap path); row 22's "todo L4" now means L4a |
| 67 | ADR 0049's index row names DS2 and DS3 | ✏️ | The ADR covers DS2 to DS4; the index row now says so |
| 68 | The plan's package versions are dated "on 2026-11-19" | ✏️ | Now "as of November 2026" with npm cited, as AGENTS.md requires |

## Checked after the owner's npm bootstrap (2026-11-19)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 69 | npm needs a package to exist before a trusted publisher can be added | ✅ | `npm/cli` `docs/lib/content/commands/npm-trust.md` at `787f152`, read 2026-11-19: "Package must exist: The package you're configuring must already exist on the npm registry." Answers risk 1, which the plan now replaces |
| 70 | Row 59: a package's first publish under `--tag bootstrap` leaves `latest` unset | ✏️ | `npm view @buildanagent/gateway dist-tags` and the same for the SDK, 2026-11-19: `latest` and `bootstrap` both point at `0.0.0-bootstrap.0`. The plan now says the first publish set `latest` |
| 71 | Each package holds `0.0.0-bootstrap.0` and `0.0.0-stage`, deprecated with "Placeholder only; install 0.1.0 or later." | ✅ | `npm view @buildanagent/<pkg> versions dist-tags deprecated --json`, 2026-11-19 |
| 72 | The placeholders carry provenance | ✏️ | The owner published them from their own machine, not a workflow, so they have none; L4a's criterion now checks versions, dist-tags and the deprecation instead |
| 73 | A `workflow_run` job in an environment limited to `main` can deploy pull-request Previews | ⚠️ | GitHub's events docs list `workflow_run`'s `GITHUB_REF` as "Default branch" (`github/docs` `content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md`, read 2026-11-19), so the job's ref is `main`. Whether the environment's branch rule checks that ref hasn't been tried on this repository, so L8's acceptance criteria check it |
| 74 | Until 0.1.0, `pnpm add @buildanagent/sdk` installs the deprecated placeholder | ✅ | `pnpm add @buildanagent/sdk` in a temp project, 2026-11-19: it added `0.0.0-bootstrap.0`, printed as deprecated |
| 75 | `@buildanagent/gateway/testing/setup` in `setupFiles` resolves through `ssr.resolve.conditions` (PB3) | ✏️ | Found in L1 with Vitest 5.1.0: its `resolvePath()` resolves each `setupFiles` entry at config load through `local-pkg`'s `resolveModule()`, which calls `mlly`'s `resolvePathSync()` with its default conditions `['node', 'import']` (`vitest/dist/chunks/index.Di8au7q4.js` and `nativeModuleRunner.9xPIMzi7.js` in the installed 5.1.0). With no `dist/` the entry fell back to a path under the package and every test file failed; with `dist/` it would load the built setup. Corrected in PB3: each config lists a local `test/setup.ts` that imports the setup, and Vite resolves that import through the SSR list |
| 76 | Every published `package.json` sets `sideEffects: false` (PB3) | ✏️ | Importing `@buildanagent/gateway/testing/setup` installs the offline guards (`packages/gateway/src/testing/setup.ts`), and a bundler that trusts `sideEffects: false` may drop a bare import of it. That bundler behaviour is from webpack's tree-shaking guide as remembered, unverified: `webpack.js.org` was not reachable from the L1 session ([webpack: tree shaking](https://webpack.js.org/guides/tree-shaking/)). Corrected in PB3: the gateway lists `./src/testing/setup.ts` and `./dist/testing/setup.js`, so a bundler keeps the import whichever condition it resolves; the SDK keeps `false` |
| 77 | TypeScript 7.0.2's `inlineSources` inlines sources into declaration maps too (ADR 0051) | ✏️ | Found in the L1 code review: `tsc -p packages/gateway/tsconfig.build.json --declarationMap` with `inlineSources` set wrote `index.d.ts.map` with `sources` pointing at `src/index.ts` and no `sourcesContent`, while every `.js.map` carried it. Corrected in ADR 0051: the build leaves `declarationMap` off |

## ADR 0051, checked after the low code review (2026-11-19)

Each row checks a claim in [ADR 0051](../../decisions/0051-dist-build-corrections-from-l1.md) against the L1 branch or a reproduction in it, with TypeScript 7.0.2, Vitest 5.1.0 and pnpm 10.34.9 installed.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 78 | `files: ["dist"]` drops the licences, which ADR 0050's own pack test requires | ✅ | ADR 0050's Decision sets `files: ["dist"]`, and its Consequences require the tarball to hold `LICENSE`, `LICENSE-APACHE` and `LICENSE-MIT` |
| 79 | A bundler that trusts `sideEffects: false` may drop a bare import of a side-effect file | ✅ | webpack's tree-shaking guide (`src/content/guides/tree-shaking.mdx` at webpack/webpack.js.org commit `7c4a93a`, 2026-11-18): a file "imported for its side effect alone needs to be added to the side effect list so it will not be unintentionally dropped", and an array value lists such files. This replaces row 76's remembered, unverified source |
| 80 | Vitest 5.1.0 resolves a bare `setupFiles` entry with Node's default conditions when it loads the config, so before a build it fails | ✅ | Reproduced: with the SDK's `setupFiles` set to `@buildanagent/gateway/testing/setup` and no `dist/`, both test files failed with "Cannot find module …/packages/sdk/@buildanagent/gateway/testing/setup". `resolvePath()` in the installed `vitest/dist/chunks/index.Di8au7q4.js` falls back to a path under the root when `resolveModule()` finds nothing |
| 81 | Without `inlineSources`, the build's source maps point at `../src/*.ts` | ✅ | Reproduced: `tsc -p packages/gateway/tsconfig.build.json --inlineSources false` wrote `dist/index.js.map` with `sources: ["../src/index.ts"]` and no `sourcesContent` |
| 82 | `tsc` leaves the `dist/` files of deleted modules in place | ✅ | Reproduced: a `stale.js` planted in the output folder survived a second `tsc -p packages/gateway/tsconfig.build.json` |
| 83 | Point 1: `files` lists `dist` and the three licences, `prepack` copies them with `scripts/copy-licenses.mjs`, and `.gitignore` ignores the copies | ✅ | Both `package.json` files' `files` and `prepack`; `.gitignore` lines 17–21 |
| 84 | Point 2: the gateway's `sideEffects` lists `./src/testing/setup.ts` and `./dist/testing/setup.js`; the SDK keeps `false` | ✅ | `packages/gateway/package.json` and `packages/sdk/package.json` |
| 85 | Point 3: each `setupFiles` lists `./test/setup.ts`, and Vite resolves its import to `src/` with no build | ✅ | Both `vitest.config.ts` files; `pnpm test` passed with no `packages/*/dist` present |
| 86 | Point 4: each `tsconfig.build.json` sets `sourceMap` and `inlineSources` and leaves `declarationMap` off, and TypeScript 7.0.2 inlines no sources into declaration maps | ✅ | Both `tsconfig.build.json` files. Reproduced row 77: with `--declarationMap`, `index.js.map` carried `sourcesContent` and `index.d.ts.map` did not |
| 87 | Point 5: `build` runs `scripts/clean-dist.mjs` before `tsc`, and `prepack` runs `build` before copying the licences | ✅ | Both `package.json` files' scripts. With the old gateway `prepack`, all 11 pack tests failed; with the new one they pass |
| 88 | TypeScript 7.0.2's `rewriteRelativeImportExtensions` leaves `./x.ts` in emitted `.d.ts` files | ✅ | Reproduced in a two-file project: `index.js` imported `./x.js`, while `index.d.ts` kept `export { x } from "./x.ts"` |
| 89 | The pack test checks points 1, 2, 4 and 5, and CI runs `pnpm test` before any build | ✅ | `scripts/ci/packages-pack.test.mjs` test names; `.github/workflows/ci.yml` runs `pnpm test` before `node --test scripts/ci/*.test.mjs` |
| 90 | ADR 0050 stays Accepted with a dated note pointing to ADR 0051 | ✅ | ADR 0050's status block and its 2026-11-19 note |
| 91 | ADR 0050 had "four" details that don't hold and "one question open" | ✏️ | The Context listed five gaps and named no open question; the low code review added a sixth (`pnpm pack` didn't build). Corrected in ADR 0051: "five gaps", numbered, with the pack gap folded into the fifth |

## Checked while doing todo L2 (2026-11-19)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 92 | `@changesets/cli` 3.0.3 is still the newest release, published 2026-09-14 | ✅ | `npm view @changesets/cli time --json`, 2026-11-19 |
| 93 | With `privatePackages.version: false`, `changeset version` leaves both private packages at 0.0.0 | ✅ | Reproduced on the L2 branch with a `minor` changeset for the gateway: both stayed at 0.0.0, no `CHANGELOG.md` was written, and the changeset file stayed |
| 94 | L2's first criterion, `pnpm changeset` writing a changeset that lists both packages, can pass on `main` | ✏️ | While the packages are private, `pnpm changeset` stops with "No versionable packages found", because `shouldSkipPackage` in `@changesets/should-skip-package` 1.0.0 skips them. The criterion was checked on the throwaway branch with `private` removed, like the version bump (row 64) |
| 95 | On that throwaway branch, `changeset version` bumps both packages to the same version and writes both changelogs | ✅ | A `minor` changeset for the gateway alone took both to 0.1.0; the SDK's `CHANGELOG.md` lists the gateway update as a patch change |
| 96 | `changeset status --since` fails when a versioned package changed and no changeset was added since the ref | ✅ | `dist/status.mjs` in `@changesets/cli` 3.0.3, and runs 44497925125 (fail) and 44498147370 (pass) on `test/L2-gate` |
| 97 | `changedFilePatterns` patterns are matched against paths relative to each package's folder | ✅ | `getChangedPackagesSinceRef` in `@changesets/git` 4.0.1 slices the package folder off each path before matching |
| 98 | Changesets' `ignore` accepts globs such as `@buildanagent/verify-*` | ✅ | `@changesets/config` 4.0.1 expands `ignore` with picomatch against the workspace's package names |

**Totals:** 98 claims: 71 ✅, 22 ✏️, 5 ⚠️.
