# L3: Publish from CI with npm trusted publishing and provenance

| Field | Value |
| --- | --- |
| ID | `L3` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L2](../done/L2-changesets.md) |
| Size | M |

## Goal

Publish new versions only from a reviewed release pull request, through npm trusted publishing, with provenance, and with no npm token stored anywhere ([PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted), ADR 0047).

## Context

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub-hosted runners, `id-token: write`, npm CLI 11.5.1 or later, Node 22.14.0 or later, provenance by default
- Lamina PDF's `release.yml`: a publish job on a GitHub-hosted runner with an OIDC token and no package code run before publish

## Scope

**In scope**

- `.github/workflows/release.yml`: on push to `main`, open or update the "Version packages" pull request from pending changesets (switched on in L4b); on merge of that pull request, build, pack and publish
- The publish job: GitHub-hosted runner, `environment: release`, `permissions: id-token: write, contents: write`, npm 11.5.1 or later installed explicitly, `npm publish` of each packed tarball, gateway first
- A git tag per published version, and a GitHub release with the changelog section
- After tagging, `gh workflow run docs-deploy.yml -f tag=<tag>` with `permissions: actions: write`, so the docs deploy for the release (DS4); a `workflow_dispatch` creates a run even when `GITHUB_TOKEN` sends it, unlike the tag push
- A `workflow_dispatch` dry run that builds and packs but doesn't publish

**Out of scope** (and which todo covers it)

- The first release itself (L4a, L4b)

## Acceptance criteria

- [ ] A dry run on `main` builds and packs both packages and publishes nothing
- [ ] On a throwaway branch with `private` removed and the "Version packages" step switched on, a merged changeset opens the pull request; on `main` it stays off until L4b
- [x] The publish job has no npm token and fails closed when trusted publishing isn't configured; no job in `release.yml` reads an npm token
- [ ] Every new workflow and action is in `.github/workflows/actions.lock`: run `gh actions-lock`, or copy verified entries and check each tag's commit with `git ls-remote` ([CI plan §3d](../../plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)); `ci.yml`'s `lockfile` job passes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The dry run, recorded in the pull request description.

## Docs to update

CI plan (a new release section), CONTRIBUTING.md, AGENTS.md's `.github/workflows/` line, the plan's todo table.

## Risks and open questions

A pull request opened with `GITHUB_TOKEN` starts its `ci.yml` runs in an approval-required state, which a person with write access approves ([GitHub docs](https://docs.github.com/en/actions/concepts/security/github_token)); say whether the release pull request uses that, or the `SDK_UPDATES_TOKEN` pattern from the SDK-updates workflow.

## Outcome

`.github/workflows/release.yml` plans each run with `scripts/ci/release-plan.mjs`, packs both packages with a read-only token, and publishes the tarballs, gateway first, from a `publish` job in the `release` environment. That job has only `contents: write` and `id-token: write`, checks nothing out, installs npm 11.21.2 and reads an npm config with no credentials, so a missing trusted publisher ends in ENEEDAUTH. It then creates the `v<version>` tag and GitHub release, and a `docs` job with only `actions: write` starts `docs-deploy.yml` once that file exists. The [CI plan §3f](../../plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19) has the details and the owner's setup.

- **Criteria evidence.** `scripts/ci/release.test.mjs` checks the no-token rule, the publish job's runner, environment, permissions and push-to-`main` condition, and the `version-pr` off switch (`false &&`, which L4b changes to `true &&`). The plan also refuses `private` packages and version 0.0.0, so L4a's merge publishes nothing. Each `actions.lock` entry was checked with `git ls-remote`; `ci.yml`'s `lockfile` job first runs on this pull request.
- **Reruns.** The first code review found that a run which failed after the npm uploads left the release untagged. The plan now keeps publishing while the GitHub release `v<version>` is missing, the publish job skips what npm holds, and the tarballs are kept 30 days, as long as an approval can wait.
- **Dry run.** [Run 44502245024](https://github.com/laudebugs/buildanagent/actions/runs/44502245024), from this branch, built and packed both packages and skipped `version-pr`, `publish` and `docs`. The criterion asks for a dry run on `main`, which can run only after the merge.
- **Not done here.** The throwaway-branch test of the "Version packages" pull request would open a real pull request, so it waits for L4b, or for the owner to allow a throwaway one.
- **The risk's answer.** The release pull request uses `GITHUB_TOKEN`, and a person approves its CI runs from the merge box. That keeps `release.yml` free of stored secrets, and the owner reviews that pull request anyway.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
