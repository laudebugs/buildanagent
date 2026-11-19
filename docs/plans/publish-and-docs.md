# Publish the SDK to npm and its docs to two Cloudflare sites

- **Status:** Ready (2026-11-19). The owner decided on 2026-11-19 to publish under `@buildanagent`, to ship 0.1.0 once a model call works, to build the docs on Astro Starlight, and to serve two sites on Cloudflare, and accepted every decision below the same day. Round L's todos are ready; none has started.

The owner reserved the `@buildanagent` scope on npm and said, on 2026-11-19, "We can start publishing as soon as we're ready to". The same day they asked for library docs ("We also need to build documentation for the libraries") and named where they live ("We'll use cloudflare to deploy docs and the website - buildanagent.fyi"). This plan turns those decisions into Round L, eight todos that take `@buildanagent/gateway` and `@buildanagent/sdk` from private source packages to a 0.1.0 release with provenance, and that stand up the website at `buildanagent.fyi` and the docs at `docs.buildanagent.fyi`. It adapts Lamina PDF's working setup (`laudebugs/laminapdf` at `7b4b37b`): built `dist/` packages, a fixed Changesets group, npm trusted publishing, and Starlight docs on Cloudflare Workers static assets.

## 1. Goal and non-goals

**Goal.** By the end of Round L, a user can `pnpm add @buildanagent/sdk`, make a model call through the Anthropic adapter, and read how in the docs at `docs.buildanagent.fyi`, whose API reference comes from the packages' TSDoc.

**Non-goals.**
- Publishing the harness, protocol or agent packages. They join the fixed version group when their plans ship them.
- A blog, a changelog site or search beyond what Starlight ships.
- Versioned docs for more than the latest release and `main`.

## 2. Decisions

| Id | Decision | Status | Record |
| --- | --- | --- | --- |
| PB1 | Publish 0.1.0 of the gateway and SDK once a model call works, after B4 and B8, with a one-time bootstrap publish if npm needs it | Accepted (owner, 2026-11-19) | [ADR 0047](../decisions/0047-first-release-and-trusted-publishing.md) |
| PB2 | Version with Changesets in one fixed group, and publish only from CI through npm trusted publishing | Accepted (owner, 2026-11-19), with PB1 | [ADR 0047](../decisions/0047-first-release-and-trusted-publishing.md) |
| PB3 | Ship built `dist/` with `.d.ts` files, and keep a `source` export condition for the workspace | Accepted (owner, 2026-11-19) | [ADR 0050](../decisions/0050-dist-build-with-source-condition.md) |
| DS1 | Build the docs on Astro Starlight, with the API reference generated from TSDoc | Accepted (owner, 2026-11-19) | [ADR 0048](../decisions/0048-docs-on-astro-starlight.md) |
| DS2 | Serve two sites on Cloudflare: the website at `buildanagent.fyi` and the docs at `docs.buildanagent.fyi` | Accepted (owner, 2026-11-19) | [ADR 0049](../decisions/0049-two-sites-on-cloudflare.md) |
| DS3 | Deploy both sites as Workers static assets, with a Cloudflare Preview per pull request | Accepted (owner, 2026-11-19) | [ADR 0049](../decisions/0049-two-sites-on-cloudflare.md) |
| DS4 | The docs follow `main` until 0.1.0, then release tags, with `main` at `next.docs.buildanagent.fyi` | Accepted (owner, 2026-11-19) | [ADR 0049](../decisions/0049-two-sites-on-cloudflare.md) |

### PB1. Ship 0.1.0 once a model call works (accepted)

**Accepted by the owner on 2026-11-19:** "0.1.0 once a model call works". For the first publish, the owner also answered "Yes, one-time token if needed": if npm needs a package to exist before a trusted publisher can be added, the bootstrap path in PB2 runs once.

The first release waits for two todos: B4 builds `createModel()` with retries, and B8 builds the Anthropic adapter. With both, a published package can call a real model; without them, it holds only types and a test model. B8 depends on B5, B6 and B7, so the release also carries the cost catalog, the message transform and the tool-name table. ADR 0008's 0.x rule applies from this release: a minor version may break the API, and only with a "Breaking Changes" changelog entry ([D8](build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-accepted)).

### PB2. Changesets in one fixed group, published only from CI (accepted)

**Accepted by the owner on 2026-11-19**, with PB1: "Changesets wait until we publish. We can start publishing as soon as we're ready to".

- **Versioning.** Changesets (`@changesets/cli` 3.0.3, the newest release at least a week old as of November 2026, [npm](https://www.npmjs.com/package/@changesets/cli)) records each change as a `.changeset/*.md` file. `@buildanagent/gateway` and `@buildanagent/sdk` form one `fixed` group, as Lamina's packages do, because the SDK depends on the gateway's types and a user should never mix versions. `access` is `public`. The apps and `verify/*` harnesses are in `ignore`, and `privatePackages` is `{ "version": false, "tag": false }` ([Changesets config schema](https://github.com/changesets/changesets/blob/main/packages/config/schema.json)), so nothing moves the packages off 0.0.0 while they are private.
- **Changesets wait until we publish.** The owner said "Changesets wait until we publish", so L2 adds the config and tooling but no CI gate. The gate that requires a changeset, and the "Version packages" pull request, turn on in L4b, with the 0.1.0 changeset as the first one.
- **Changelog.** `changeset version` writes each package's `CHANGELOG.md`. A change that breaks the API must be a `minor` bump under 0.x and must say "Breaking Changes" in its changeset, which D8 requires.
- **Trusted publishing.** A release job publishes with npm trusted publishing: npm exchanges the workflow's OIDC token for a short-lived publish token, so no npm token is stored. npm requires a GitHub-hosted runner, `id-token: write`, npm CLI 11.5.1 or later and Node 22.14.0 or later, and it adds provenance attestations by default ([npm docs](https://docs.npmjs.com/trusted-publishers)). Our `.nvmrc` resolves to the newest Node 22, which ships npm 10, so the release job installs npm 11.5.1 or later before it publishes.
- **The first publish.** npm's docs don't say whether a package must exist before a trusted publisher can be added, and a new trusted publisher expires unless it publishes within 2 days ([npm docs](https://docs.npmjs.com/trusted-publishers)). If npm requires an existing package, L4a bootstraps each package once: a manually triggered `bootstrap` job in `release.yml` reads a temporary `NPM_BOOTSTRAP_TOKEN` secret and publishes a `0.0.0-bootstrap.0` placeholder with `--provenance` under the `bootstrap` dist-tag. The job needs `id-token: write`, because provenance comes from the workflow's OIDC token. npm sets `latest` on a publish unless `--tag` is given ([npm docs](https://docs.npmjs.com/cli/v11/commands/npm-dist-tag)); the registry may still point `latest` at a package's first version, so the placeholder is deprecated at once, with a message to wait for 0.1.0, and 0.1.0 takes `latest` within the 2 days. The owner then adds the trusted publisher, and `release.yml` publishes 0.1.0 itself through trusted publishing within the 2 days. Straight after, the owner revokes the token and deletes the secret, the `bootstrap` job is removed, and the placeholder is deprecated. The normal publish job never sees a token.
- **The release flow.** From L4b on, every push to `main` makes the release workflow open or update a "Version packages" pull request from the pending changesets. Merging that pull request publishes the new versions and tags them. It goes through the same two code-review rounds as any other pull request.

### PB3. Built `dist/` packages, with a `source` condition for the workspace (accepted)

**Accepted by the owner on 2026-11-19.**

Today each package exports its `src/*.ts` files, because the packages were private and Vitest and tsx read TypeScript directly ([typescript.md](../guidelines/typescript.md)). A published package can't do that: npm users need JavaScript and `.d.ts` files. Lamina's rule, which PB3 adopts, is to emit with `tsc` into `dist/`, with `module` and `moduleResolution` `NodeNext`, `.js` specifiers in relative imports, and published `exports` whose conditions list `types` first. Each published `package.json` sets `files: ["dist"]`, `sideEffects: false` and `engines.node`.

The workspace keeps working without a build step through one extra export condition, `source`, which points at `src/*.ts`. TypeScript and Node pick the first condition that matches, in the order the object lists them, so in the workspace's `exports` `source` comes before `types` and `default`; "types first" applies to the published `exports`. Vitest's `ssr.resolve.conditions` and TypeScript's `customConditions` name `source`, so tests and type-checks in the repo read source while npm users get `dist/`. Vite 8, which Vitest 5.1.0 runs on, replaces its default conditions with the list you give instead of adding to it, and Node tests resolve through `ssr.resolve.conditions`, so each Vitest config lists `source` before Vite's server defaults (`module`, `node`, `development|production`) ([Vite docs](https://vite.dev/config/ssr-options#ssr-resolve-conditions)). This includes `@buildanagent/gateway/testing/setup`, which every package's Vitest config loads. PB3 replaces the TypeScript guideline's line that our private packages export their `src/` TypeScript until L1.

Two rules keep the `source` condition inside the repo:
- **It never ships.** Each package's `publishConfig.exports` lists only `types` and `default`, in that order, and pnpm replaces `exports` with it when it packs ([pnpm docs](https://pnpm.io/package_json#publishconfig)). A user whose own tooling sets a `source` condition would otherwise resolve to `src/` files that the tarball doesn't contain.
- **The build ignores it.** Each `tsconfig.build.json` sets `customConditions: []`, and `pnpm -r build` builds in dependency order, so the SDK compiles against the gateway's `dist/*.d.ts`, not its sources.

### DS1. Starlight docs with a generated API reference (accepted)

**Accepted by the owner on 2026-11-19:** "Astro Starlight".

The docs app, `apps/docs` (`@buildanagent/docs`, private), runs Astro 7.4.11 and Starlight 0.42.10, the newest releases at least a week old as of November 2026 ([npm: astro](https://www.npmjs.com/package/astro), [@astrojs/starlight](https://www.npmjs.com/package/@astrojs/starlight)). Its structure follows [docs-writing.md](../guidelines/docs-writing.md):
1. **Start:** what the SDK is, install, your first agent.
2. **Concepts:** the transcript, the stream rule, tools, approvals, budgets.
3. **Guides:** one task each, such as adding a tool or pausing for approval.
4. **Testing:** `ScriptedModel`, the offline setup and deterministic tests.
5. **Reference:** the API, generated from each package's TSDoc by TypeDoc 0.28.20 through `starlight-typedoc` 0.23.2 and `typedoc-plugin-markdown` 4.14.1, the versions on npm as of November 2026.

TypeDoc 0.28.20 accepts TypeScript only up to 6.0, while the repo builds with TypeScript 7.0.2, so the docs app pins TypeScript 6.0.3 for TypeDoc alone, as Lamina does. Every code block of more than five lines comes from a tested file under `packages/*/examples/` ([examples.md](../guidelines/examples.md)), and `starlight-links-validator` 0.27.0 fails the build on a broken link. TypeDoc's `notDocumented` validation, with warnings as errors, is the first of D8's two export diffs: it fails on any export without TSDoc.

The docs, like all our documentation, are licensed CC BY 4.0, and every page footer says so with a link to `LICENSE-DOCS`. Copy on the sites goes through the writing review like any other copy ([AGENTS.md](../../AGENTS.md#every-piece-of-copy-is-drafted-with-the-writing-skill-and-reviewed-once-the-code-is-done)).

### DS2. Two sites on Cloudflare (accepted)

**Accepted by the owner on 2026-11-19:** "We'll use cloudflare to deploy docs and the website - buildanagent.fyi", with two sites. The website, `apps/site` (`@buildanagent/site`, private, plain Astro), serves `buildanagent.fyi`: what buildanagent is, the packages, and links to the docs and the repository. The docs serve `docs.buildanagent.fyi`. Two apps keep the site's design free of Starlight's layout, as Lamina keeps `apps/site` and `apps/docs` apart. `pnpm-workspace.yaml` adds `apps/*`.

### DS3. Workers static assets, and a Preview per pull request (accepted)

**Accepted by the owner on 2026-11-19**, with the build and deploy split below.

Cloudflare's Astro guide deploys a static Astro site to Workers with static assets: a `wrangler.toml` whose `[assets]` directory is `./dist`, and no `main`, because no Worker code runs ([Cloudflare docs](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)). Each app's `wrangler.toml` names its custom domain with `custom_domain = true`, sets `not_found_handling = "404-page"`, turns off `workers_dev`, as Lamina's docs config does, and sets `preview_urls = true`. That last setting matters: Previews are served on `workers.dev`, and a new Worker's `preview_urls` starts from its `workers_dev` value, so without it the previews would be off ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)). A `workers.dev` Preview URL also sends `X-Robots-Tag: noindex` ([Previews](https://developers.cloudflare.com/workers/previews/)). Wrangler is pinned to 4.160.1, the newest release at least a week old as of November 2026 ([npm](https://www.npmjs.com/package/wrangler)).

For pull requests, Cloudflare now recommends Previews (`wrangler preview`, Wrangler 4.135.0 or later) over Version URLs, which share production resources ([Cloudflare docs](https://developers.cloudflare.com/workers/previews/compare-workflows/)). Each site gets two workflows, so no pull request can edit the job that holds the Cloudflare token:
- **Build** (`docs-build.yml`, `site-build.yml`), on `pull_request` and pushes to `main`: builds the site with no secrets and uploads `dist/` as an artifact. Nothing else in the artifact is trusted.
- **Deploy** (`docs-deploy.yml`, `site-deploy.yml`), on `workflow_run` after its build workflow finishes: GitHub always runs this workflow's definition from `main`. It downloads the artifact, takes `wrangler.toml` from `main`, and never checks out or runs the pull request's code. It deploys to production only when the triggering run was a `push` (`github.event.workflow_run.event == 'push'`) from this repository (`github.event.workflow_run.head_repository.full_name == github.repository`) to `main`, because a fork's branch can also be named `main`. Every other run gets `wrangler preview`, and the deploy job finds the pull request through the API from the run's `head_sha` (`GET /repos/{repo}/commits/{sha}/pulls`), never from anything the build uploaded.

Pull requests from forks get previews too, because the secrets live only in the deploy workflow. Pushes to `main` deploy the website.

### DS4. The docs follow `main` until 0.1.0, then releases (accepted)

**Accepted by the owner on 2026-11-19:** "main until 0.1.0, then releases". Until 0.1.0 ships, pushes to `main` deploy `docs.buildanagent.fyi`. From 0.1.0 on, each release tag deploys `docs.buildanagent.fyi`, so the docs match the published packages, and `main` deploys `next.docs.buildanagent.fyi`, marked unreleased and `noindex`.

The switch needs no manual step. A tag that `release.yml` pushes with `GITHUB_TOKEN` starts no other workflow, but a `workflow_dispatch` does: GitHub's docs say "`workflow_dispatch` and `repository_dispatch` events always create workflow runs" ([GitHub docs](https://docs.github.com/en/actions/concepts/security/github_token)). So after it tags a release, `release.yml` runs `gh workflow run docs-deploy.yml -f tag=<tag>` with `actions: write`, and `docs-deploy.yml`'s `workflow_dispatch` path builds the docs at that tag and deploys production. Its `workflow_run` path for pushes to `main` deploys production while no release tag exists, and `next.docs.buildanagent.fyi` once one does.

## 3. What the owner sets up

1. **npm.** After the first publish exists (L4a says how), add a trusted publisher to each package on npmjs.com: user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`. A new trusted publisher must complete its first publish within 2 days, or it expires ([npm docs](https://docs.npmjs.com/trusted-publishers)).
2. **GitHub.** Create the `release` environment with the owner as required reviewer. Keep "Allow GitHub Actions to create and approve pull requests" on, for the "Version packages" pull request.
3. **Cloudflare.** Add the `buildanagent.fyi` zone to the Cloudflare account. Create an API token for Wrangler deploys, and save it and the account id as the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets. The permissions to grant, Workers Scripts edit and Zone Workers Routes edit on the zone, come from Lamina PDF's `wrangler.toml` and are not yet confirmed against Cloudflare's docs; L8 confirms them. Once a Worker has a custom domain, Cloudflare creates its DNS record and issues its certificate ([Cloudflare docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).
4. **Actions lockfile.** Each new workflow and action, including the four site workflows and `release.yml`, needs an entry in `.github/workflows/actions.lock` ([CI plan §3d](ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)). The implementer runs `gh actions-lock`, or copies verified entries and checks each with `git ls-remote`.

## 4. Round L and its todos

Round L runs beside Round B. L5 and L7 can start now; L1 starts after Q1. The release takes two todos, so each fits one pull request: L4a bootstraps the packages and adds the trusted publishers after B4, B8 and L3, and L4b publishes 0.1.0 within the 2 days that follow.

| Todo | What it delivers | Depends on | Size |
| --- | --- | --- | --- |
| [L1](../todos/ready/L1-build-dist-packages.md) | `tsc` builds `dist/` for both packages, with `types`-first exports and a `source` condition | Q1 | M |
| [L2](../todos/ready/L2-changesets.md) | Changesets config, a fixed group, and a CI check for missing changesets, switched on in L4b | L1 | S |
| [L3](../todos/ready/L3-release-workflow.md) | `release.yml`: trusted publishing with provenance, the bootstrap job, and the "Version packages" pull request, switched on in L4b | L2 | M |
| [L4a](../todos/ready/L4a-bootstrap-and-trusted-publishers.md) | Drop `private`, bootstrap the packages if npm needs it, add the trusted publishers | B4, B8, L3 | S |
| [L4b](../todos/ready/L4b-release-0-1-0.md) | Publish 0.1.0 through trusted publishing, switch on the changeset gate, remove the bootstrap path | L4a | S |
| [L5](../todos/ready/L5-docs-app.md) | `apps/docs` on Starlight, with the docs structure and the first pages | B3 | M |
| [L6](../todos/ready/L6-api-reference.md) | The API reference from TSDoc, and TypeDoc's undocumented-export check | L1, L5 | M |
| [L7](../todos/ready/L7-website-app.md) | `apps/site`, the website for `buildanagent.fyi` | None | S |
| [L8](../todos/ready/L8-cloudflare-deploys.md) | Deploy workflows for both sites, with per-PR Previews | L5, L7 | M |

B20's README type-checking, `llms.txt`, `defaultsHash` and second export diff stay in B20; its revision moves the docs site and the first export diff here.

## 5. Risks

1. **npm may need the package to exist before a trusted publisher can be added.** npm's docs describe the setup on a package's settings page. If a new package can't be configured beforehand, the bootstrap path in [PB2](#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted) publishes a placeholder first, and 0.1.0 still goes out through trusted publishing within the 2-day window.
2. **The `source` condition could leak.** A published `package.json` that kept the `source` condition would point users' tooling at `src/` files the tarball doesn't hold. `publishConfig.exports` strips it, and an L1 test packs each package and resolves every entry with a `source` condition set.
3. **TypeDoc lags TypeScript.** Pinning TypeScript 6.0.3 for TypeDoc means the reference could disagree with how TypeScript 7 reads a type. L6's check builds the reference and type-checks the packages, so a mismatch surfaces in CI.
4. **The pins may move.** Astro, Starlight and Wrangler release weekly. Each todo re-pins to the newest release at least a week old when it starts.

## 6. Conclusion

Round L puts our packages on npm with provenance and our docs on `docs.buildanagent.fyi`, using the setup Lamina PDF already runs. L5 and L7 can start now and L1 starts after Q1; 0.1.0 ships as soon as B4 and B8 are done and the owner has set up npm, GitHub and Cloudflare as §3 lists.
