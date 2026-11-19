# L3: Publish from CI with npm trusted publishing and provenance

| Field | Value |
| --- | --- |
| ID | `L3` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L2](L2-changesets.md) |
| Size | M |

## Goal

Publish new versions only from a reviewed release pull request, through npm trusted publishing, with provenance, and with no npm token stored anywhere ([PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted), ADR 0047).

## Context

- [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub-hosted runners, `id-token: write`, npm CLI 11.5.1 or later, Node 22.14.0 or later, provenance by default
- Lamina PDF's `release.yml`: a publish job on a GitHub-hosted runner with an OIDC token and no package code run before publish

## Scope

**In scope**

- `.github/workflows/release.yml`: on push to `main`, open or update the "Version packages" pull request from pending changesets (switched on in L4b); on merge of that pull request, build, pack and publish
- A manual `bootstrap` job, used only if npm needs a package to exist before a trusted publisher can be added: it reads a temporary `NPM_BOOTSTRAP_TOKEN` secret and publishes `0.0.0-bootstrap.0` of each package with `--provenance` under the `bootstrap` dist-tag. It has its own `permissions: id-token: write, contents: read`, because provenance needs the OIDC token. It is separate from the publish job, and L4b removes it
- The publish job: GitHub-hosted runner, `environment: release`, `permissions: id-token: write, contents: write`, npm 11.5.1 or later installed explicitly, `npm publish` of each packed tarball, gateway first
- A git tag per published version, and a GitHub release with the changelog section
- After tagging, `gh workflow run docs-deploy.yml -f tag=<tag>` with `permissions: actions: write`, so the docs deploy for the release (DS4); a `workflow_dispatch` creates a run even when `GITHUB_TOKEN` sends it, unlike the tag push
- A `workflow_dispatch` dry run that builds and packs but doesn't publish

**Out of scope** (and which todo covers it)

- The first release itself (L4a, L4b)

## Acceptance criteria

- [ ] A dry run on `main` builds and packs both packages and publishes nothing
- [ ] With the "Version packages" step switched on on a throwaway branch with `private` removed, a merged changeset opens the pull request; on `main` it stays off until L4b
- [ ] The publish job has no npm token and fails closed when trusted publishing isn't configured; only the manual `bootstrap` job reads a token
- [ ] Every new workflow and action is in `.github/workflows/actions.lock`: run `gh actions-lock`, or copy verified entries and check each tag's commit with `git ls-remote` ([CI plan §3d](../../plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)); `ci.yml`'s `lockfile` job passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The dry run, recorded in the pull request description.

## Docs to update

CI plan (a new release section), CONTRIBUTING.md, AGENTS.md's `.github/workflows/` line, the plan's todo table.

## Risks and open questions

A pull request opened with `GITHUB_TOKEN` starts its `ci.yml` runs in an approval-required state, which a person with write access approves ([GitHub docs](https://docs.github.com/en/actions/concepts/security/github_token)); say whether the release pull request uses that, or the `SDK_UPDATES_TOKEN` pattern from the SDK-updates workflow.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
