# L4b: Release 0.1.0 of the gateway and SDK through trusted publishing

| Field | Value |
| --- | --- |
| ID | `L4b` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L4a](../done/L4a-bootstrap-and-trusted-publishers.md) |
| Size | S |

## Goal

Ship the first public release, 0.1.0, once a model call works, through the trusted publishers the owner adds the same day ([PB1](../../plans/publish-and-docs.md#pb1-ship-010-once-a-model-call-works-accepted), ADR 0047).

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

- [ ] `npm view @buildanagent/gateway@0.1.0` and `npm view @buildanagent/sdk@0.1.0` return the release, npmjs.com shows provenance for both, and `latest` points at 0.1.0
- [ ] A fresh project installs `@buildanagent/sdk@0.1.0` and makes one model call against a mock server through the Anthropic adapter, offline
- [ ] npmjs.com shows a trusted publisher for both packages, naming `release.yml` and the `release` environment
- [ ] A changeset-free change to `packages/*/src` fails CI after the release
- [ ] The release's `workflow_dispatch` (`docs-deploy.yml` with `tag=v0.1.0`) deploys the 0.1.0 docs to `docs.buildanagent.fyi`, and the next push to `main` deploys `next.docs.buildanagent.fyi` (once L8 has landed; otherwise L8 checks it)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The fresh-install smoke test and the npm checks, recorded in the pull request description.

## Docs to update

Both READMEs and CHANGELOGs, the roadmap, the plan's todo table.

## Risks and open questions

If L4b can't merge within 2 days of the owner adding the trusted publishers, they expire; the owner re-adds them on npmjs.com before L4b merges.

The changeset gate, once switched on, fails any pull request that runs `pnpm changeset version`, because that command edits each `package.json` and deletes the changesets it consumed. A local run on 2026-11-19 failed that way with "Some packages have been changed but no changesets were found". As scoped, this pull request runs the command, and so does every "Version packages" pull request. So before switching the gate on, make it skip `changeset-release/main`, the "Version packages" branch. Then choose how 0.1.0 gets its bump. Either this pull request adds only the 0.1.0 changeset and the "Version packages" pull request runs the command, or this pull request keeps the bump and a follow-up pull request switches the gate on ([CI plan §3e](../../plans/ci.md#3e-a-changeset-check-off-until-the-first-release-added-2026-11-19)).

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
