# The release.yml that publishes six packages (L11)

This document holds the whole `.github/workflows/release.yml` that releases the six `@buildanagent` packages: gateway, SDK, agent-safety, protocol, harness and CLI, in that order ([PB4](../publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted), [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md)). Sessions never edit `.github/`, so todo [L11](../../todos/ongoing/L11-bootstrap-and-release-protocol-harness-cli.md) delivers the file here. The owner copies the code block below to `.github/workflows/release.yml` on L11's branch before merging it, exactly as written and without the fence lines.

The file must land in the same merge as L11. It loops over six packages, while `main`'s `release-plan.mjs` lists two and four of the packages are still private there. Until the owner adds it, four tests in `scripts/ci/release.test.mjs` fail on L11's branch on purpose. They check that the pack, summary and publish loops follow `RELEASE_ORDER`, and they fail with a message naming this document.

## What changed from main's release.yml

The base is `main`'s file at commit `576f7c7` (last changed in `ced295e`). Every change concerns the package list and what the pack job reports about it; the jobs, permissions, triggers, secrets and actions are as they were.

1. **The pack loop covers six packages.** The loop goes from `gateway sdk` to `gateway sdk agent-safety protocol harness cli`, and the step "Pack both packages" becomes "Pack the six packages, gateway first". The order matters here as well as in the publish job: each package's `prepack` builds its `dist/` against the declaration files of the workspace packages it imports, so those packages must already be packed. A local run of the step from empty `dist/` folders packed all six.
2. **The pack step checks each tarball's name.** After packing a package, the step fails unless `buildanagent-<pkg>-<version>.tgz` exists, the file the publish job uploads. It reads `<version>` from that package's own `package.json`, not from the plan, because a `workflow_dispatch` dry run can pack while the versions still differ, as on L11's merge, where four packages sit at 0.0.0 beside `0.1.0-alpha.27`. The step also sets `set -euo pipefail`.
3. **A new step checks the CLI's binary.** The step, "Check the CLI's binary", runs after the pack. It extracts the CLI tarball's `package.json` and `dist/bin.js` into `$RUNNER_TEMP/cli-check`, outside the uploaded `release` folder. It then fails unless `bin.buildanagent` is `./dist/bin.js` and the file's first line is `#!/usr/bin/env node`. Last, it runs `node packages/cli/dist/bin.js --help`, so a binary that can't start stops the release before anything uploads.
4. **The publish loop covers six packages.** The loop of "Publish each tarball, gateway first" goes from `gateway sdk` to the same six names in the same order, so npm never holds a package before a workspace package it depends on. The step keeps its name, its registry check and its `npm publish` flags.
5. **The release notes cover six changelogs without a workflow change.** No edit is needed, because the "Write the release notes" step still runs `node scripts/ci/release-plan.mjs notes`, which joins one section per package in `RELEASE_ORDER`. With L11's `RELEASE_ORDER`, that is six `CHANGELOG.md` files. The four new packages get theirs from the first version commit.
6. **The dry run's summary lists every tarball.** On a `workflow_dispatch`, "Summarise the run" no longer prints the plan's one version, which is the gateway's. It loops over the same six names and prints each tarball with its package's name and version, read from that package's own `package.json`, so a dry run that packs mixed versions reports each one. The step drops its `VERSION` variable and sets `set -euo pipefail`.
7. **The comments name six packages.** The header names the six and PB4 and ADR 0058, and it says that `release.test.mjs` fails when the loops and `RELEASE_ORDER` differ. The concurrency comment says a cancelled publish could upload some packages and not the rest, and the pack job's comment says it packs six.

Three things stay as they were on purpose:

- **The test step.** `pnpm --filter "./packages/*" test` already runs every package's tests before the pack, including the four new packages and the private `evals`.
- **The version guard.** "Refuse a version main has moved past" still reads the gateway's version, which the plan's same-version check makes every package's version before anything publishes.
- **The docs job.** It is unchanged, and still skipped for a prerelease.

## How the file was checked

The YAML parses, every `run` script is valid Bash, and every release test passes against it:

```bash
RELEASE_WORKFLOW=docs/plans/reviews/release-yml-for-six-packages.md node --test scripts/ci/release.test.mjs
```

`RELEASE_WORKFLOW` makes `release.test.mjs` read the one `yaml` block of this document instead of `.github/workflows/release.yml`, and run every test on it. Those tests cover the shape checks (no npm token, one secret in one step, the triggers, permissions and concurrency, the dry run), the loops against `RELEASE_ORDER`, the CLI check, a `bash -n` of every `run` script, and the version and version-pr jobs' scripts, which they run for real against a local Git remote. On 2026-11-22 the run passed 62 tests and skipped 2 that read the checkout's own state: "this checkout, on main, publishes its version under its dist-tag" skips while L11's changeset is pending, and the 0.0.0 check skips because the gateway is at `0.1.0-alpha.27`. The same run against `main`'s file fails exactly the four loop tests.

Each `run` script also passed `bash -n`, and the file parsed with both the `yaml` package the tests use and PyYAML. `actionlint` isn't installed in the session, so it didn't run. Run it on the file after copying it, and run `gh actions-lock --verify`; the file adds no action, so `actions.lock` needs no new entry.

## The file

```yaml
# Publishes the six @buildanagent packages, gateway, sdk, agent-safety, protocol, harness and cli, to npm through
# trusted publishing, with provenance. Changes reach npm through a "Version packages" pull request that GitHub
# auto-merges (publish-and-docs PB2 and PB4, ADR 0047, ADR 0058, docs/plans/ci.md §3f). The package lists in the pack
# and publish loops follow RELEASE_ORDER in scripts/ci/release-plan.mjs, dependencies first, and
# scripts/ci/release.test.mjs fails when they differ.
#
# - `plan` reads the checkout, the npm registry and the GitHub releases (scripts/ci/release-plan.mjs).
# - When changesets are pending, `version` runs `pnpm changeset version` with a read-only token and hands the result
#   to `version-pr`. That job runs no third-party code: it checks the commit with scripts/ci/version-pr.mjs, then,
#   with the RELEASE_PR_TOKEN secret, makes it again through GitHub's API so that GitHub signs it
#   (scripts/ci/version-commit.mjs), force-updates `changeset-release/main` to it, opens or updates the pull request
#   and turns on auto-merge. Every changeset merged before the pull request merges joins it.
# - When the pull request merges, its squash commit reaches main with nothing pending and a version npm lacks, so
#   `pack` builds the tarballs from that commit, and `publish` uploads them under the pre-mode dist-tag (`alpha`) or
#   `latest`, tags the release, marking a prerelease as one, and `docs` starts the docs deploy for a stable release.
# - A workflow_dispatch is a dry run: `plan` and `pack` run, and nothing else, because `version`, `version-pr` and
#   `publish` require a push to main.
#
# No job reads an npm token, and none is stored. The publish job authenticates with its OIDC token alone, so a
# missing or wrong trusted publisher on npmjs.com makes `npm publish` fail with ENEEDAUTH instead of falling back.
name: release

on:
  push:
    branches: [main]
  workflow_dispatch:

# Nothing by default; each job asks for what it needs.
permissions: {}

# One release at a time, and never cancelled: a cancelled publish could upload some packages and not the rest. GitHub
# keeps one run waiting and cancels an older waiting one, which loses nothing: the run that waited last versions or
# plans a commit that holds every change merged before it. A workflow_dispatch dry run waits in its own group, so it
# can never cancel a waiting push run.
concurrency:
  group: release-${{ github.event_name }}
  cancel-in-progress: false

jobs:
  plan:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read
    outputs:
      version: ${{ steps.plan.outputs.version }}
      tag: ${{ steps.plan.outputs.tag }}
      publish: ${{ steps.plan.outputs.publish }}
      needs_version: ${{ steps.plan.outputs.needs_version }}
      dist_tag: ${{ steps.plan.outputs.dist_tag }}
      prerelease: ${{ steps.plan.outputs.prerelease }}
      docs_deploy: ${{ steps.plan.outputs.docs_deploy }}
      node: ${{ steps.plan.outputs.node }}
    steps:
      - uses: actions/checkout@v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7.1.0
        with:
          node-version-file: .nvmrc
      - id: plan
        # GH_TOKEN is the run's read-only GITHUB_TOKEN, for the check that the GitHub release exists.
        env:
          GH_TOKEN: ${{ github.token }}
        # pipefail, because a `run` step without `shell:` doesn't set it, and a failed plan must fail the job.
        run: |
          set -o pipefail
          node scripts/ci/release-plan.mjs plan | tee -a "$GITHUB_OUTPUT"

  # Turns the pending changesets into the next version, such as 0.1.0-alpha.1 in pre mode, and uploads the change as
  # a patch. It runs third-party code, pnpm and Changesets, so it holds only a read-only GITHUB_TOKEN, and checkout
  # keeps no credentials. It versions the newest main, not the commit that started the run, so a run that waited
  # behind another includes every changeset merged before it.
  version:
    name: Version the pending changesets
    needs: plan
    if: >-
      github.event_name == 'push' && github.ref == 'refs/heads/main' && needs.plan.outputs.needs_version == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    outputs:
      base: ${{ steps.base.outputs.base }}
      changed: ${{ steps.version.outputs.changed }}
    steps:
      # Full history, so Changesets can name each changeset's commit in the changelog.
      - uses: actions/checkout@v7.0.1
        with:
          ref: main
          fetch-depth: 0
          persist-credentials: false
      # The base is recorded in its own step, before any third-party code runs: a later step could append its own
      # `base=` line to that step's $GITHUB_OUTPUT, but this step's file is read when the step ends.
      - name: Record the commit the version starts from
        id: base
        run: echo "base=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      - uses: pnpm/action-setup@v6.1.1 # pnpm's version comes from packageManager
      # No dependency cache in a release job: npm's trusted-publishing docs say "never use caching in release builds".
      - uses: actions/setup-node@v7.1.0
        with:
          node-version-file: .nvmrc
      # The root's own devDependencies hold @changesets/cli; nothing else is needed to version.
      - run: pnpm install --frozen-lockfile --filter .
      - name: Version the packages and write the change as a patch
        id: version
        run: |
          set -euo pipefail
          pnpm changeset version
          git add -A
          mkdir -p "$RUNNER_TEMP/version"
          if git diff --cached --quiet; then
            echo "pnpm changeset version changed nothing, so there is no version commit."
            echo "changed=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          git diff --cached --binary --no-renames > "$RUNNER_TEMP/version/version.patch"
          git diff --cached --stat
          echo "changed=true" >> "$GITHUB_OUTPUT"
      - if: steps.version.outputs.changed == 'true'
        uses: actions/upload-artifact@v7.0.2
        with:
          name: version-commit
          path: ${{ runner.temp }}/version
          if-no-files-found: error
          retention-days: 1

  # Puts the version commit on changeset-release/main and keeps the "Version packages" pull request open with
  # auto-merge on. This is the only job that reads RELEASE_PR_TOKEN, a fine-grained token for this repository with
  # Contents and Pull requests write. A push and a pull request made with GITHUB_TOKEN would start ci.yml's runs only
  # after someone approved them, and its merge would start no release run. The job runs no third-party code: no pnpm,
  # no npx and nothing from node_modules, only git, gh and scripts/ci/version-pr.mjs and version-commit.mjs, which
  # import only node: modules and the scripts beside them. The token is in the environment of the last step alone,
  # after the commit has been checked. That step makes the commit again through GitHub's API rather than pushing it
  # with git, so that GitHub signs it and main's "Require signed commits" rule lets the pull request merge. The version
  # job ran third-party code, so its base and patch are untrusted: the base must be a commit on main, and the patch
  # goes into the index alone, so the checker that runs is main's, never one the patch rewrote.
  version-pr:
    name: Open or update the Version packages pull request
    needs: version
    if: needs.version.outputs.changed == 'true'
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      contents: read
    env:
      BASE: ${{ needs.version.outputs.base }}
    steps:
      - uses: actions/checkout@v7.0.1
        with:
          ref: main
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/download-artifact@v8.0.2
        with:
          name: version-commit
          path: ${{ runner.temp }}/version
      # The patch came from a job that ran third-party code, so it is checked before anything is pushed: it may change
      # only what a version commit changes (scripts/ci/version-pr.mjs).
      - name: Commit the version and check that it changes only versions
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if ! [[ "$BASE" =~ ^[0-9a-f]{40}$ ]] || ! git merge-base --is-ancestor "$BASE" HEAD; then
            echo "::error::The version job's base, '$BASE', isn't a commit on main."
            exit 1
          fi
          git checkout --quiet --detach "$BASE"
          # --cached leaves the working tree at the base commit, so the check below runs the base's scripts.
          git apply --cached --binary "$RUNNER_TEMP/version/version.patch"
          git commit --quiet --no-verify -m "chore(release): version packages"
          node scripts/ci/version-pr.mjs prepare "$BASE" HEAD "$RUNNER_TEMP/pr"
          git commit --quiet --no-verify --amend -F "$RUNNER_TEMP/pr/title"
      - name: Commit through the API, open or update the pull request and turn on auto-merge
        env:
          GH_TOKEN: ${{ secrets.RELEASE_PR_TOKEN }}
          REPO: ${{ github.repository }}
          BRANCH: changeset-release/main
        run: |
          set -euo pipefail
          if [ -z "$GH_TOKEN" ]; then
            echo "::error::The RELEASE_PR_TOKEN secret is missing, so the Version packages pull request can't be opened (docs/plans/ci.md §3f)."
            exit 1
          fi
          title=$(cat "$RUNNER_TEMP/pr/title")
          # A commit pushed with git is unsigned, and main's ruleset requires signed commits, so the checked commit is
          # made again through GitHub's API, which signs it. The script runs as the base holds it, since the patch
          # went into the index alone. It writes only this branch, which holds nothing but the latest version
          # commit, and its own staging branch. It fails unless GitHub verified the new commit. When the branch already
          # holds that verified commit, it leaves the branch alone, so a rerun doesn't restart the checks.
          node scripts/ci/version-commit.mjs "$BASE" HEAD "$BRANCH"
          number=$(gh pr list --repo "$REPO" --head "$BRANCH" --base main --state open --json number --jq '.[0].number // empty')
          if [ -z "$number" ]; then
            url=$(gh pr create --repo "$REPO" --base main --head "$BRANCH" --title "$title" --body-file "$RUNNER_TEMP/pr/body.md")
            number=${url##*/}
          else
            gh pr edit "$number" --repo "$REPO" --title "$title" --body-file "$RUNNER_TEMP/pr/body.md"
          fi
          # gh merges at once instead of turning on auto-merge when nothing blocks the merge, so without a required
          # `checks` status on main the pull request would merge before CI ran.
          required=$(gh api "repos/$REPO/branches/main" --jq '.protection.required_status_checks | select(.enforcement_level != "off") | (.contexts // []) + [.checks[]?.context] | any(. == "checks")')
          if [ "$required" != "true" ]; then
            echo "::error::main doesn't require the checks status, so auto-merge would merge pull request #$number before CI passes. It stays open without auto-merge (docs/plans/ci.md §3f)."
            exit 1
          fi
          auto=$(gh pr view "$number" --repo "$REPO" --json autoMergeRequest --jq '.autoMergeRequest != null')
          if [ "$auto" != "true" ]; then
            gh pr merge "$number" --repo "$REPO" --auto --squash
          fi
          echo "Pull request #$number: $title, with auto-merge on." >> "$GITHUB_STEP_SUMMARY"

  # Builds and packs the six packages with a read-only token. Each package's `prepack` builds dist/, so this job runs
  # our build scripts; the publish job then uploads these tarballs without installing or running anything. The release
  # is the run's own commit, which on a push is the squash commit of a merged Version packages pull request.
  pack:
    needs: plan
    if: >-
      ${{ !cancelled() && needs.plan.result == 'success' &&
      (github.event_name == 'workflow_dispatch' || needs.plan.outputs.publish == 'true') }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    permissions:
      contents: read
    outputs:
      sha: ${{ github.sha }}
      version: ${{ needs.plan.outputs.version }}
      tag: ${{ needs.plan.outputs.tag }}
      publish: ${{ needs.plan.outputs.publish }}
      dist_tag: ${{ needs.plan.outputs.dist_tag }}
      prerelease: ${{ needs.plan.outputs.prerelease }}
      docs_deploy: ${{ needs.plan.outputs.docs_deploy }}
      node: ${{ needs.plan.outputs.node }}
    steps:
      - uses: actions/checkout@v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@v6.1.1
      # No dependency cache: what ships must come from a clean install.
      - uses: actions/setup-node@v7.1.0
        with:
          node-version-file: .nvmrc
      - run: pnpm install --frozen-lockfile --filter . --filter "./packages/*"
      - run: pnpm --filter "./packages/*" test
      # Dependencies first, as RELEASE_ORDER lists them: a package's build reads the types of the workspace packages it
      # imports from their dist/, which their own prepack has written by then. Each tarball must then exist under the
      # name the publish job uploads, read from the package's own version, because a dry run may pack while the
      # versions still differ.
      - name: Pack the six packages, gateway first
        run: |
          set -euo pipefail
          mkdir -p "$RUNNER_TEMP/release"
          for pkg in gateway sdk agent-safety protocol harness cli; do
            pnpm --dir "packages/$pkg" pack --pack-destination "$RUNNER_TEMP/release"
            version=$(node -p "require('./packages/$pkg/package.json').version")
            if [ ! -f "$RUNNER_TEMP/release/buildanagent-$pkg-$version.tgz" ]; then
              echo "::error::pnpm pack didn't write buildanagent-$pkg-$version.tgz."
              exit 1
            fi
          done
      # The CLI is the one package with a binary. Its tarball must name dist/bin.js as `buildanagent` and ship it with
      # the shebang that makes it run, and the built file must start and print its help.
      - name: Check the CLI's binary
        run: |
          set -euo pipefail
          version=$(node -p "require('./packages/cli/package.json').version")
          cli="$RUNNER_TEMP/release/buildanagent-cli-$version.tgz"
          mkdir -p "$RUNNER_TEMP/cli-check"
          tar -xzf "$cli" -C "$RUNNER_TEMP/cli-check" package/package.json package/dist/bin.js
          node -e '
            const manifest = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            if (manifest.bin?.buildanagent !== "./dist/bin.js") throw new Error(`the CLI tarball has bin ${JSON.stringify(manifest.bin)}`);
          ' "$RUNNER_TEMP/cli-check/package/package.json"
          if [ "$(head -n 1 "$RUNNER_TEMP/cli-check/package/dist/bin.js")" != "#!/usr/bin/env node" ]; then
            echo "::error::The CLI tarball's dist/bin.js doesn't start with #!/usr/bin/env node."
            exit 1
          fi
          node packages/cli/dist/bin.js --help > /dev/null
      - name: Write the release notes
        if: needs.plan.outputs.publish == 'true'
        run: node scripts/ci/release-plan.mjs notes "$RUNNER_TEMP/release/release-notes.md"
      # The summary names each tarball with its own package's version, because a dry run may pack mixed versions.
      - name: Summarise the run
        env:
          PUBLISH: ${{ needs.plan.outputs.publish }}
          EVENT: ${{ github.event_name }}
        run: |
          set -euo pipefail
          {
            if [ "$EVENT" = "workflow_dispatch" ]; then
              echo "Dry run: built and packed these tarballs; nothing was published."
              echo
              for pkg in gateway sdk agent-safety protocol harness cli; do
                version=$(node -p "require('./packages/$pkg/package.json').version")
                echo "- \`buildanagent-$pkg-$version.tgz\`: @buildanagent/$pkg $version"
              done
              echo
            fi
            echo "Plan says publish: **$PUBLISH**"
            for file in "$RUNNER_TEMP"/release/*.tgz; do
              echo
              echo "\`$(basename "$file")\`"
              echo '```'
              tar -tzf "$file"
              echo '```'
            done
          } >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v7.0.2
        with:
          name: release
          path: ${{ runner.temp }}/release
          if-no-files-found: error
          # Long enough to re-run a failed publish job from the same tarballs.
          retention-days: 30

  # Uploads the tarballs to npm through trusted publishing. Only a push to main gets here. The `release` environment
  # has no approval rule since the owner removed it on 2026-11-19, so the job runs unattended. It checks nothing out
  # and installs nothing but npm.
  publish:
    needs: pack
    if: >-
      ${{ !cancelled() && needs.pack.result == 'success' && github.event_name == 'push' &&
      github.ref == 'refs/heads/main' && needs.pack.outputs.publish == 'true' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: release
    permissions:
      contents: write # the tag and the GitHub release
      id-token: write # the OIDC token npm exchanges for a short-lived publish token
    env:
      VERSION: ${{ needs.pack.outputs.version }}
      TAG: ${{ needs.pack.outputs.tag }}
      SHA: ${{ needs.pack.outputs.sha }}
      DIST_TAG: ${{ needs.pack.outputs.dist_tag }}
      PRERELEASE: ${{ needs.pack.outputs.prerelease }}
    steps:
      # npm's user config names the registry and its global config is empty. Neither holds credentials, and the job
      # checks nothing out, so there's no project .npmrc either and no token to fall back on. The two settings must name
      # different files, because npm refuses to load one file as both ("double-loading config"). The paths go through
      # $GITHUB_ENV because a job's `env:` can't read the `runner` context.
      - name: Write an npm config with no credentials
        run: |
          echo "registry=https://registry.npmjs.org/" > "$RUNNER_TEMP/npmrc"
          : > "$RUNNER_TEMP/global-npmrc"
          {
            echo "RELEASE_DIR=$RUNNER_TEMP/release"
            echo "NPM_CONFIG_USERCONFIG=$RUNNER_TEMP/npmrc"
            echo "NPM_CONFIG_GLOBALCONFIG=$RUNNER_TEMP/global-npmrc"
          } >> "$GITHUB_ENV"
      # No registry-url: setup-node would write an .npmrc that reads NODE_AUTH_TOKEN.
      - uses: actions/setup-node@v7.1.0
        with:
          node-version: ${{ needs.pack.outputs.node }}
          package-manager-cache: false
      - uses: actions/download-artifact@v8.0.2
        with:
          name: release
          path: ${{ runner.temp }}/release
      # Node 22 ships npm 10, and trusted publishing needs npm 11.5.1 or later.
      - run: npm install --global npm@11.21.2
      - name: Check the toolchain and that no npm token is present
        run: |
          node -e '
            const [major, minor] = process.versions.node.split(".").map(Number);
            if (major < 22 || (major === 22 && minor < 14)) throw new Error(`trusted publishing needs Node 22.14.0 or later, found ${process.version}`);
          '
          test "$(npm --version)" = "11.21.2"
          # A prerelease goes under its pre-mode dist-tag and a stable release under `latest`, never the other way.
          if [ "$PRERELEASE" = "true" ]; then
            ok=$([ -n "$DIST_TAG" ] && [ "$DIST_TAG" != "latest" ] && echo yes || echo no)
          else
            ok=$([ "$DIST_TAG" = "latest" ] && echo yes || echo no)
          fi
          if [ "$ok" != "yes" ]; then
            echo "::error::Refusing to publish $VERSION (prerelease: $PRERELEASE) under the dist-tag '$DIST_TAG'."
            exit 1
          fi
          # Names only: printing a matching line would put its value, which may not be masked, in the log.
          if env | cut -d= -f1 | grep -iE '^(NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG_.*(AUTH|TOKEN).*)$'; then
            echo "::error::An npm token is set. release.yml publishes through trusted publishing only."
            exit 1
          fi
      # A re-run of an older run could otherwise publish an older version after a newer one and move the dist-tag
      # back, so the job publishes only the version main holds now. A normal run always matches: only a merged Version
      # packages pull request changes main's version, and runs wait for each other.
      - name: Refuse a version main has moved past
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
        run: |
          set -euo pipefail
          current=$(gh api "repos/$REPO/contents/packages/gateway/package.json?ref=main" -H "Accept: application/vnd.github.raw" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
          if [ "$current" != "$VERSION" ]; then
            echo "::error::main is at $current, so this run won't publish $VERSION. The next push to main releases $current."
            exit 1
          fi
      # A rerun after a partial failure skips what npm already holds. npm adds provenance on its own only from a public
      # repository; `--provenance` makes the publish fail instead of shipping a release without it. `--tag` names the
      # dist-tag, which npm requires for a prerelease, so an alpha never moves `latest`. The order is RELEASE_ORDER's,
      # dependencies first, so npm never holds a package whose workspace dependency at that version is missing.
      - name: Publish each tarball, gateway first
        run: |
          set -euo pipefail
          for pkg in gateway sdk agent-safety protocol harness cli; do
            status=$(curl -sS --retry 3 -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/@buildanagent%2f$pkg/$VERSION")
            case "$status" in
              200) echo "@buildanagent/$pkg@$VERSION is already on npm; skipping it."; continue ;;
              404) ;;
              *) echo "::error::The registry answered $status for @buildanagent/$pkg@$VERSION."; exit 1 ;;
            esac
            npm publish "$RELEASE_DIR/buildanagent-$pkg-$VERSION.tgz" --tag "$DIST_TAG" --access public --provenance
          done
      # Creating the release creates the tag at the released commit, the run's own. A tag that `release.yml` pushes
      # with GITHUB_TOKEN starts no workflow, so the docs deploy is started by the next job instead.
      - name: Tag the release and create its GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
        run: |
          if gh release view "$TAG" --repo "$REPO" > /dev/null 2>&1; then
            echo "The GitHub release $TAG already exists."
            exit 0
          fi
          # Branch on gh's exit status: on an error, gh prints the error body to stdout and skips --jq.
          if ref=$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq '.object.type + " " + .object.sha' 2> "$RUNNER_TEMP/tag-error"); then
            read -r type existing <<< "$ref"
            # An annotated tag's ref points at the tag object, so peel it to the commit.
            if [ "$type" = "tag" ]; then existing=$(gh api "repos/$REPO/git/tags/$existing" --jq .object.sha); fi
            if [ "$existing" != "$SHA" ]; then
              echo "::error::The tag $TAG already points at $existing, not $SHA."
              exit 1
            fi
          elif ! grep -q "HTTP 404" "$RUNNER_TEMP/tag-error"; then
            cat "$RUNNER_TEMP/tag-error"
            echo "::error::Couldn't tell whether the tag $TAG exists."
            exit 1
          fi
          flags=()
          if [ "$PRERELEASE" = "true" ]; then flags+=(--prerelease); fi
          gh release create "$TAG" --repo "$REPO" --target "$SHA" --title "$TAG" --notes-file "$RELEASE_DIR/release-notes.md" "${flags[@]}"

  # Deploys the docs for the new tag (DS4). A workflow_dispatch sent with GITHUB_TOKEN still creates a run, unlike the
  # tag push. Skipped, not failed, while docs-deploy.yml doesn't exist yet (L8), and for a prerelease, because the
  # production docs follow stable releases only; next.docs follows main in the meantime.
  docs:
    needs: [pack, publish]
    if: >-
      ${{ !cancelled() && needs.publish.result == 'success' && needs.pack.outputs.docs_deploy == 'true' &&
      needs.pack.outputs.prerelease == 'false' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      actions: write
    steps:
      - name: Start the docs deploy for the release tag
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          TAG: ${{ needs.pack.outputs.tag }}
        run: gh workflow run docs-deploy.yml --repo "$REPO" --ref main -f tag="$TAG"
```
