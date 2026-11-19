# Plan: run the local checks on every push, and the full verify on a schedule (Round X)

- **Status:** Done (X1 and X2's first pass, 2026-11-18)
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18), who chose to add CI after the SDK rounds
- **Builds on:** the pnpm workspace and the [coding standards](../../AGENTS.md#coding-standards)
- **Todos:** Round X on the [todo board](../todos/README.md); §4 lists them.

## 1. Goal

GitHub Actions runs the same checks we run locally, so a broken push shows up within two minutes, and a scheduled run catches upstream docs drifting from the pinned packages.

## 2. Measured cost (2026-11-18)

Locally on 4 CPUs with a warm install, `pnpm check` takes under 1 second, `pnpm typecheck` 3 seconds and `pnpm test` 9 seconds. The full `verify` for both harnesses takes about 50 seconds. On GitHub's 2-CPU private-repo runners, a cold `pnpm install` of the 1.1 GB store should take 30–90 seconds, or 15–25 seconds with the pnpm store cached. One run should therefore take 1–2 minutes, well inside the free plan's 2,000 minutes a month.

## 3. The workflows

- **`ci.yml` on every push and pull request:** checkout, Node 22, pnpm through corepack, a cached `pnpm install`, then `pnpm check`, `pnpm typecheck` and `pnpm test`. No secrets.
- **`verify.yml` nightly and on demand:** the same setup, then `pnpm run fetch-docs` for any harness whose mirror isn't committed (Claude), and `pnpm verify`. The workflow fails when a result file changes, which flags upstream drift for review.

### What X1 built (2026-11-18)

- **Pinned actions.** Both workflows pin `actions/checkout` v7.0.1, `pnpm/action-setup` v6.1.1 and `actions/setup-node` v7.1.0 by commit SHA, each the newest release at least a week old (tag commit dates 2026-07-17, 2026-11-03 and 2026-10-07). pnpm's version comes from `packageManager`, and Node's from `.nvmrc`. Checkout runs with `persist-credentials: false`, and the token has `contents: read` only. *Superseded on 2026-11-19 by [§3d](#3d-actions-locked-by-a-lockfile-added-2026-11-19): `uses:` lines now name tags, and the lockfile holds the commits.*
- **User namespaces.** The Copilot harness runs each example in `unshare -rn` and refuses to run without it. Ubuntu 24.04 runners restrict unprivileged user namespaces through AppArmor, so both workflows lift that with `sysctl` first.
- **Drift that ignores noise.** `pnpm test` and `pnpm verify` rewrite `results/*.json` with timings and absolute paths. `scripts/ci/results-drift.mjs` compares each changed file with its committed version after dropping `ms` and `checkedAt` and normalizing the checkout path, temp directories and "N ms" strings. It also ignores `tail` (raw stdout), and for our own examples' `run-examples.json` it compares only each example's file, outcome and exit code, because the examples assert their own claims. The first GitHub runs showed why: stdout carries process ids, and a Claude example made 14 model requests on the runner against 13 locally while passing. It fails on anything else, including new untracked result files. `ci.yml` runs it after `pnpm test`, and `verify.yml` after `pnpm verify`. Both cases were tested locally: a timing-only rerun passes and a changed `outcome` fails.
- **Audit.** `verify.yml` ends with `pnpm audit --audit-level high`. Accepted alerts go in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, each with a comment naming the README that records why. The only entry is picomatch's GHSA-fc5q-39xc-vjpf.
- **Dependabot scope.** GitHub's dependency graph also scans the 24 example manifests inside the mirrored docs (`docs/reference/*/source/`), and Dependabot opened failing security-update runs against them (for example zod in an ADK snippet). `.github/dependabot.yml` excludes `docs/reference/**` and turns off routine version PRs; security updates for our manifests still run. Alerts already raised on the mirror manifests are upstream examples, not our dependencies, and the owner can dismiss them in the Security tab.
- **First GitHub runs (2026-11-18).** `ci.yml` passes in under 3 minutes. The first hand-started `verify.yml` ran every harness in 12 minutes (the runner is about 3× slower than our container), and the audit passed. It failed the drift check on three Cloudflare files. One cause was ours: `git show` exceeded Node's 1 MB buffer on `typecheck-docs.json`, which read as a new file. Another was noise: bundled-code stack positions, now normalized. The rest, two doc blocks whose mismatch cause differs on the runner (`repo__agents__scheduling__30`, `cf__agent-class__run-workflows__23`), does not reproduce locally, so `verify.yml` now uploads the result files as an artifact on failure for an exact comparison. The network guard held: the MCP blocks' 403 is the harness's own refusal. After X3 (all harnesses on the root TypeScript 7.0.2) and X4 (a seeded `Math.random` for the ADK doc runs), the third `verify.yml` run passed: every harness, the drift check and the audit.

## 3b. Dependency security (X2, added 2026-11-18)

The owner set the dependency policy on 2026-11-18. Pins must be at least one week old, down from two weeks. When a pinned dependency has a known vulnerability, the age rule gives way: move to the latest release that fixes it. GitHub's Dependabot flags vulnerabilities on the default branch; on 2026-11-18 it reported 19 (7 high, 9 moderate, 3 low).

X2 works through every open alert, and keeps doing so as alerts arrive:
1. **Find the package.** Map the alert to the harness in `verify/<sdk>/package.json`, or to the root `package.json`, that pulls the package in, directly or transitively.
2. **Upgrade.** Upgrade to the latest release that fixes it. For a transitive dependency, bump the direct dependency that brings it in. Only if no such release exists, add a `pnpm.overrides` entry with a comment that names the alert.
3. **Re-verify.** Run `pnpm check`, `pnpm typecheck`, `pnpm test` and the affected harness's `pnpm run verify`. Record any change in doc-example results in that SDK's fact-check, because the reference states its pinned version.
4. **Record unfixable alerts.** If no fixed release exists, record the alert as accepted in the harness README, with the reason the offline harness is not exposed: mock models, no network, an allowlisted environment.

Once CI exists (X1), the nightly `verify.yml` also runs `pnpm audit --audit-level high` and fails on new high alerts.

## 3c. Weekly SDK updates (added 2026-11-19)

The owner asked on 2026-11-19 for a weekly check that opens a pull request when an SDK we verify has a new version. `.github/workflows/sdk-updates.yml` does it every Monday at 05:37 UTC, and on demand.

- **Plan.** `scripts/ci/sdk-updates.mjs plan` reads each `verify/*/package.json` and asks the npm registry for the newest release of every runtime dependency that is at least seven days old, the age rule in [AGENTS.md](../../AGENTS.md#coding-standards). A stable pin moves only to a stable release; a prerelease pin, such as miniflare's dated betas, may also move to a newer prerelease of the same major version. The job runs no package code.
- **Update, without write access.** For each harness with an update, a job bumps its pins, runs `pnpm install` and the harness's `verify`, compares the results with the committed run, and uploads a patch with a summary. This job runs the new releases' code, so its token is read-only and its checkout keeps no credentials.
- **Open the pull request.** A last job applies the patch on `deps/sdk-<harness>` and opens or updates one pull request per harness, with the bumps, the verify outcome and the drift in the description. It installs and runs nothing. The pull request then goes through the same reviews as any other, including re-mirroring the docs at the new tag and fact-checking what changed.
- **Owner setup.** The repository must allow GitHub Actions to create pull requests (Settings → Actions → General). A pull request opened with the default `GITHUB_TOKEN` doesn't trigger `ci.yml`. So the workflow uses an `SDK_UPDATES_TOKEN` secret when one exists, such as a fine-grained token with contents and pull-request write access to this repository. Without it, someone starts CI by pushing to the branch.
- **No shared cache from untrusted code.** The update job runs without the pnpm cache: a cache it saved could be restored by later runs on main, so a tampered store from a bad release would reach CI.
- **Failures still open a pull request.** If `pnpm install` or `verify` fails, the pull request still opens, with the failure in its description. A run that finds nothing to change opens nothing.
- **Lockfile conflicts.** Several harnesses share packages, such as `ai` and `@ai-sdk/openai`, so merging one harness's pull request can leave the others conflicting on `pnpm-lock.yaml`. The next weekly run rebuilds each open branch from `main`, or a person reruns the workflow by hand.
- **Pinned actions.** The workflow reuses ci.yml's pins and adds `actions/download-artifact` v8.0.2, whose tag commit is dated 2026-10-07, more than a week before it was pinned.
- **Tests.** `scripts/ci/sdk-updates.test.mjs` covers the version choice offline, including deprecated releases, and `ci.yml` runs it on every push.

## 3d. Actions locked by a lockfile (added 2026-11-19)

The owner asked on 2026-11-19 to lock our GitHub Actions the way Lamina PDF does, with GitHub's workflow lockfile, which became generally available on 2026-10-28 ([GitHub changelog](https://github.blog/changelog/2026-10-28-github-actions-workflow-lockfiles-are-generally-available/)). It replaces the commit SHAs in our `uses:` lines, which [§3](#what-x1-built-2026-11-18) records.

- **Tags in the workflows, commits in the lockfile.** Each `uses:` line names a release tag (`actions/checkout@v7.0.1`). `.github/workflows/actions.lock` records the commit each tag resolved to and the ids of the owning account and repository, so GitHub refuses a run if a tag moves or a repository changes hands.
- **How this lockfile was made.** `gh actions-lock` needs GitHub's API for every action's repository, which the session that wrote it couldn't reach. Instead, the entries come from Lamina PDF's verified lockfile (`laudebugs/laminapdf` at `7b4b37b`), which holds all five of our actions at the versions we pin. Each tag's commit was then checked against the action's own repository with `git ls-remote`. All five matched; pnpm's annotated tag peels to the locked commit.
- **Verified on every pull request.** `ci.yml`'s `lockfile` job installs `gh-actions-lock` v0.4.1, the newest release, whose tag commit is dated 2026-11-02, and runs `gh actions-lock --verify`. The job also proves the copied entries: it fails if any of them doesn't match what the tool would write.
- **Updates.** Dependabot now proposes action updates weekly, at least seven days old, grouped for minor and patch releases. An update rewrites the tag and the lockfile entry together. A new workflow, or a new action in one, needs `gh actions-lock` run by hand ([CONTRIBUTING.md](../../CONTRIBUTING.md#changing-a-workflows-actions)).
- **Owner setup.** Once `main` passes with the lockfile, turn on the **Require lockfile** policy (Settings → Actions → General), so GitHub refuses any workflow run the lockfile doesn't cover.

## 4. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| X2 | Dependency security: upgrade every vulnerable pin to its latest fixed release, re-verify, record accepted alerts (first pass done 2026-11-18) | None |
| X1 | CI workflows for the checks and the scheduled verify (done) | None (scheduled after Round S by the owner) |
| X3 | Run every harness's doc type-check on the root TypeScript 7.0.2; a stale 5.9.3 shim in the Cloudflare harness caused the runner drift (done) | X1 |
| X4 | Seed `Math.random` in the Google ADK doc preload: `graphs/retry/get_started` fails at random by design and errored on the runner (done) | X3 |

## 5. Risks

- **Workflow permissions.** Pushing `.github/workflows/` needs a token with workflow permission, which this session's GitHub access may lack. Mitigation: hand the owner the file to commit.

## 6. Open questions

- None.

