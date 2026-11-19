# Changesets: one file per user-facing change, versioned as one group

Add a changeset to every pull request that changes what users of `@buildanagent/gateway` or `@buildanagent/sdk` get. A changeset is a small Markdown file in this folder that names the bump and says what changed. After your pull request merges, `release.yml` runs `pnpm changeset version`, which turns the pending changesets into a new version and `CHANGELOG.md` entries, and puts them in a "Version packages" pull request. When GitHub auto-merges that pull request, `release.yml` publishes the version to npm, as [the release section](#each-merged-version-packages-pull-request-publishes-an-alpha) explains. [Changesets](https://github.com/changesets/changesets) does the versioning; `config.json` holds our settings.

## Add a changeset with `pnpm changeset`

Run `pnpm changeset` at the repo root, choose the package you changed and the bump, and write a one-line summary for the changelog. Name only the package you changed; the fixed group below moves the other. Commit the file it writes with your change. To skip the prompts:

```bash
pnpm changeset --minor @buildanagent/gateway -m "Retry rate-limited requests"
```

Run `pnpm changeset status --verbose` to see the versions the pending changesets would produce.

## Both packages always share one version

The gateway and the SDK form one `fixed` group, so a bump to either moves both to the same version. The SDK depends on the gateway's types, and a user should never have to match two version numbers.

## Under 0.x, a breaking change is a `minor` bump that says so

Both packages stay at 0.x, so a change that breaks the API is a `minor` bump, never a `major` one. Its summary starts with "Breaking Changes" and says what breaks and how to migrate. A `patch` never breaks the API. The rule is decision D8 in the [SDK plan](../docs/plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-accepted) and [ADR 0008](../docs/decisions/0008-versioning-and-doc-checks.md).

## Both packages are versioned, and the harnesses never are

Both packages dropped `private` in todo L4a, so `pnpm changeset` offers them and `pnpm changeset version` moves them off 0.0.0 once a changeset is pending. `privatePackages` in `config.json` still tells Changesets to skip private packages. That setting skips the harnesses under `verify/` and the private textbook app, `@buildanagent/manual`, and it will skip the private apps and packages the plans add. A changeset that names only such a package is never consumed, so the gate doesn't accept one. The harnesses are also listed in `ignore`, so they are never versioned.

## Each merged Version packages pull request publishes an alpha

The owner decided on 2026-11-19: "let's make the releases automated too. Let's keep it alpha for now until we're ready to publish", and then "let's make the publishes run on every change to the package". Asked whether the version step should be "a pr that will be autocompleted", the owner answered "yes". So the repo is in Changesets pre mode with the tag `alpha`, which `pnpm changeset pre enter alpha` set up in `pre.json`, and a release takes four steps:

1. Your pull request adds a changeset and merges.
2. `release.yml` runs `pnpm changeset version` on `main`, which moves both packages to the next prerelease, such as `0.1.0-alpha.1`. In pre mode, Changesets 3 moves the changesets it consumed into `pre/` instead of deleting them, because they become the changelog of the stable release.
3. The workflow checks that the result changes only versions, changelogs and changesets, pushes it to the `changeset-release/main` branch and opens a "Version packages" pull request with auto-merge on. A changeset merged while that pull request is open updates it, so several changes ship as one alpha.
4. Once the required checks pass, GitHub squash-merges the pull request, and the push to `main` publishes both packages under npm's `alpha` dist-tag, then tags the release `v<version>` and marks its GitHub release as a prerelease.

`latest` stays on the deprecated placeholder `0.0.0-bootstrap.0` until the first stable release, so users install with `pnpm add @buildanagent/sdk@alpha`. The details are in the [CI plan](../docs/plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19).

## Leave alpha with `pnpm changeset pre exit`

When the owner is ready for a stable release, open a pull request that runs `pnpm changeset pre exit`, which sets `"mode": "exit"` in `pre.json`. Changesets then asks you to review the changesets in `pre/`, because the next version uses them as the stable release's changelog; keep only those that matter to users of the stable version. Once that pull request merges, `release.yml` runs `pnpm changeset version`, which gives both packages a plain version such as `0.1.0` and deletes `pre.json` and the changesets in `pre/`, and opens the Version packages pull request for it. When that pull request merges, the workflow publishes the version under `latest`, which moves `latest` off the placeholder.

## CI checks for a changeset

CI's `changesets` job fails a pull request that changes a package's shipped files without a changeset. `changedFilePatterns` in `config.json` lists those files: everything under `src/`, plus `package.json` and `tsconfig.build.json`. The last two count because a dependency bump or a build setting reaches users as surely as a code change. Changes anywhere else, such as docs, tests outside `src/` or workflows, need none.

The job runs `scripts/ci/changeset-gate.mjs`, which lets one kind of change through without a changeset: a version bump that `pnpm changeset version` made. Such a change touches no shipped file except the `package.json` of every versioned package, each differing from `main` only in `version`, with a `CHANGELOG.md` section for the new version. Both packages must move to one version, later than the one on `main`, and in pre mode that version must be an `alpha` prerelease. Every other change to shipped files must add or edit a changeset in this folder, not in `pre/`, that names a package Changesets versions, and then pass `pnpm changeset status --since=origin/main`. A bump that also changes `src/` is no exception. An edit to a changeset in `pre/` doesn't count, because a prerelease already consumed it and the change would never publish.

When a pull request touches those files but users get nothing new, as with an internal rename or a devDependency bump, run `pnpm changeset --empty`. It writes a changeset that names no package, which satisfies the check and adds nothing to the changelog.
