# Changesets: one file per user-facing change, versioned as one group

Add a changeset to every pull request that changes what users of `@buildanagent/gateway` or `@buildanagent/sdk` get. A changeset is a small Markdown file in this folder that names the bump and says what changed. When a release is cut, `pnpm changeset version` turns the pending changesets into new versions and `CHANGELOG.md` entries, and deletes them. [Changesets](https://github.com/changesets/changesets) does the work; `config.json` holds our settings.

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

Both packages dropped `private` in todo L4a, so `pnpm changeset` offers them and `pnpm changeset version` moves them off 0.0.0 once a changeset is pending. `privatePackages` in `config.json` still tells Changesets to skip private packages, which today affects only the harnesses under `verify/`, and later the private apps and packages the plans add. The harnesses are also listed in `ignore`, so they are never versioned.

## CI checks for a changeset once publishing starts

CI's `changesets` job runs `pnpm changeset status --since=origin/main` and fails a pull request that changes a package's shipped files without a changeset. `changedFilePatterns` in `config.json` lists those files: everything under `src/`, plus `package.json` and `tsconfig.build.json`. The last two count because a dependency bump or a build setting reaches users as surely as a code change. Changes anywhere else, such as docs, tests outside `src/` or workflows, need none. The job stays off until the first release.

When a pull request touches those files but users get nothing new, as with an internal rename or a devDependency bump, run `pnpm changeset --empty`. It writes a changeset that names no package, which satisfies the check and adds nothing to the changelog.
