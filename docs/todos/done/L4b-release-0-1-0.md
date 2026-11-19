# L4b: Release 0.1.0 of the gateway and SDK through trusted publishing

| Field | Value |
| --- | --- |
| ID | `L4b` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L4a](../done/L4a-bootstrap-and-trusted-publishers.md) |
| Size | S |

## Goal

Ship the first public release, 0.1.0, once a model call works, through the trusted publishers the owner adds the same day ([PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted), ADR 0047).

**Changed by the owner on 2026-11-19, while L4b was in progress.** The owner said "let's make the releases automated too. Let's keep it alpha for now until we're ready to publish", chose "Changesets pre mode" and "alpha, latest stays placeholder", and then said "let's make the publishes run on every change to the package". So the first release is 0.1.0-alpha.0 under npm's `alpha` dist-tag, and every later package change publishes the next alpha with no "Version packages" pull request. The scope and criteria below keep their original wording; the [outcome](#outcome) says how each was met under the new plan.

## Context

- [PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted) and [ADR 0047](../../decisions/0047-first-release-and-trusted-publishing.md)
- [DS4](../../plans/publish-and-docs.md#ds4-the-docs-follow-main-until-010-then-releases-accepted): from 0.1.0 the docs follow release tags

## Scope

**In scope**

- A changeset for 0.1.0 summarising what the release offers: the transcript, `createModel()`, the Anthropic adapter, `ScriptedModel`
- `pnpm changeset version` run in this pull request, so it carries both packages at 0.1.0 and their first `CHANGELOG.md` entries and no pending changeset. Merging it makes `release.yml` pack both packages and hold the `publish` job for the owner's approval in the `release` environment; once approved, it publishes them through trusted publishing, creates the `v0.1.0` tag and GitHub release, and starts the docs deploy
- Switching on L2's changeset gate (change `if: false` to `if: true` on `ci.yml`'s `changesets` job) and L3's "Version packages" pull request (change `false &&` to `true &&` in the `if:` of `release.yml`'s `version-pr` job), so every later release goes through them. This pull request is the job's first `pull_request` run, so check that the job ran and passed on it
- The owner adds a trusted publisher to each package (user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`, with `npm publish` ticked under **Allowed actions**, since a new configuration otherwise allows only `npm stage publish`) on the day this pull request merges, before the merge. Merging starts the publish, and a trusted publisher expires unless it publishes within 2 days
- Both READMEs gain install instructions

**Out of scope** (and which todo covers it)

- Further adapters (B9) and the loop (B10 onward)

## Acceptance criteria

- [ ] `npm view @buildanagent/gateway@0.1.0` and `npm view @buildanagent/sdk@0.1.0` return the release, npmjs.com shows provenance for both, and `latest` points at 0.1.0. Under the owner's change: `npm view` returns 0.1.0-alpha.0 for both, with provenance, `alpha` points at it and `latest` stays on `0.0.0-bootstrap.0`. Checked after the merge publishes
- [x] A fresh project installs `@buildanagent/sdk@0.1.0` and makes one model call against a mock server through the Anthropic adapter, offline. Met for the packed 0.1.0-alpha.0 tarballs, which are what `release.yml` uploads: `scripts/ci/packages-pack.test.mjs` installs them with `pnpm install --offline` and calls a mock server on the loopback interface. A check against the registry waits for the publish
- [ ] npmjs.com shows a trusted publisher for both packages, naming `release.yml` and the `release` environment. The owner says both are added; this session can't read npm's settings
- [x] A changeset-free change to `packages/*/src` fails CI after the release. Checked locally on this branch and in `scripts/ci/changeset-gate.test.mjs`; the first `pull_request` run is this pull request's
- [ ] The release's `workflow_dispatch` (`docs-deploy.yml` with `tag=v0.1.0`) deploys the 0.1.0 docs to `docs.buildanagent.fyi`, and the next push to `main` deploys `next.docs.buildanagent.fyi` (once L8 has landed; otherwise L8 checks it). Moves to the first stable release: `release.yml` starts no docs deploy for a prerelease, and L8 must treat only a stable tag as a release ([DS4](../../plans/publish-and-docs.md#ds4-the-docs-follow-main-until-010-then-releases-accepted))
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The fresh-install smoke test and the npm checks, recorded in the pull request description.

## Docs to update

Both READMEs and CHANGELOGs, the roadmap, the plan's todo table.

## Risks and open questions

If L4b can't merge within 2 days of the owner adding the trusted publishers, they expire; the owner re-adds them on npmjs.com before L4b merges.

The changeset gate, once switched on, fails any pull request that runs `pnpm changeset version`, because that command edits each `package.json` and deletes the changesets it consumed. A local run on 2026-11-19 failed that way with "Some packages have been changed but no changesets were found". As scoped, this pull request runs the command, and so does every "Version packages" pull request. So before switching the gate on, make it skip `changeset-release/main`, the "Version packages" branch. Then choose how 0.1.0 gets its bump. Either this pull request adds only the 0.1.0 changeset and the "Version packages" pull request runs the command, or this pull request keeps the bump and a follow-up pull request switches the gate on ([CI plan §3e](../../plans/ci.md#3e-a-changeset-check-on-since-l4b-added-2026-11-19)).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

Merging this pull request publishes 0.1.0-alpha.0 of both packages under npm's `alpha` dist-tag. The branch enters Changesets pre mode with the tag `alpha`, adds one changeset per package and runs `pnpm changeset version`. So `main` gets both packages at 0.1.0-alpha.0, their first `CHANGELOG.md` entries and no pending changeset. On that checkout, `release-plan.mjs plan` asks for no version and publishes 0.1.0-alpha.0 under `alpha` as a prerelease; a test in `scripts/ci/release.test.mjs` asserts that plan on the real files.

- **The gate.** `ci.yml`'s `changesets` job is on, and it runs `scripts/ci/changeset-gate.mjs`. The script passes a change whose shipped files are only `package.json` files that differ from the base in `version` alone, each with a `CHANGELOG.md` section for the new version that fits the pre mode. Every other change to shipped files must add a top-level changeset that Changesets would consume, and then goes to `pnpm changeset status`. This option keeps this pull request passing with the gate on, where the todo's two listed options would have needed a second pull request, and a `src/` change without a changeset still fails ([CI plan §3e](../../plans/ci.md#3e-a-changeset-check-on-since-l4b-added-2026-11-19)).
- **Automatic releases, with versioning off for now.** `release.yml` lost its `version-pr` job. Its new `version` job versions the newest `main` on a push with a changeset pending, pushes `chore(release): version packages to <version> [skip ci]` with `GITHUB_TOKEN` and plans again, and `pack` and `publish` release that commit. The medium code review switched the job off with `false &&` in its `if:`, because it runs third-party code with a token that can push to the protected `main`. A follow-up replaces it with an auto-merged "Version packages" pull request; until then, changesets merged after L4b wait on `main`. The plan accepts only an `alpha` prerelease while in pre mode, and only x.y.z outside it, and the dist-tag comes from `pre.json` ([CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19)).
- **Leaving alpha.** A pull request that runs `pnpm changeset pre exit` makes the next run publish a stable version under `latest` ([`.changeset/README.md`](../../../.changeset/README.md#leave-alpha-with-pnpm-changeset-pre-exit)).
- **The first publish failed and was fixed.** The release run after the merge ([run 44528880576](https://github.com/laudebugs/buildanagent/actions/runs/44528880576)) stopped in the `publish` job before uploading anything, because npm's user and global configs named one file and npm exits with "double-loading config". Pull request #58 points the global config at a separate empty file, and its merge starts the publish of 0.1.0-alpha.0.
- **Docs.** Both READMEs say to install with `@alpha`. The plan, CI plan, roadmap, `CONTRIBUTING.md`, `AGENTS.md` and `.changeset/README.md` describe the new flow, and the fact-check log gains rows 161–181.

The owner's steps:

1. **Before the merge, on the day of it:** add each package's trusted publisher on npmjs.com, with user `laudebugs`, repository `buildanagent`, workflow `release.yml`, environment `release`, and `npm publish` ticked under **Allowed actions**. The owner reports this done on 2026-11-19, so merge by 2026-11-21, or re-add them first.
2. **The approval rule:** the owner removed the `release` environment's approval rule on 2026-11-19, so the merge publishes 0.1.0-alpha.0 with no further step.
3. **For the follow-up's auto-merged version pull request:** turn on **Allow auto-merge** in the repository settings and add a token secret that can open a pull request whose checks run.
4. **Once 0.1.0-alpha.0 is out:** optionally set each package's publishing access to "Require two-factor authentication and disallow tokens".
