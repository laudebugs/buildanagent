# Release run 45067734004's E409 came from npm's publish lag, not from two runs publishing at once

On 2026-11-22, `release.yml` run [45067734004](https://github.com/laudebugs/buildanagent/actions/runs/45067734004) failed in its `publish` job with `E409 Cannot publish over previously staged version "0.1.0-alpha.28"` for `@buildanagent/harness`. The run started from `39f83d4`, the merge of N43 (#330), three seconds after #335, the "Version packages to 0.1.0-alpha.28" pull request, merged as `1f94c1e`. The obvious reading was that the two release runs published at the same moment and collided on the harness. The job timestamps refute that reading. The workflow's concurrency group made the second run wait until the first had finished, so the two runs never overlapped. The second run failed for another reason. npm makes an accepted publish public one to three minutes after `npm publish` returns. Until then, the version endpoint answers 404, and a second publish of the version gets the 409. Nothing on npm is wrong: all six packages are public at `0.1.0-alpha.28` under `alpha`, each with provenance from the first run. This document gives the timeline, the root cause, a process rule, and a whole-file `release.yml` for the owner that turns this 409 into a checked success instead of a red run.

Every timestamp below is UTC. The job times come from `gh api repos/laudebugs/buildanagent/actions/runs/<id>/jobs`, the step times from each job's log (`gh api .../actions/jobs/<id>/logs`), and npm's times from the registry documents, all read on 2026-11-22. The fact-check rows are `docs/release-race-409-1` onward in [fact-check-publish-and-docs.md](fact-check-publish-and-docs.md#release-run-45067734004s-e409-2026-11-22).

## The two runs ran one after the other

Run A is [45067729944](https://github.com/laudebugs/buildanagent/actions/runs/45067729944), started by `1f94c1e` (#335). Run B is [45067734004](https://github.com/laudebugs/buildanagent/actions/runs/45067734004), started by `39f83d4` (N43, #330). Run B's first job was created at 20:42:42, the same second run A's `publish` job finished, so run B did nothing while run A ran.

| Time | Run | Event |
| --- | --- | --- |
| 20:40:10 | | #335 merges as `1f94c1e`, versioning all six packages to `0.1.0-alpha.28` |
| 20:40:13 | | #330 (N43) merges as `39f83d4`, whose parent is `1f94c1e` |
| 20:40:13 | A | Run A is created |
| 20:40:15 | B | Run B is created; it waits in the `release-push` concurrency group |
| 20:40:21 | A | `plan`: `publish=true`, because npm holds none of the six at `0.1.0-alpha.28` |
| 20:40:26–20:41:55 | A | `pack` builds the six tarballs from `1f94c1e` |
| 20:42:10 | A | `publish` checks the registry: all six answer 404 |
| 20:42:14 → 20:42:37 | A | `npm publish` returns `+` for gateway (20:42:14), SDK (20:42:18), agent-safety (20:42:23), protocol (20:42:28), harness (20:42:32) and CLI (20:42:37) |
| 20:42:39 | A | The GitHub release `v0.1.0-alpha.28` is published, its tag at `1f94c1e` |
| 20:42:42 | A, B | Run A's `publish` job completes; run B's `plan` job is created the same second |
| 20:42:51 | B | `plan`: `publish=true`, because npm "doesn't hold" any of the six at `0.1.0-alpha.28` |
| 20:42:57–20:44:59 | B | `pack` builds the six tarballs from `39f83d4`, still versioned `0.1.0-alpha.28` |
| 20:43:33 → 20:44:33 | | npm makes four packages public: SDK (20:43:33), gateway (20:43:50), agent-safety (20:43:58), protocol (20:44:33) |
| 20:45:13–20:45:14 | B | `publish` skips gateway, SDK, agent-safety and protocol as "already on npm"; harness answers 404 |
| 20:45:15–20:45:18 | B | `npm publish` of the harness signs provenance, then gets E409 "Cannot publish over previously staged version" |
| 20:45:19 | B | The `publish` job fails; the `docs` job is skipped |
| 20:45:40, 20:45:44 | | npm makes the harness and the CLI public |

The npm times in the table are each version's entry in the package document's `time` field. For each package, that entry falls 75 to 187 seconds after run A's `npm publish` returned, measured from the millisecond timestamps; the harness's 187 seconds run from 20:42:32.98 to 20:45:40.03, so the table's whole seconds read 188. The two earlier alphas show the same delay: the gateway at `0.1.0-alpha.26` went public 76 seconds after its publish returned, and at `0.1.0-alpha.27` 96 seconds after.

## The root cause is a 404 for a version npm has accepted but not yet made public

Three explanations were offered for how two runs could publish at once: a workflow-level group with `cancel-in-progress: false`, a queued run whose plan ran early, and a group that didn't apply. The logs show that the runs never overlapped. Three findings from the logs settle the question:

1. **The concurrency group applied, and it serialised the runs.** `release.yml` sets `concurrency` at the workflow level, with `group: release-${{ github.event_name }}` and `cancel-in-progress: false`. Both runs were pushes, so both joined `release-push`. The group holds no ref or SHA, so every push run to `main` shares it. Run B's jobs were all created at or after 20:42:42, when run A's last job ended. GitHub held run B in the group for those 2 minutes 27 seconds; the jobs API shows no job of run B before then.
2. **Run B's plan ran after run A's publishes, not before.** Run B's `plan` ran at 20:42:51, 14 seconds after run A's last `npm publish` returned and 12 seconds after the GitHub release existed. It still read 404 for all six packages, because npm had made none of them public yet.
3. **npm's lag, not a race, produced the 409.** By 20:45:13, npm had made four packages public, so run B's `publish` step skipped them. The harness was still waiting, so its version endpoint answered 404. Run B then tried to publish it, and npm refused, because the version index already held run A's harness. npm's [`npm stage` page](https://docs.npmjs.com/cli/v11/commands/npm-stage) says staged packages "share the same semver version unique index as published packages", and that a staged version is "not available for public access" until it is approved. Run A used plain `npm publish`, not `npm stage publish`. The error's wording and the 1–3 minute delay suggest that npm holds every trusted publish in a similar staged state before it goes public. That reading is an inference from this run, not a documented rule.

The provenance confirms that run B published nothing. Every package's SLSA statement on npm names run A (`runs/45067729944/attempts/1`) and commit `1f94c1e`. Run B's harness publish wrote a provenance statement to the transparency log (log index 4048236343) before the 409, but npm never attached it to a version.

Two findings follow from the timeline:

- **The plan publishes by version, not by commit.** Run B's `plan` saw `0.1.0-alpha.28` with nothing pending, and npm answering 404, so it set `publish=true` for `39f83d4`. Had npm accepted the upload, the harness would hold N43's code under a version whose changelog doesn't describe it. npm's version index refused it, and the "Refuse a version main has moved past" guard couldn't, because `main` was still at `0.1.0-alpha.28`. The GitHub release check in `release-plan.mjs` runs only when npm holds all six packages, so the existing release at 20:42:39 didn't stop the plan.
- **npm made the packages public in a different order from the publishes.** Run A published gateway first, but npm showed the SDK 17 seconds before the gateway. For those 17 seconds, `@buildanagent/sdk@0.1.0-alpha.28` was installable while its dependency `@buildanagent/gateway@0.1.0-alpha.28` answered 404. The publish step's comment, that npm "never holds a package whose workspace dependency at that version is missing", holds for the order of the uploads only.

## Proposal (a): nothing merges to main until a release is public

**The rule.** After a "Version packages" pull request merges, merge nothing else into `main` until its `release.yml` run has completed and all six packages answer at the new version on npm. That takes about five minutes from the merge. A pull request with auto-merge on counts as a merge, so turn its auto-merge off for that window.

**How to check it.** Before merging into `main`, run both checks; merge only when the first prints nothing and the second prints six versions:

```bash
gh run list --repo laudebugs/buildanagent --workflow release.yml --branch main --limit 5 \
  --json databaseId,status,displayTitle --jq '.[] | select(.status != "completed")'
version=$(gh api "repos/laudebugs/buildanagent/contents/packages/gateway/package.json?ref=main" \
  -H "Accept: application/vnd.github.raw" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version')
for pkg in gateway sdk agent-safety protocol harness cli; do
  curl -fsS "https://registry.npmjs.org/@buildanagent%2f$pkg/$version" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).version'
done
```

The first check returns any release run that is queued, waiting or in progress. The second reads the version from `main` itself, not from a local checkout that may be stale, and asks each package's version endpoint, which answers 404 until npm makes the version public; `curl -f` then fails, so the loop prints fewer than six version lines. A coordinating session can run both before it merges anything into `main`.

The rule alone leaves a gap: two merges within seconds of each other, as here, can happen before anyone checks. Proposal (b) closes that gap in the workflow itself.

## Proposal (b): treat a staged-version 409 as a check, not a failure

**The change.** The publish step keeps its registry check and its `npm publish` command unchanged. It now saves npm's output. When `npm publish` fails with `npm error code E409` and "Cannot publish over previously staged version" for the run's version, and only then, the step waits up to 8 minutes for the version endpoint to answer 200. It then runs a checker that accepts the version only when all four of these hold:

1. The package's registry document holds the version, and the run's dist-tag (`alpha` now) names it.
2. The version carries SLSA v1 provenance.
3. The provenance names `https://github.com/<this repository>`, `.github/workflows/release.yml` and `refs/heads/main` as its workflow, a `push` event and this repository's numeric id.
4. The provenance's subject digest equals the sha512 `integrity` of the tarball npm holds.

The checker is a Node script that imports nothing, written to `$RUNNER_TEMP` from a quoted heredoc. Any other npm error exits as before. A staged version that stays hidden for 8 minutes, or fails any of the four checks, fails the job with an `::error::` naming the check. The job's `timeout-minutes` rises from 15 to 25 to leave room for the wait.

**Why it is safe.** The job's permissions (`contents: write`, `id-token: write`), its `environment: release`, its `if:` condition, the npm install, the token guard, the version guard and the `npm publish` flags are all unchanged. The step reads no secret and no GitHub token. It adds two plain environment values, `REPO` and `REPO_ID`, taken from `github.repository` and `github.repository_id` in `env:`, never expanded inside the script. The new path publishes nothing: it only decides whether to continue after npm has refused a publish. It accepts only a version that this repository's `release.yml` built on a push to `main`, which only a run in the `release` environment can publish through trusted publishing. A fork, a pull request or a `workflow_dispatch` run can't reach the publish job, and couldn't mint that provenance if it did.

**Why it doesn't hide a real failure.** The step accepts one refusal, a staged-version 409 for its own version, and it accepts it only when what npm holds is an upload this workflow made from `main`, under the right dist-tag and with provenance. An E403 from a missing trusted publisher, an E409 for another version, a registry error, a version that never goes public, or a version built anywhere else still fails the run. In run B's case, the step would have waited about half a minute for the harness and checked run A's upload. The CLI went public 4 seconds after the harness, so the step would then have skipped it as already on npm, or met the same 409 and waited again. Either way the run would have ended green, with nothing published by run B. That outcome matches what happened on npm.

The checker reads npm's attestation record but doesn't verify its Sigstore signature; npm checks provenance when it accepts the upload. To verify the signature as well, a later change could run `npm audit signatures`, which needs an installed project.

**How it was checked.** The YAML parses with the `yaml` package the tests use and with PyYAML, and every `run` script passes `bash -n`. `release.test.mjs` read the document's one `yaml` block:

```bash
RELEASE_WORKFLOW=docs/plans/reviews/release-race-409.md node --test scripts/ci/release.test.mjs
```

On 2026-11-22 the run passed 63 of 64 tests and skipped 1, the 0.0.0 check, which skips because the packages are at `0.1.0-alpha.28`. The same command without `RELEASE_WORKFLOW`, against `main`'s file, gives the same counts.

The checker also ran against the live registry. For `@buildanagent/harness@0.1.0-alpha.28` with this repository's name and id and the `alpha` dist-tag, it passed and named commit `1f94c1e`. With the repository `someone/fork`, the dist-tag `latest`, the repository id `999` or the version `0.1.0-alpha.27`, it failed with an error naming the mismatch. A simulation of the whole step, with stand-ins for `npm`, `curl` and `sleep`, covered three cases. A harness 409 whose version went public on the third poll continued to the CLI and exited 0. An E403 exited 1 at once. A 409 whose version never went public exited 1 at the deadline.

`release.test.mjs` gains no new test with this document. A test for the 409 path would fail against `main`'s current `release.yml` until the owner adds the file, and so would break CI. Once the owner copies the file, a test should require the E409 match, the wait and the provenance checker in the publish step.

### A follow-up for release-plan.mjs

A smaller fix would have stopped run B at its `plan`. `planRelease` checks for the GitHub release `v<version>` only when npm holds every package. If it checked first, and skipped when the release exists and its tag points at another commit, run B would have skipped at 20:42:51, because run A had published the release at 20:42:39. The release is the publish job's last step, so it exists only after every upload has returned. That change touches the plan's tests and the rerun case, so it belongs in its own pull request with its own review.

## The file

The base is `main`'s `.github/workflows/release.yml` at `39f83d4`, last changed in `7d87f8f` (L11). Only the `publish` job changes: its comment and `timeout-minutes`, and the step "Publish each tarball, gateway first", which gains its `env:`, a longer comment, the checker and the 409 path. The owner copies the block below to `.github/workflows/release.yml`, without the fence lines.

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
  # and installs nothing but npm. The publish step waits for an accepted-but-not-public version only until one
  # deadline, 10 minutes after the step starts, so the job's timeout stays well above the step's longest run and
  # GitHub never cancels it mid-loop without an ::error:: line.
  publish:
    needs: pack
    if: >-
      ${{ !cancelled() && needs.pack.result == 'success' && github.event_name == 'push' &&
      github.ref == 'refs/heads/main' && needs.pack.outputs.publish == 'true' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    environment: release
    permissions:
      contents: write # the tag and the GitHub release
      id-token: write # the OIDC token npm exchanges for a short-lived publish token
    outputs:
      foreign: ${{ steps.publish.outputs.foreign }}
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
      # dependencies first, so npm never accepts a package's upload before the uploads of its workspace dependencies at
      # that version. The order holds for the uploads only: npm makes accepted versions public in its own order, so a
      # package can be public for a few seconds while a dependency it names still answers 404.
      #
      # npm makes an accepted publish public about 1 to 3 minutes after `npm publish` returns. Until then the version
      # answers 404 but can't be published again: npm answers E409 "Cannot publish over previously staged version"
      # (docs/plans/reviews/release-race-409.md). A run that follows another's publish closely can see that 404. On
      # that one error, and no other, the step polls the package's registry document, the one the checker reads, until
      # it holds the version under the run's dist-tag. It then accepts the version only if it is the release this
      # workflow makes: with SLSA provenance for the tarball npm holds, from this repository's release.yml on a push to
      # main. Every wait in the step shares one deadline, 10 minutes after the step starts. Anything else fails the job,
      # as any other npm error does.
      #
      # An accepted version may have been built from another commit on main than this run's. The step then records
      # foreign=true, and the next step creates no tag and no GitHub release, so a release never points at a commit
      # whose code npm doesn't hold.
      - name: Publish each tarball, gateway first
        id: publish
        env:
          REPO: ${{ github.repository }}
          REPO_ID: ${{ github.repository_id }}
        run: |
          set -euo pipefail
          # Exit 0: accepted, with the provenance commit written to the file named by the last argument. Exit 2: not
          # public yet, so poll again. Exit 1: a failed check, named in the ::error:: line.
          cat > "$RUNNER_TEMP/check-staged.mjs" <<'EOF'
          import { writeFileSync } from "node:fs";
          const [name, version, distTag, repo, repoId, commitFile] = process.argv.slice(2);
          const SLSA = "https://slsa.dev/provenance/v1";
          const fail = (message) => {
            console.log(`::error::${name}@${version} ${message}, so this run won't treat it as released.`);
            process.exit(1);
          };
          const wait = (message) => {
            console.log(`${name}@${version} ${message}; polling again.`);
            process.exit(2);
          };
          const get = async (url, onError) => {
            let response;
            try {
              response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
            } catch (error) {
              wait(`couldn't be read: ${url} failed with ${error.message}`);
            }
            if (!response.ok) onError(`couldn't be checked: ${url} answered ${response.status}`);
            try {
              return await response.json();
            } catch {
              onError(`couldn't be checked: ${url} didn't answer JSON`);
            }
          };
          const packument = await get(`https://registry.npmjs.org/${name.replace("/", "%2f")}`, wait);
          const manifest = packument.versions?.[version];
          if (!manifest) wait("isn't in the package's registry document yet");
          const tagged = packument["dist-tags"]?.[distTag];
          if (tagged !== version) wait(`isn't under the dist-tag ${distTag} yet, which names ${tagged}`);
          const { attestations, integrity } = manifest.dist ?? {};
          if (attestations?.provenance?.predicateType !== SLSA || typeof attestations.url !== "string") {
            fail("has no SLSA provenance");
          }
          const bundle = await get(attestations.url, fail);
          const slsa = Array.isArray(bundle?.attestations)
            ? bundle.attestations.find((entry) => entry?.predicateType === SLSA)
            : undefined;
          if (!slsa) fail("has no SLSA attestation at its attestations URL");
          const payload = slsa.bundle?.dsseEnvelope?.payload;
          if (typeof payload !== "string") fail("has an SLSA attestation without a DSSE payload");
          let statement;
          try {
            statement = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
          } catch {
            fail("has an SLSA attestation whose payload isn't JSON");
          }
          const buildDefinition = statement?.predicate?.buildDefinition;
          if (!buildDefinition || typeof buildDefinition !== "object") fail("has an SLSA statement without a buildDefinition");
          const { externalParameters, internalParameters, resolvedDependencies } = buildDefinition;
          const workflow = externalParameters?.workflow ?? {};
          const want = { repository: `https://github.com/${repo}`, path: ".github/workflows/release.yml", ref: "refs/heads/main" };
          for (const [key, value] of Object.entries(want)) {
            if (workflow[key] !== value) fail(`was built with workflow ${key} ${workflow[key]}, not ${value}`);
          }
          const github = internalParameters?.github ?? {};
          if (github.event_name !== "push") fail(`was built on a ${github.event_name} event, not a push`);
          if (github.repository_id !== repoId) fail(`was built in repository id ${github.repository_id}, not ${repoId}`);
          const purl = `pkg:npm/${name.replace("@", "%40")}@${version}`;
          const subjects = Array.isArray(statement.subject) ? statement.subject : [];
          const digest = subjects.find((subject) => subject?.name === purl)?.digest?.sha512;
          const held = Buffer.from(String(integrity).replace(/^sha512-/, ""), "base64").toString("hex");
          if (!digest || digest !== held) fail("has provenance for a different tarball than the one npm holds");
          const commit = Array.isArray(resolvedDependencies) ? resolvedDependencies[0]?.digest?.gitCommit : undefined;
          if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) fail("has provenance that names no commit");
          writeFileSync(commitFile, commit);
          console.log(`${name}@${version} is on npm under ${distTag}, published by release.yml from ${commit}.`);
          EOF
          deadline=$((SECONDS + 600))
          foreign=false
          for pkg in gateway sdk agent-safety protocol harness cli; do
            status=$(curl -sS --retry 3 --max-time 30 -o /dev/null -w '%{http_code}' "https://registry.npmjs.org/@buildanagent%2f$pkg/$VERSION")
            case "$status" in
              200) echo "@buildanagent/$pkg@$VERSION is already on npm; skipping it."; continue ;;
              404) ;;
              *) echo "::error::The registry answered $status for @buildanagent/$pkg@$VERSION."; exit 1 ;;
            esac
            log="$RUNNER_TEMP/publish-$pkg.log"
            if npm publish "$RELEASE_DIR/buildanagent-$pkg-$VERSION.tgz" --tag "$DIST_TAG" --access public --provenance 2>&1 | tee "$log"; then
              continue
            fi
            if ! grep -q '^npm error code E409$' "$log" || ! grep -qF "Cannot publish over previously staged version \"$VERSION\"" "$log"; then
              exit 1
            fi
            echo "npm has accepted @buildanagent/$pkg@$VERSION from an earlier publish but not made it public; waiting for it until the step's deadline."
            while :; do
              rc=0
              node "$RUNNER_TEMP/check-staged.mjs" "@buildanagent/$pkg" "$VERSION" "$DIST_TAG" "$REPO" "$REPO_ID" "$RUNNER_TEMP/commit-$pkg" || rc=$?
              case "$rc" in
                0) break ;;
                2) ;;
                *) exit 1 ;;
              esac
              if [ "$SECONDS" -ge "$deadline" ]; then
                echo "::error::@buildanagent/$pkg@$VERSION still isn't public under $DIST_TAG 10 minutes after the publish step started. This run published nothing after it; a re-run of the publish job skips what npm holds by then."
                exit 1
              fi
              sleep 15
            done
            commit=$(cat "$RUNNER_TEMP/commit-$pkg")
            if [ "$commit" != "$SHA" ]; then
              foreign=true
              echo "::warning::@buildanagent/$pkg@$VERSION on npm was built from $commit, not from this run's commit $SHA, so this run creates no tag and no GitHub release."
            fi
          done
          echo "foreign=$foreign" >> "$GITHUB_OUTPUT"
      # Creating the release creates the tag at the released commit, the run's own. A tag that `release.yml` pushes
      # with GITHUB_TOKEN starts no workflow, so the docs deploy is started by the next job instead. When npm holds a
      # version built from another commit, the step stops before it tags anything: a tag at this run's commit would
      # name code that npm doesn't hold, and the provenance commit comes from a statement this job doesn't verify.
      - name: Tag the release and create its GitHub release
        env:
          GH_TOKEN: ${{ github.token }}
          REPO: ${{ github.repository }}
          FOREIGN: ${{ steps.publish.outputs.foreign }}
        run: |
          if [ "$FOREIGN" != "false" ]; then
            echo "::warning::npm holds $VERSION from another commit on main, so this run doesn't tag $TAG at $SHA. If the GitHub release $TAG doesn't exist, create it by hand at the commit the warnings above name."
            exit 0
          fi
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
  # production docs follow stable releases only; next.docs follows main in the meantime. Skipped too when the publish
  # job created no tag, because npm held the version from another commit.
  docs:
    needs: [pack, publish]
    if: >-
      ${{ !cancelled() && needs.publish.result == 'success' && needs.pack.outputs.docs_deploy == 'true' &&
      needs.pack.outputs.prerelease == 'false' && needs.publish.outputs.foreign == 'false' }}
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

With the file in place, a push that follows a release within a few minutes ends green when npm already holds that release, and red for every other publish failure.
