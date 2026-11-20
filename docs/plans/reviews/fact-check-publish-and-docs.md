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
| 38 | B20 listed publishing and a docs website as out of scope | ✅ | [B20](../../todos/ongoing/B20-versioning-docs.md), before its revision |
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
| 99 | PB2: "L2 adds the config and tooling but no CI gate" | ✏️ | L2 adds the gate switched off (`if: false`), so it can be tested now and switched on with one line in L4b. PB2 now says so |
| 100 | `changedFilePatterns: ["src/**"]` catches every change that reaches users | ✏️ | The first code review showed a `package.json`-only change, such as a runtime dependency bump, passes `changeset status --since`. Corrected: the patterns add `package.json` and `tsconfig.build.json`; a local run with `private` dropped failed on a `package.json`-only change |
| 101 | `pnpm changeset --empty` writes a changeset that names no package and clears the check | ✅ | `status.mjs` in `@changesets/cli` 3.0.3 suggests `changeset add --empty`; locally, with `private` dropped, it wrote a changeset with empty frontmatter and `status --since` then exited 0 |
| 102 | A `pull_request` run's merge commit gives the same `status --since=origin/main` result as a push | ✅ | Reproduced locally on a merge commit of the branch into `origin/main`, built as GitHub builds the merge ref; not yet seen on a GitHub `pull_request` run (L4b) |

## Checked while doing todo L3 (2026-11-19)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 103 | Trusted publishing needs npm CLI 11.5.1 or later and Node 22.14.0 or later | ✅ | npm docs source, `npm/documentation` `content/packages-and-modules/securing-your-code/trusted-publishers.mdx` at `507a73e` (docs.npmjs.com was unreachable from the session): "requires npm CLI version 11.5.1 or later and Node version 22.14.0 or higher" |
| 104 | It works only on GitHub-hosted runners, and needs `id-token: write` | ✅ | Same file: "GitHub Actions (GitHub-hosted runners)", "Self-hosted runners are not currently supported", "The critical requirement is the `id-token: write` permission" |
| 105 | The trusted publisher names a user, repository, workflow filename (with `.yml`, in `.github/workflows/`) and an optional environment, all case-sensitive | ✅ | Same file, "For GitHub Actions" and "Troubleshooting": "All fields are case-sensitive and must be exact" |
| 106 | A configuration created after 2026-09-03 allows only `npm stage publish` until `npm publish` is chosen under Allowed actions | ✅ | Same file: "Configurations created after Sep 03, 2026 are automatically set to allow `npm stage publish`, and you can choose whether to also permit direct publishing with `npm publish`" |
| 107 | Provenance is automatic only via trusted publishing, from a public repository, for a public package | ✅ | Same file, "Automatic provenance generation"; `oidc.js` in npm 11.21.2 enables it only when the token's `repository_visibility` is `public`. `laudebugs/buildanagent` is public (`gh api repos/laudebugs/buildanagent`, 2026-11-19) |
| 108 | The package's `repository.url` must match the GitHub repository | ✅ | Same file, "Troubleshooting"; both `package.json` files name `git+https://github.com/laudebugs/buildanagent.git` |
| 109 | npm's docs advise "never use caching in release builds" | ✅ | Same file, the GitHub Actions example's `package-manager-cache: false` comment |
| 110 | When the OIDC exchange fails, npm falls back to any configured token, and with none `npm publish` fails with ENEEDAUTH | ✅ | `lib/utils/oidc.js` in npm 11.21.2 returns without throwing on every failure; `lib/commands/publish.js` then throws `ENEEDAUTH` when no credentials exist. The docs: npm "uses them for authentication before falling back to traditional tokens" |
| 111 | npm runs no lifecycle scripts when it publishes a tarball | ✅ | `lib/commands/publish.js` in npm 11.21.2 runs `prepublishOnly`, `publish` and `postpublish` only when `spec.type === 'directory'` |
| 112 | npm 11.21.2 (2026-11-04) is the newest 11.x at least a week old; 11.21.3 is from 2026-11-18 | ✅ | `npm view npm time --json`, 2026-11-19 |
| 113 | npm 12.2.2 (2026-11-04) needs Node `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0`; npm 11.21.2 needs `^20.17.0 \|\| >=22.9.0` | ✅ | `npm view npm@12.2.2 engines` and `npm view npm@11.21.2 engines` |
| 114 | Row 23: Node 22 ships npm 10, so the release job must install npm 11.5.1 or later | ⚠️ | Still unchecked on the runner image; the job installs npm 11.21.2 and asserts `npm --version` before it publishes, so the claim no longer matters |
| 115 | setup-node's `registry-url` writes an `.npmrc` that reads `NODE_AUTH_TOKEN`, and `package-manager-cache` turns its automatic cache off | ✅ | `action.yml` of `actions/setup-node` at `v7.1.0` |
| 116 | A pull request opened with `GITHUB_TOKEN` starts its `pull_request` runs in an approval-required state | ✅ | `github/docs` `data/reusables/actions/actions-do-not-trigger-workflows.md` at `39c1e01`: "creates workflow runs in an **approval-required** state" |
| 117 | `workflow_dispatch` events sent with `GITHUB_TOKEN` always create runs | ✅ | Same file: "`workflow_dispatch` and `repository_dispatch` events always create workflow runs" |
| 118 | A `run` step without `shell:` uses `bash -e {0}`, without `pipefail` | ✅ | `github/docs` `data/reusables/actions/supported-shells.md` at `39c1e01` |
| 119 | A job's `env:` can't read the `runner` context | ✅ | `github/docs` `content/actions/reference/workflows-and-actions/contexts.md` at `39c1e01`, whose table: `jobs.<job_id>.env` allows `github, needs, strategy, matrix, vars, secrets, inputs`. GitHub refused the first dispatch with "Unrecognized named-value: 'runner'" |
| 120 | The five actions `release.yml` uses resolve to the commits `actions.lock` already records | ✅ | `git ls-remote` of each tag, 2026-11-19; `pnpm/action-setup` `v6.1.1` is annotated and peels to `73e4699` |
| 121 | The dry run built and packed both packages and published nothing | ✅ | [Run 44502245024](https://github.com/laudebugs/buildanagent/actions/runs/44502245024) on `todo/L3-release-workflow`: `plan` and `pack` passed, `version-pr`, `publish` and `docs` were skipped, and the plan reported both packages as private. A dry run on `main` waits for the merge |
| 122 | `yaml` 2.9.0, the version the lockfile already resolved, was published 2026-05-11 | ✅ | `npm view yaml time --json`; 2.9.1 (2026-09-11) re-resolved every vite peer in the harnesses, so the test pins 2.9.0 |
| 123 | On an error response, `gh api` prints the error body to stdout and skips `--jq`, so the tag check must branch on its exit status | ✏️ | `gh` 2.89.0, `gh api repos/laudebugs/buildanagent/git/ref/tags/v9.9.9-nope --jq .object.sha`, 2026-11-19: exit 1, stdout `{"message":"Not Found",...}`, stderr `gh: Not Found (HTTP 404)`. The first code review found that the original step read this body as an existing tag |
| 124 | An annotated tag's ref points at a tag object, which must be peeled to reach the commit | ✅ | `github/docs` `content/rest/git/tags.md` at `39c1e01` ("tag objects", annotated tags only); row 120's `pnpm/action-setup` `v6.1.1` is such a tag |
| 125 | A job can wait up to 30 days for an environment approval, so the tarball artifact is kept 30 days | ✏️ | `github/docs` `content/actions/reference/limits.md` at `39c1e01`: "Gate approval time", 30 days. The first code review found the original 7-day retention shorter than that wait |
| 126 | Once npm holds both packages, the plan still publishes while the GitHub release `v<version>` is missing | ✏️ | `scripts/ci/release-plan.mjs` and its tests. The first code review found that the original plan skipped such a run, so "Re-run all jobs" or the next push left the release untagged |

## Checked while doing todo L4a (2026-11-19)

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 127 | npm holds each package at `0.0.0-bootstrap.0` and `0.0.0-stage` only, `latest` and `bootstrap` point at `0.0.0-bootstrap.0`, and the deprecation message is "Placeholder only; install 0.1.0 or later." | ✅ | `npm view @buildanagent/gateway versions dist-tags deprecated --json` and the same for `@buildanagent/sdk`, 2026-11-19 |
| 128 | npm's `trust` docs require the package to exist before a trusted publisher can be added | ✅ | `npm/cli` `docs/lib/content/commands/npm-trust.md` at `787f152`, line 19: "The package you're configuring must already exist on the npm registry" |
| 129 | With `private` dropped, the release plan publishes nothing at 0.0.0 and asks no registry | ✅ | The new test in `scripts/ci/release.test.mjs`, run on the checkout's own `package.json` files; it fails when `private` is put back. `node scripts/ci/release-plan.mjs plan` printed `publish=false` |
| 130 | L4a's own change fails `changeset status --since=origin/main` | ✅ | Run locally on 2026-11-19: removing `private` edits each `package.json`, which `changedFilePatterns` lists. The job is `if: false`, so CI doesn't run it |
| 131 | With L4a as the base, a docs-only commit passes the check and a `src/` edit without a changeset fails | ✅ | Run locally on 2026-11-19 in a throwaway worktree; before L4a, on `origin/main`, the same `src/` edit passed |
| 132 | `privatePackages` now affects only the `verify/` harnesses, which `ignore` also lists | ✅ | `pnpm-workspace.yaml` lists `packages/*` and `verify/*`; every harness is private and named `@buildanagent/verify-*` |
| 133 | Run 44505430717, a `workflow_dispatch` on `main`, ran `plan` and `pack` and skipped the other three jobs | ✅ | `gh run view 44505430717`: both succeeded; `version-pr`, `publish` and `docs` skipped |
| 134 | Run 44505312929, the push to `main` that merged L3, ran only `plan` | ✅ | `gh run view 44505312929`: `plan` succeeded; `pack`, `version-pr`, `publish` and `docs` skipped |
| 135 | Row 132 corrected: `privatePackages` affects only the `verify/` harnesses today, and later the private apps and packages the plans add; `ignore` lists only the harnesses, not the apps | ✏️ | `.changeset/config.json` `ignore` is `["@buildanagent/verify-*"]`; L5, L7, A1, E1 and N1 plan private packages. The first code review found the plan's "the apps … are in `ignore`" and the README's "only the harnesses" too broad |
| 136 | A `private` field that comes back fails a test at any version | ✏️ | `scripts/ci/release.test.mjs`, rerun with `private` added at 0.1.0: the never-skipping test failed. The first code review found that row 129's test skipped off 0.0.0, so it guarded only while the packages stayed there |
| 137 | `npm publish` and `pnpm publish` in a package folder fail through `prepublishOnly` | ✅ | `npm publish --dry-run` (npm 10.9.9) and `pnpm publish --dry-run --no-git-checks` (pnpm 10.34.9) in `packages/gateway` both exited 1 with the guard's message, 2026-11-19. Without the guard, `npm publish --dry-run` reported "Publishing … with tag latest" for `@buildanagent/gateway@0.0.0` |
| 138 | The guard never runs in `release.yml`: pnpm drops lifecycle scripts from the packed `package.json`, and npm runs none for a tarball publish | ✅ | `pnpm pack` with pnpm 10.34.9 wrote a `package.json` whose `scripts` hold only `build`, `typecheck` and `test`; `npm publish <tarball> --dry-run` succeeded with npm 10.9.9 and 11.21.2, 2026-11-19 |
| 139 | The changeset gate fails a pull request that runs `pnpm changeset version`, as L4b's does and every "Version packages" one does | ✅ | Local run on 2026-11-19 with `@changesets/cli` 3.0.3: a minor changeset, `changeset version`, a commit, then `changeset status --since=<base>` exited 1 with "Some packages have been changed but no changesets were found" |

## Re-checked on the live pages (2026-11-19)

Each row below re-reads on the live page a claim that earlier sessions on 2026-11-19 could check only indirectly. Those sessions couldn't reach `docs.npmjs.com`, `docs.github.com` or `webpack.js.org`, so rows 58, 69, 73, 79, 103–110, 116–119, 124, 125 and 128 cite those sites' source repositories. Row 57 likewise cites the `nodejs/node` repository rather than `nodejs.org`, and row 76 cites memory. Rows 23, 29 and 114 stayed ⚠️ with no page checked, and row 73 stayed ⚠️ because its source states less than the claim. Later that day those sites, and also `nodejs.org` and `developers.cloudflare.com`, loaded with `curl`. The original rows stay as they were, except row 118, corrected in place by row 156.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 140 | Row 103: trusted publishing needs npm CLI 11.5.1 or later and Node 22.14.0 or later | ✅ | [npm docs, trusted publishing](https://docs.npmjs.com/trusted-publishers), read 2026-11-19: "requires npm CLI version 11.5.1 or later and Node version 22.14.0 or higher" |
| 141 | Row 104: it works only on GitHub-hosted runners and needs `id-token: write` | ✅ | Same page: "GitHub Actions (GitHub-hosted runners)", "Self-hosted runners are not currently supported", "The critical requirement is the id-token: write permission" |
| 142 | Row 105: the publisher names a user, repository, workflow filename in `.github/workflows/` and an optional environment, all case-sensitive | ✅ | Same page: "The workflow file must exist in .github/workflows/ in your repository" and "All fields are case-sensitive and must be exact" |
| 143 | Row 106: a configuration created after 2026-09-03 allows only `npm stage publish` until `npm publish` is chosen | ✅ | Same page: "Configurations created after Sep 03, 2026 are automatically set to allow npm stage publish, and you can choose whether to also permit direct publishing with npm publish" |
| 144 | Row 107: provenance is automatic only via trusted publishing, from a public repository, for a public package | ✅ | Same page, "Automatic provenance generation", which lists those three conditions |
| 145 | Row 108: the package's `repository.url` must match the GitHub repository | ✅ | Same page: "your package's repository.url field in package.json must exactly match your GitHub repository" |
| 146 | Row 109: npm's docs advise "never use caching in release builds" | ✅ | Same page, the comment on `package-manager-cache: false` in both GitHub Actions examples |
| 147 | Row 110, the docs part: npm tries OIDC before any configured token | ✅ | Same page: npm "uses them for authentication before falling back to traditional tokens". The ENEEDAUTH part rests on npm 11.21.2's code, which row 110 already cites |
| 148 | Rows 69 and 128: npm needs a package to exist before a trusted publisher can be added | ✅ | [npm `trust` docs](https://docs.npmjs.com/cli/v11/commands/npm-trust), read 2026-11-19: "Package must exist: The package you're configuring must already exist on the npm registry." PB2 in the plan and CI plan §3f now cite this page instead of the `npm/cli` source |
| 149 | Row 58: publishing sets `latest` unless `--tag` is given | ✅ | [npm `dist-tag` docs](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag), read 2026-11-19: "Publishing a package sets the latest tag to the published version unless the --tag option is used" |
| 150 | Row 57: export conditions match in object order | ✅ | [Node.js packages docs](https://nodejs.org/api/packages.html), read 2026-11-19: "Within the "exports" object, key order is significant. During condition matching, earlier entries have higher priority" |
| 151 | Rows 23 and 114: Node 22 ships npm 10 | ✅ | [Node.js release index](https://nodejs.org/dist/index.json), read 2026-11-19: every v22 release bundles npm 10.x, from v22.0.0 (npm 10.5.1) to v22.23.5 of 2026-11-11 (npm 10.9.9). `release.yml` installs Node from `.nvmrc` (22), so the bundled npm is too old for trusted publishing |
| 152 | Row 29: the deploy token needs Workers Scripts edit and Zone Workers Routes edit | ⚠️ | [Cloudflare API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), read 2026-11-19, lists "Workers Scripts Edit" under account permissions and "Workers Routes Edit" under zone permissions. The [GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) recommends the "Edit Cloudflare Workers" template, and neither page says which permissions a custom-domain deploy needs. L8 still checks it with a real deploy |
| 153 | Row 73: a `workflow_run` job in an environment limited to `main` can deploy pull-request Previews | ⚠️ | [GitHub, events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), read 2026-11-19, lists `workflow_run`'s `GITHUB_REF` as "Default branch", as the source repo did. Whether the branch rule checks that ref is a behaviour, not a page; L8 still tests it |
| 154 | Row 116: a pull request opened with `GITHUB_TOKEN` starts its `pull_request` runs in an approval-required state | ✅ | [GitHub, `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token), read 2026-11-19: "the resulting pull_request event creates workflow runs in an approval-required state" |
| 155 | Row 117: `workflow_dispatch` events sent with `GITHUB_TOKEN` always create runs | ✅ | Same page: "workflow_dispatch and repository_dispatch events always create workflow runs" |
| 156 | Row 118 said a `run` step without `shell:` uses `bash -e 0` | ✏️ | [GitHub, workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), read 2026-11-19: the unspecified shell runs `bash -e {0}`, while `shell: bash` runs `bash --noprofile --norc -eo pipefail {0}`. Row 118 had dropped the `{0}` placeholder and now reads `bash -e {0}`. The point about `pipefail` stands |
| 157 | Row 119: a job's `env:` can't read the `runner` context | ✅ | [GitHub, contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts), read 2026-11-19: `jobs.<job_id>.env` allows "github, needs, strategy, matrix, vars, secrets, inputs" |
| 158 | Row 124: an annotated tag's ref points at a tag object, which must be peeled to reach the commit | ✅ | [GitHub REST, Git tags](https://docs.github.com/en/rest/git/tags), read 2026-11-19: an annotated tag needs a tag object and then a `refs/tags/[tag]` reference to it, while "a lightweight tag" needs only the reference |
| 159 | Row 125: a job can wait up to 30 days for an environment approval | ✅ | [GitHub, Actions limits](https://docs.github.com/en/actions/reference/limits), read 2026-11-19: "Gate approval time", "A workflow may wait for up to 30 days on environment approvals" |
| 160 | Rows 76 and 79: a bundler that trusts `sideEffects: false` may drop a bare import of a side-effect file | ✅ | [webpack, tree shaking](https://webpack.js.org/guides/tree-shaking/), read 2026-11-19: a CSS file "imported for its side effect alone needs to be added to the side effect list so it will not be unintentionally dropped", and "an array can be provided instead" of `false` |

## L4b: automated alpha releases (2026-11-19)

Rows 161–181 check the claims L4b added to the plan, CI plan §3e–3f, `.changeset/README.md`, `CONTRIBUTING.md`, the package READMEs and the todo. Changesets claims were read from `@changesets/cli` 3.0.3 as installed in the workspace, npm claims from npm 11.21.2's source, and GitHub claims from docs.github.com that day.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 161 | The owner said "let's make the releases automated too. Let's keep it alpha for now until we're ready to publish" | ✅ | Owner's message, 2026-11-19, relayed to the L4b session |
| 162 | The owner chose "Changesets pre mode" and "alpha, latest stays placeholder" | ✅ | Owner's answers, 2026-11-19, relayed to the L4b session |
| 163 | The owner said "let's make the publishes run on every change to the package" | ✅ | Owner's message, 2026-11-19, relayed to the L4b session; it replaced the "Version packages" pull request flow |
| 164 | The owner created the `release` environment and added both trusted publishers on 2026-11-19 | ⚠️ | Owner's statements, relayed to the L4b session. The session couldn't read the environment's settings or npm's publisher settings, so the required reviewer and branch limit are unconfirmed |
| 165 | `pnpm changeset pre enter alpha` writes `.changeset/pre.json` as `{ "mode": "pre", "tag": "alpha" }`, and the next `pnpm changeset version` gives both packages 0.1.0-alpha.0 | ✅ | Local run on L4b's branch, 2026-11-19 |
| 166 | In pre mode, Changesets 3 moves the changesets `changeset version` consumed into `.changeset/pre/` instead of deleting them | ✅ | `@changesets/apply-release-plan` (with `@changesets/cli` 3.0.3), `dist/index.mjs`: when `preState.mode === "pre"`, it renames each changeset into `.changeset/pre/`; the local run left both there |
| 167 | `pnpm changeset pre exit` sets `"mode": "exit"`, and the next `pnpm changeset version` uses the changesets in `pre/` for the changelog, then deletes them and `pre.json` | ✅ | `@changesets/pre` `exitPre` writes `mode: "exit"`; the CLI's exit message says the `pre/` changesets "will be used as changelogs for the normal versions"; `@changesets/read` reads `pre/`; `apply-release-plan` removes `pre.json` in exit mode and deletes consumed changesets outside pre mode |
| 168 | A second changeset in pre mode versions both packages to 0.1.0-alpha.1 | ✅ | Local run on a throwaway branch of L4b, 2026-11-19 |
| 169 | `pnpm changeset status --since=origin/main` exits 1 on L4b's branch, and `scripts/ci/changeset-gate.mjs` passes it | ✅ | Local runs, 2026-11-19; the gate also failed the branch once a commit added a `src/` edit without a changeset |
| 170 | npm 11.21.2 refuses to publish a prerelease without `--tag` | ✅ | npm 11.21.2 `lib/commands/publish.js`, lines 129–131: "You must specify a tag using --tag when publishing a prerelease version." |
| 171 | A push made with `GITHUB_TOKEN` starts no workflow run | ✅ | [GitHub, `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token), read 2026-11-19: "if a workflow run pushes code using the repository's `GITHUB_TOKEN`, a new workflow will not run even when the repository contains a workflow configured to run when `push` events occur" |
| 172 | `[skip ci]` in a commit message skips the `push` and `pull_request` workflows for it | ✅ | [GitHub, skipping workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs), read 2026-11-19: "Workflows that would otherwise be triggered using `on: push` or `on: pull_request` won't be triggered" |
| 173 | A concurrency group runs one run at a time, keeps one pending, and cancels an older pending run | ✅ | [GitHub, workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), read 2026-11-19: "any existing `pending` job or workflow in the same concurrency group will be canceled and the new queued job or workflow will take its place" |
| 174 | A job that needs a skipped job is skipped unless its `if:` says otherwise | ✅ | Same page: "If a job fails or is skipped, all jobs that need it are skipped unless the jobs use a conditional expression that causes the job to continue" |
| 175 | `gh release create --prerelease` marks the release as a prerelease | ✅ | `gh release create --help`, gh 2.89.0: "-p, --prerelease  Mark the release as a prerelease" |
| 176 | npm's provenance for a version job's release names the run's merge commit, not the version commit | ⚠️ | Inferred from the OIDC token naming `GITHUB_SHA`; not checked against a real attestation. The first alpha has no version commit, so the first check comes with 0.1.0-alpha.1 |
| 177 | The packed SDK depends on exactly `@buildanagent/gateway@0.1.0-alpha.0` | ✅ | `scripts/ci/packages-pack.test.mjs` with pnpm 10.34.9, 2026-11-19: the packed `package.json` names the gateway's version |
| 178 | A fresh project installs both 0.1.0-alpha.0 tarballs with `pnpm install --offline` and makes one call through the Anthropic adapter against a mock server | ✅ | The same test file, 2026-11-19, with pnpm 10.34.9 and an allowlisted environment |
| 179 | CI plan §3f said the plan refuses prerelease versions because the job publishes to `latest` only | ✏️ | Superseded by rows 161–162: the plan now accepts a prerelease whose identifier is `pre.json`'s tag while in pre mode, publishes it under that tag, and refuses any other pairing |
| 180 | PB2 said 0.1.0 would take `latest` on its first publish | ✏️ | Superseded by row 162: the first release is 0.1.0-alpha.0 under `alpha`, and `latest` stays on `0.0.0-bootstrap.0` until the first stable release |
| 181 | PB2 and CI plan §3f said each release goes through a "Version packages" pull request | ✏️ | Superseded by row 163: `release.yml` versions on `main` and publishes in the same run; L3's `version-pr` job is gone |
| 182 | `pnpm changeset status --since` counts an added or edited `.changeset/pre/*.md` file as a changeset | ✅ | `@changesets/git` 4.0.1, `dist/index.mjs`, `getChangedChangesetFilesSinceRef`: it keeps files matching `\.changeset/[^/]+\.md$` or `\.changeset/pre/[^/]+\.md$` |
| 183 | Changesets never reads `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` or a dotfile in `.changeset/` as a changeset | ✅ | `@changesets/read` 1.0.1, `dist/index.mjs`: `ignoredMdFiles` and the `startsWith(".")` filter |
| 184 | `changeset version` never consumes a changeset that names a package it skips, such as a private or ignored one | ✅ | `@changesets/apply-release-plan` 8.1.1, `dist/index.mjs`: it moves or deletes a changeset only when no release in it is skipped by `shouldSkipPackage` |
| 185 | GitHub reports `main` as protected | ✅ | `gh api repos/laudebugs/buildanagent/branches/main`, 2026-11-19: `"protected": true`; the rules themselves weren't readable through the proxy |
| 186 | The owner removed the `release` environment's approval rule on 2026-11-19 | ⚠️ | Owner's statement, relayed to the L4b session; the session can't read the environment's settings |
| 187 | The owner agreed to make the version step "a pr that will be autocompleted" | ✅ | Owner's answer "yes", 2026-11-19, relayed to the L4b session |
| 188 | `CONTRIBUTING.md`, PB2 and the todo said the publish waits for the owner's approval while the `release` environment requires it | ✏️ | Superseded by row 186: every publish runs unattended |
| 189 | CI plan §3f, PB2, `AGENTS.md` and `.changeset/README.md` said `release.yml` versions and publishes every merged changeset | ✏️ | The medium code review switched the `version` job off (`false &&` in its `if:`); a follow-up makes it open an auto-merged "Version packages" pull request (row 187) |
| 190 | A pull request opened with `GITHUB_TOKEN` starts no workflow run, so the follow-up needs another token | ✅ | [GitHub, `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token), read 2026-11-19: events the `GITHUB_TOKEN` triggers, except `workflow_dispatch` and `repository_dispatch`, "will not create a new workflow run" |

## Pull request #58: the npm config fix (2026-11-19)

Rows 191–192 check what pull request #58 added to CI plan §3f and the L4b todo, against the failed run's log and local runs of npm 11.21.2.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 191 | The first release run stopped in the `publish` job before uploading anything, because npm's user and global configs named one file and npm exits with "double-loading config" | ✅ | [Run 44528880576](https://github.com/laudebugs/buildanagent/actions/runs/44528880576), `publish` job log: `npm install --global npm@11.21.2` printed `double-loading config "/home/runner/work/_temp/npmrc" as "global", previously loaded as "user"` and exited 1; the publish step never ran. npm still lists only `0.0.0-stage` and `0.0.0-bootstrap.0` for both packages |
| 192 | CI plan §3f said the `publish` job "points npm at a config file that names the registry" | ✏️ | Pull request #58 gives the global config a separate empty file. Locally, npm 10.9.9 and 11.21.2 both refuse one shared file and resolve the registry with two |

## The auto-merged Version packages pull request (2026-11-19)

docs.github.com didn't resolve from this session, so GitHub's claims were read from the `github/docs` repository at commit `39c1e01` (2026-11-18), which the site renders. Repo claims were read from `main` at `0af2a14`.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 193 | Asked "can we make this a pr that will be autocompleted?", the owner answered "yes" | ✅ | Owner's answer, 2026-11-19, as ADR 0047's L4b note already records |
| 194 | The owner turned on **Allow auto-merge**, made `main` require the `checks` status and added `RELEASE_PR_TOKEN`, a fine-grained token for this repository with Contents and Pull requests read and write | ⚠️ | Owner's message, 2026-11-19 ("done adding token and making changes"). This session couldn't read repository settings or secrets through the GitHub API proxy |
| 195 | Events a workflow causes with `GITHUB_TOKEN` "will not create a new workflow run", except `workflow_dispatch` and `repository_dispatch` | ✅ | [`data/reusables/actions/actions-do-not-trigger-workflows.md`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/data/reusables/actions/actions-do-not-trigger-workflows.md) |
| 196 | A pull request that a workflow creates or updates with `GITHUB_TOKEN` gets `pull_request` runs in an approval-required state | ✅ | The same reusable, under the `actions-github-token-pull-request-approval` feature, which [`data/features`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/data/features/actions-github-token-pull-request-approval.yml) enables for github.com (`fpt: '*'`) |
| 197 | GitHub recommends a GitHub App installation token or a personal access token instead of `GITHUB_TOKEN` so that such runs start without approval | ✅ | [`content/actions/concepts/security/github_token.md`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/content/actions/concepts/security/github_token.md) and [`trigger-a-workflow.md`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/content/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow.md) |
| 198 | Auto-merge "merges a pull request automatically after all required reviews and status checks pass", and people with write permissions can turn it on | ✅ | [`automatically-merging-a-pull-request.md`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/content/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request.md) |
| 199 | Auto-merge turns off if someone without write permissions pushes to the head branch, so the release token's force-push keeps it on | ✅ | The same page: "Auto-merge is disabled if someone without write permissions pushes new changes to the head branch or switches the base branch". The token has Contents write |
| 200 | Auto-merge is offered only on a pull request that can't merge yet, such as one whose required status checks haven't passed | ✅ | [`data/reusables/pull_requests/auto-merge-requires-branch-protection.md`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/data/reusables/pull_requests/auto-merge-requires-branch-protection.md) |
| 201 | `pull_request_target` accepts the activity type `auto_merge_enabled`, and on github.com its `GITHUB_SHA` is the last commit on the default branch | ✅ | [`events-that-trigger-workflows.md`](https://github.com/github/docs/blob/39c1e014c75e972ab1fe531a81bc5bd42b543b07/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md#pull_request_target), the table under `pull_request_target` |
| 202 | A merge that auto-merge makes, when the owner's token turned it on, starts `release.yml` on `main` | ⚠️ | Inferred: the suppression rule in row 195 covers events caused with `GITHUB_TOKEN`, and this auto-merge is turned on with a personal access token. GitHub's docs don't say which account the merge counts as. The first Version packages merge will show it; if no run starts, the next push to `main` publishes the version (CI plan §3f) |
| 203 | `gh pr merge --disable-auto` works with a `GITHUB_TOKEN` that has `pull-requests: write` | ⚠️ | Unverified: no workflow here has run it yet. The guard's first run will show it |
| 204 | On `main` at `0af2a14`, `pnpm changeset version` moves both packages to 0.1.0-alpha.1, adds a `## 0.1.0-alpha.1` section to each changelog, moves `unknown-usage-retry-after.md` into `.changeset/pre/` unchanged and leaves `pre.json` as it was | ✅ | Local run of `@changesets/cli` 3.0.3 in a throwaway worktree, 2026-11-19: `git diff --raw` listed those six entries and nothing else. `scripts/ci/version-pr.mjs check` accepted the commit, and `version-pr.test.mjs` repeats the run on every CI pass |
| 205 | CI plan §3f said "The version job is off until an auto-merged pull request replaces it" and that later changesets "wait on `main` and publish nothing" | ✏️ | This pull request replaces the switched-off job with the `version` and `version-pr` jobs, so §3f now describes the Version packages pull request |
| 206 | `.changeset/README.md`, `CONTRIBUTING.md`, AGENTS.md and PB2 said versioning was switched off until a follow-up | ✏️ | Same pull request; each now says that each merged Version packages pull request publishes an alpha |

### The first code-review round (2026-11-19)

The first round's fixes changed what §3f and ADR 0047 claim, so rows 207–217 check those claims. docs.github.com loaded from this session on a second try, so these rows cite the live site where it says something the `github/docs` commit didn't.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 207 | Row 194: the owner "made `main` require the `checks` status" | ✏️ | On 2026-11-19, `GET repos/laudebugs/buildanagent/branches/main` showed `required_status_checks` with no contexts and `enforcement_level` `off`, and `.../protection/required_status_checks` answered 404 "Required status checks not enabled". §3f and ADR 0047 now say `main` doesn't require it yet, and `release.yml` won't turn on auto-merge until it does |
| 208 | Row 194: the owner turned on **Allow auto-merge** | ✅ | `GET repos/laudebugs/buildanagent` showed `allow_auto_merge: true` on 2026-11-19 |
| 209 | gh 2.89.0's `pr merge --auto` merges at once, without auto-merge, when the merge state is clean, has hooks or is unstable | ✅ | `isImmediatelyMergeable` and its use at line 530 of [`pkg/cmd/pr/merge/merge.go`](https://github.com/cli/cli/blob/b62671151b7c98852b7023dd672f5092d1c9dab0/pkg/cmd/pr/merge/merge.go) at tag `v2.89.0` (`b626711`) |
| 210 | Row 203: `gh pr merge --disable-auto` works with a `GITHUB_TOKEN` that has `pull-requests: write` | ✏️ | The guard now turns auto-merge off from a job with `contents: write` and `pull-requests: write`. The live [auto-merge page](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request#disabling-auto-merge) says "People with write permissions to a repository and pull request authors can disable auto-merge", and GitHub's own example turns it on with both permissions ([`automate-dependabot-with-actions.md`](https://github.com/github/docs/blob/973f29df4a725aed49de5dc45a041376f50369ba/content/code-security/tutorials/secure-your-dependencies/automate-dependabot-with-actions.md), lines 168–183, at `973f29d`) |
| 211 | A `GITHUB_TOKEN` with `contents: write` and `pull-requests: write` can turn auto-merge off | ⚠️ | Inferred from row 210's sources; no workflow here has run it yet. The guard's first `disable` run will show it, and a failure turns that run red |
| 212 | Auto-merge stays on when someone with write access pushes to the head branch or changes the base | ⚠️ | Inferred: the live auto-merge page says only that "Auto-merge is disabled if someone without write permissions pushes new changes to the head branch or switches the base branch" |
| 213 | `pull_request_target` accepts the activity types `synchronize`, `edited` and `reopened` | ✅ | The live [events page](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target) lists them, with `auto_merge_enabled`, in the table under `pull_request_target` |
| 214 | Row 202: a merge that auto-merge makes, when the owner's token turned it on, starts `release.yml` on `main` | ⚠️ | Re-checked on the live site on 2026-11-19: the [`GITHUB_TOKEN` page](https://docs.github.com/en/actions/concepts/security/github_token) still suppresses only events caused with `GITHUB_TOKEN`, and the auto-merge page doesn't say which account the merge counts as. Still unverified until the first Version packages merge |
| 215 | Each `actions.lock` entry's commit is its tag's commit | ✅ | `git ls-remote` on 2026-11-19: checkout `v7.0.1` `3d3c42e`, download-artifact `v8.0.2` `9000827`, setup-node `v7.1.0` `949feb2`, upload-artifact `v7.0.2` `cf430e0`, and pnpm/action-setup `v6.1.1`, an annotated tag that peels to `73e4699` |
| 216 | On this branch after merging `main` at `3c438b0`, the plan asks for a version and publishes nothing, and `pnpm changeset version` moves both packages to 0.1.0-alpha.1 | ✅ | Local run, 2026-11-19: `release-plan.mjs plan` printed `publish=false` and `needs_version=true` for one pending changeset. In a throwaway worktree, `changeset version` changed six entries, none under `packages/agent-safety` or `packages/manual`, and `version-pr.mjs check` accepted them as a version commit for 0.1.0-alpha.1 |
| 217 | The versioned packages are the public `packages/*`, so the private `@buildanagent/agent-safety` from #65 is never versioned | ✅ | `gitChange` keeps only packages whose base `package.json` lacks `private: true`; `packages/agent-safety/package.json` sets it. `version-pr.test.mjs` checks this checkout's list and refuses a private package's version change |

## Verified Version packages commits (2026-11-19)

Pull request #70 was blocked by "Commits must have verified signatures", so this pull request makes the version commit through GitHub's API. GitHub's claims were read on the live docs.github.com on 2026-11-19, and the repository's state through the REST API the same day.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 218 | Commits made with `createCommitOnBranch` "are automatically signed by GitHub if supported and will be marked as verified"; they are authored by the owner of the credential, and the mutation takes no author or committer | ✅ | [GraphQL reference, `createCommitOnBranch`](https://docs.github.com/en/graphql/reference/commits#mutation-createcommitonbranch), "Authorship" and "Commit Signing" |
| 219 | The mutation's commit has the branch's head as its parent, `expectedHeadOid` must match that head, and `fileChanges` holds additions and deletions | ✅ | The same page and `CreateCommitOnBranchInput` on it |
| 220 | GitHub promises a signature for commits made through APIs such as the Commits API only when the request is authenticated as a GitHub App or bot and sets no custom author, committer or signature | ✅ | [About commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-bots) |
| 221 | `createCommitOnBranch` called with `RELEASE_PR_TOKEN`, a fine-grained personal access token, gives a commit that reads as verified here | ⚠️ | Inferred from row 218, whose "if supported" names no condition on the token type; nothing in row 220 limits the mutation. The next release run settles it: `version-commit.mjs` fails, leaving the branch alone, unless REST reports `verification.verified` true |
| 222 | A ruleset that requires signed commits checks the head branch's commits when GitHub decides whether a pull request can merge, so an unsigned commit there blocks even a squash merge | ✅ | [Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-signed-commits) |
| 223 | #70's head commit `9a375a4`, pushed with `git` by the `version-pr` job, was unsigned | ✅ | `GET repos/laudebugs/buildanagent/commits/9a375a4…` showed `verification.verified: false`, `reason: unsigned`, author `github-actions[bot]` |
| 224 | The REST git commit object carries `verification.verified` and `verification.reason` | ✅ | [REST git commits](https://docs.github.com/en/rest/git/commits) |
| 225 | §3f, `.changeset/README.md` and `CONTRIBUTING.md` said `main` didn't require the `checks` status yet | ✏️ | `GET repos/laudebugs/buildanagent/branches/main` on 2026-11-19 listed `checks` among the required contexts, enforced for non-admins; the three documents now say so |
| 226 | #70 merged at 2026-11-19T15:03:54Z as `e2b8397`, a squash commit GitHub signed, and the release run on it succeeded | ✅ | `GET repos/…/pulls/70` and `…/commits/e2b8397`, `verification.verified: true`, committer GitHub; release run 44550571848. How the owner got past the rule isn't recorded |
| 227 | Moving an open pull request's head branch back to its base would leave it with no commits, and GitHub's docs don't say what happens to it then | ⚠️ | Unverified: no docs page found. The script avoids the case with `changeset-release/staging` |
| 228 | Besides `version-pr`, only `sdk-updates.yml` creates commits; the guard only runs `gh pr merge --disable-auto` | ✅ | Search of `.github/workflows/` and `scripts/ci/` on this branch for `git commit`, `git push` and commit endpoints |

### The first code-review round (2026-11-19)

The first code review of this pull request found claims that no longer matched the code, and its fixes changed how the script treats a failed or missing staging branch. Each row below records a claim that review checked or corrected.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 229 | Row 218, re-read on the live page: commits made with `createCommitOnBranch` "are automatically signed by GitHub if supported" | ✅ | The live [GraphQL reference](https://docs.github.com/en/graphql/reference/commits#mutation-createcommitonbranch), read 2026-11-19, still says "Commits made using this mutation are automatically signed by GitHub if supported and will be marked as verified in the user interface", and still names no condition for "if supported" |
| 230 | Row 221 stays unverified: a commit made with `RELEASE_PR_TOKEN`, a fine-grained personal access token, reads as verified | ⚠️ | Neither live page settles it on 2026-11-19: the GraphQL reference names no condition, and the [signature page](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#signature-verification-for-bots) speaks only of GitHub Apps and bots. The next release run settles it, because `version-commit.mjs` fails, leaving the branch alone, unless REST reports `verification.verified` true |
| 231 | §3f and the `release.yml` comment said `version-commit.mjs` imports only `node:` modules | ✏️ | It also imports `version-pr.mjs`, which imports `changeset-gate.mjs` and `release-plan.mjs`; `release.test.mjs` lists those four scripts as the whole import graph. Both now say it imports only `node:` modules and the scripts beside it |
| 232 | §3f said the script force-updates `changeset-release/main` "and no other branch" | ✏️ | `publishVersionCommit` in `scripts/ci/version-commit.mjs` also creates, moves and deletes `changeset-release/staging`; §3f now names it as the only other branch the script writes |
| 233 | §3f said the script deletes the staging branch once `changeset-release/main` holds the commit | ✏️ | After the first review's fix, the script creates the staging branch inside its `try`, so the `finally` deletes it on every path, including a failed creation. `version-commit.test.mjs` covers it; §3f now says so |
| 234 | ADR 0047, PB2's release flow in `publish-and-docs.md` and the `RELEASE_BRANCH` comment in `version-pr.mjs` said the workflow pushes the version commit, and ADR 0047 that `main` didn't require `checks` yet | ✏️ | `release.yml` no longer runs `git push` (`release.test.mjs` asserts it), and row 225 records that `main` requires `checks`. The two documents and the comment now say the commit is made through GitHub's API; ADR 0047 gains a dated note instead of an edit to the earlier one |
| 235 | `gh api` 2.89.0 exits 1 when a GraphQL response holds errors, printing the response on stdout and `gh: <message>` on stderr | ✅ | [`pkg/cmd/api/api.go` at `v2.89.0`](https://github.com/cli/cli/blob/v2.89.0/pkg/cmd/api/api.go): `parseErrorResponse` (lines 626–693) joins the `errors` messages, and lines 527–535 print them as `gh: %s` after the body and return `SilentError`. The two fake `gh` scripts now exit this way |
| 236 | GitHub answers a `DELETE` of a ref that doesn't exist with 422 "Reference does not exist", not 404 | ⚠️ | The live [git refs page](https://docs.github.com/en/rest/git/refs#delete-a-reference), read 2026-11-19, lists 422 "Validation failed" for that endpoint but not the message, and checking it live would be a write call to the repository. `apiCall` reads both a 404 and this 422 as already gone, so a wrong guess costs only a warning |
| 237 | No two runs of the version jobs share the staging branch at once | ✅ | `release.yml` puts each run in the group `release-${{ github.event_name }}` with `cancel-in-progress: false`, and `version`, which `version-pr` needs, runs only on a push to `main`, so those runs go one at a time |
| 238 | Writing the staging branch starts no CI run | ✅ | `ci.yml` and `release.yml` run on `push` only for `main`; `auto-merge-guard.yml` runs only on `pull_request_target`, and no pull request has the staging branch as its head |

### SDK-update commits through the API (2026-11-19)

`sdk-updates.yml` now makes each harness's update commit with `version-commit.mjs`, so its pull requests can pass `main`'s signed-commit rule. These rows record why it uses a personal access token rather than `GITHUB_TOKEN`. docs.github.com was out of this session's network on 2026-11-19, so the GitHub docs rows cite the github/docs source at commit `973f29d`, the tip of its `main` that day.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| 239 | `GITHUB_TOKEN` is a GitHub App installation access token, for the app GitHub installs when Actions is on | ✅ | [`content/actions/concepts/security/github_token.md`](https://github.com/github/docs/blob/973f29df4a725aed49de5dc45a041376f50369ba/content/actions/concepts/security/github_token.md), line 17: "The `GITHUB_TOKEN` secret is a GitHub App installation access token" |
| 240 | GitHub signs a commit made through an API only when the request is authenticated as a GitHub App or bot and sets no custom author, committer or signature | ✅ | [`about-commit-signature-verification.md`](https://github.com/github/docs/blob/973f29df4a725aed49de5dc45a041376f50369ba/content/authentication/managing-commit-signature-verification/about-commit-signature-verification.md), "Signature verification for bots", lines 146–150; it matches row 220 |
| 241 | `createCommitOnBranch` takes no author or committer, its commit is authored by the credential's owner, and it "is automatically signed by GitHub if supported" | ✅ | [`src/graphql/data/fpt/schema.docs.graphql`](https://github.com/github/docs/blob/973f29df4a725aed49de5dc45a041376f50369ba/src/graphql/data/fpt/schema.docs.graphql), the mutation's "Authorship" and "Commit Signing" text, lines 28185–28202; it matches rows 218 and 229 |
| 242 | `createCommitOnBranch` called with `GITHUB_TOKEN` would make a verified commit | ⚠️ | Inferred from rows 239–241, untested: the workflow doesn't use `GITHUB_TOKEN` for it, for the reason in row 243 |
| 243 | A pull request that a workflow creates or updates with `GITHUB_TOKEN` gets `pull_request` runs that wait until someone with write access approves them, and GitHub recommends a GitHub App installation token or a personal access token to avoid that | ✅ | [`data/reusables/actions/actions-do-not-trigger-workflows.md`](https://github.com/github/docs/blob/973f29df4a725aed49de5dc45a041376f50369ba/data/reusables/actions/actions-do-not-trigger-workflows.md) and `github_token.md`, line 34. The feature flag [`actions-github-token-pull-request-approval.yml`](https://github.com/github/docs/blob/973f29df4a725aed49de5dc45a041376f50369ba/data/features/actions-github-token-pull-request-approval.yml) lists `fpt: '*'`, with a comment that it is "currently rolling out on dotcom" |
| 244 | `main` requires the `checks`, "Changeset for package changes" and "Workflow lockfile (gh actions-lock --verify)" statuses from GitHub Actions, enforced for non-admins | ✅ | `GET repos/laudebugs/buildanagent/branches/main` on 2026-11-19: `required_status_checks` lists the three, each with `app_id` 15368, and `enforcement_level` `non_admins` |
| 245 | Before this change, `open-pr` checked out and ran `gh` with `SDK_UPDATES_TOKEN`, or else `github.token`, and pushed a commit made with `git` | ✅ | `.github/workflows/sdk-updates.yml` on `main` at `6fcf027` |
| 246 | A commit made through `createCommitOnBranch` with `RELEASE_PR_TOKEN`, a fine-grained personal access token, reads as verified; this settles rows 221 and 230 | ✅ | `GET repos/laudebugs/buildanagent/pulls/73/commits` on 2026-11-19: the one commit, `eedf094`, has `verification.verified` true, `reason` `valid`, and the owner as author |
| 247 | `createCommitOnBranch` can't set a file's mode: a `FileAddition` holds only `path` and `contents` | ✅ | `schema.docs.graphql` at `973f29d`, `input FileAddition`, lines 18578–18588. So `sdk-updates.mjs check` refuses any file that isn't mode 100644 |
| 248 | Writing `deps/staging/sdk-<harness>` starts no workflow run | ✅ | `ci.yml` and `release.yml` run on `push` only for `main`, `verify.yml` and `sdk-updates.yml` only on a schedule or dispatch, and `auto-merge-guard.yml` only on `pull_request_target`; no pull request has a staging branch as its head |
| 249 | No two `open-pr` jobs share a staging branch at once | ✅ | Each matrix job uses its harness's own staging branch, and `sdk-updates.yml` runs in the group `sdk-updates` with `cancel-in-progress: false`, so its runs go one at a time; the release's `changeset-release/staging` is a different name |
| 250 | §3f said `sdk-updates.yml` still commits with `git` and pushes | ✏️ | This change makes its commits through `version-commit.mjs`; §3f now says so and points to §3c |
| 251 | §3c said a pull request opened with `GITHUB_TOKEN` doesn't trigger `ci.yml`, that the workflow falls back to `GITHUB_TOKEN`, and that someone then starts CI by pushing | ✏️ | Row 243: such runs are created, waiting for approval. The workflow now needs `SDK_UPDATES_TOKEN` or `RELEASE_PR_TOKEN` and fails without both, so §3c says that instead |
| 252 | The github/docs files cited in rows 239–247 matched the repository's `main` on 2026-11-19 | ✅ | `git ls-remote https://github.com/github/docs refs/heads/main` gave `973f29d…`; the files fetched from `main` and from that commit were identical |
| 253 | §3c said `SDK_UPDATES_TOKEN` needs no Workflows permission, because the check refuses any change under `.github/` | ✏️ | The first code review found that the ref move, not the patch, decides it: moving `deps/sdk-<harness>` to a commit on a newer `main` spans `main`'s own workflow changes. §3c now asks for Workflows read and write (row 254) |
| 254 | GitHub refuses a branch move that spans workflow changes to a token without the Workflows permission | ⚠️ | Unverified: no run has moved an update branch across a workflow change yet, and this session found no GitHub doc that states the rule for REST ref updates. §3c says "probably" and names the recovery, deleting the stale branch |
| 255 | pnpm shares one resolution of a peer across the workspace, so bumping one harness can change another harness's resolved version | ✅ | A local `pnpm install --lockfile-only --ignore-scripts` on 2026-11-19, from `3a3a4c8` with the langchain bumps: `verify/claude-agent-sdk`'s `@anthropic-ai/claude-agent-sdk` moved from `…(@anthropic-ai/sdk@0.129.0…)` to `…(@anthropic-ai/sdk@1.10.0…)` with its specifier unchanged |
| 256 | Every `packages` entry in our lockfile resolves by `{integrity: sha512-…}` alone | ✅ | `pnpm-lock.yaml` at `3a3a4c8`: 1,056 entries, 1,056 such `resolution` lines and no other kind |
| 257 | pnpm writes a deprecation message that spans lines as a block scalar | ✅ | `pnpm-lock.yaml` at `3a3a4c8`, `workers-ai-provider@4.0.1`: `deprecated: \|-` followed by two indented lines |
| 258 | `gh pr list --json` offers `isCrossRepository`, and `--head` filters by branch name alone | ✅ | gh 2.89.0's field list for `pr list --json` includes `isCrossRepository`; and `gh pr list --help` says `--head` filters by head branch, with "`<owner>:<branch>` syntax not supported" |
| 259 | The check passes real bumps of the pi, langchain and Vercel AI SDK harnesses | ✅ | Run locally on 2026-11-19 against `pnpm install --lockfile-only` output for each harness's eligible bumps, one harness per commit |
| 260 | GitHub commits a `createCommitOnBranch` commit as `GitHub` <noreply@github.com>, so an amend pushed with `git` changes the committer | ✅ | `GET repos/laudebugs/buildanagent/pulls/73/commits` on 2026-11-19: `eedf094`'s committer is `GitHub`, `noreply@github.com`, with `verification.verified` true; `git commit --amend` sets the committer to whoever amends |
| 261 | Every snapshot dependency in our lockfile is a registry version or an npm alias, with no colon | ✅ | `pnpm-lock.yaml` at `3a3a4c8`: each `key: value` line six spaces deep under `snapshots` matches `^[A-Za-z0-9@._/()+~^-]+$` |

**Totals:** 261 claims: 190 ✅, 48 ✏️, 23 ⚠️.
