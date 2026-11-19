# L2: Version both packages with Changesets in one fixed group

| Field | Value |
| --- | --- |
| ID | `L2` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | [L1](../done/L1-build-dist-packages.md) |
| Size | S |

## Goal

Record every user-facing change as a changeset, version the gateway and SDK together, and write their changelogs ([PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted), ADR 0047).

## Context

- [PB2](../../plans/publish-and-docs.md#pb2-changesets-in-one-fixed-group-published-only-from-ci-accepted) and [ADR 0047](../../decisions/0047-first-release-and-trusted-publishing.md)
- [D8](../../plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-accepted): the 0.x rule
- Lamina PDF's `.changeset/config.json`

## Scope

**In scope**

- `@changesets/cli` pinned in the root (3.0.3, or the newest release at least a week old when the todo starts)
- `.changeset/config.json`: `fixed: [["@buildanagent/gateway", "@buildanagent/sdk"]]`, `access: "public"`, `baseBranch: "main"`, the apps and `verify/*` in `ignore`, and `privatePackages: { "version": false, "tag": false }`, so nothing versions the packages while they are private
- A `.changeset/README.md` with the 0.x rule: a breaking change is a `minor` bump whose summary starts "Breaking Changes"
- A CI step that fails a pull request changing `packages/*/src` without a changeset, written in L2 but switched on in L4b, because the owner said "Changesets wait until we publish"

**Out of scope** (and which todo covers it)

- The release workflow (L3)

## Acceptance criteria

- [x] `pnpm changeset` writes a changeset, and `pnpm changeset status` lists both packages in one fixed group
- [x] On a throwaway branch with `private` removed from both packages, never merged, `pnpm changeset version` bumps both to the same version and writes both `CHANGELOG.md` files; the pull request description records the run
- [x] On a test branch with the step switched on, a pull request that edits `packages/gateway/src` without a changeset fails, and passes once one is added; on `main` the step stays off until L4b
- [x] `pnpm changeset version` on `main`, with the packages still private, leaves both at 0.0.0
- [x] A pull request that edits only `docs/` needs no changeset
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The CI step's behaviour, recorded on a test branch in the pull request description.

## Docs to update

CONTRIBUTING.md (adding a changeset), AGENTS.md's Git section, CI plan §3, the plan's todo table.

## Risks and open questions

`changeset status` compares against `origin/main`; a shallow checkout needs enough history.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `@changesets/cli` is pinned at 3.0.3, published 2026-09-14 and still the newest release on 2026-11-19. Nothing it installs has an install script, so `onlyBuiltDependencies` is unchanged, and `pnpm audit` found no vulnerabilities.
- `.changeset/config.json` also sets `changedFilePatterns: ["src/**", "package.json", "tsconfig.build.json"]`, so only a package's source, manifest and build settings count as a change. The first code review added the last two, because a runtime dependency bump reaches users as surely as a code change. A change to those files that users don't see takes `pnpm changeset --empty`. The config also sets `format: false`, because Biome doesn't format Markdown. `ignore` lists `@buildanagent/verify-*`; there are no apps yet, and L5 and L7 add theirs when they create them.
- The first criterion can't pass on `main`: while the packages are private, `pnpm changeset` stops with "No versionable packages found". It was checked on the same local throwaway branch as the second, with `private` removed from both packages. There, `pnpm changeset --minor @buildanagent/gateway -m "Add the first model call"` wrote a changeset, `pnpm changeset status --verbose` listed both packages for a minor bump to 0.1.0, and `pnpm changeset version` took both to 0.1.0 and wrote both `CHANGELOG.md` files. The gateway's lists the change under "Minor Changes"; the SDK's lists "Updated dependencies: @buildanagent/gateway@0.1.0" under "Patch Changes".
- On this branch, with both packages private, a `minor` changeset for the gateway and `pnpm changeset version` left both at 0.0.0, wrote no changelog, and left the changeset in place.
- The CI check is `ci.yml`'s `changesets` job, which runs `pnpm changeset status --since=origin/main` and is off with `if: false`. L4b switches it on by changing that line to `if: true`. It was tested on pushes to the throwaway branch `test/L2-gate`, not on pull requests, with the job switched on, `private` dropped from both packages and the push trigger widened to that branch. A docs-only commit passed (run 44497669322), an edit to `packages/gateway/src/retry.ts` without a changeset failed (run 44497925125), and adding a changeset made it pass (run 44498147370). [CI plan §3e](../../plans/ci.md#3e-a-changeset-check-off-until-the-first-release-added-2026-11-19) records the job and the runs.
- No `pull_request` run has exercised the job yet, so the third criterion rests on the push runs and a local stand-in for a pull request's merge ref. That stand-in was a merge commit of the branch into `origin/main`, like the one GitHub checks out, with `private` dropped and the widened patterns. There, a `package.json`-only change failed, an empty changeset made it pass, a `src/` edit failed again and a `patch` changeset made it pass. L4b's own pull request is the first `pull_request` run of the job.
