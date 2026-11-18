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

- **Pinned actions.** Both workflows pin `actions/checkout` v7.0.1, `pnpm/action-setup` v6.1.1 and `actions/setup-node` v7.1.0 by commit SHA, each the newest release at least a week old (tag commit dates 2026-07-17, 2026-11-03 and 2026-10-07). pnpm's version comes from `packageManager`, and Node's from `.nvmrc`. Checkout runs with `persist-credentials: false`, and the token has `contents: read` only.
- **User namespaces.** The Copilot harness runs each example in `unshare -rn` and refuses to run without it. Ubuntu 24.04 runners restrict unprivileged user namespaces through AppArmor, so both workflows lift that with `sysctl` first.
- **Drift that ignores noise.** `pnpm test` and `pnpm verify` rewrite `results/*.json` with timings and absolute paths. `scripts/ci/results-drift.mjs` compares each changed file with its committed version after dropping `ms` and `checkedAt` and normalizing the checkout path, temp directories and "N ms" strings. It also ignores `tail` (raw stdout), and for our own examples' `run-examples.json` it compares only each example's file, outcome and exit code, because the examples assert their own claims. The first GitHub runs showed why: stdout carries process ids, and a Claude example made 14 model requests on the runner against 13 locally while passing. It fails on anything else, including new untracked result files. `ci.yml` runs it after `pnpm test`, and `verify.yml` after `pnpm verify`. Both cases were tested locally: a timing-only rerun passes and a changed `outcome` fails.
- **Audit.** `verify.yml` ends with `pnpm audit --audit-level high`. Accepted alerts go in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, each with a comment naming the README that records why. The only entry is picomatch's GHSA-fc5q-39xc-vjpf.
- **Dependabot scope.** GitHub's dependency graph also scans the 24 example manifests inside the mirrored docs (`docs/reference/*/source/`), and Dependabot opened failing security-update runs against them (for example zod in an ADK snippet). `.github/dependabot.yml` excludes `docs/reference/**` and turns off routine version PRs; security updates for our manifests still run. Alerts already raised on the mirror manifests are upstream examples, not our dependencies, and the owner can dismiss them in the Security tab.
- **Not yet run on GitHub.** The first push of `.github/workflows/` shows whether this session's token may write workflows, and the first runs show the real timings.

## 3b. Dependency security (X2, added 2026-11-18)

The owner set the dependency policy on 2026-11-18. Pins must be at least one week old, down from two weeks. When a pinned dependency has a known vulnerability, the age rule gives way: move to the latest release that fixes it. GitHub's Dependabot flags vulnerabilities on the default branch; on 2026-11-18 it reported 19 (7 high, 9 moderate, 3 low).

X2 works through every open alert, and keeps doing so as alerts arrive:
1. **Find the package.** Map the alert to the harness in `verify/<sdk>/package.json`, or to the root `package.json`, that pulls the package in, directly or transitively.
2. **Upgrade.** Upgrade to the latest release that fixes it. For a transitive dependency, bump the direct dependency that brings it in. Only if no such release exists, add a `pnpm.overrides` entry with a comment that names the alert.
3. **Re-verify.** Run `pnpm check`, `pnpm typecheck`, `pnpm test` and the affected harness's `pnpm run verify`. Record any change in doc-example results in that SDK's fact-check, because the reference states its pinned version.
4. **Record unfixable alerts.** If no fixed release exists, record the alert as accepted in the harness README, with the reason the offline harness is not exposed: mock models, no network, an allowlisted environment.

Once CI exists (X1), the nightly `verify.yml` also runs `pnpm audit --audit-level high` and fails on new high alerts.

## 4. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| X2 | Dependency security: upgrade every vulnerable pin to its latest fixed release, re-verify, record accepted alerts (first pass done 2026-11-18) | None |
| X1 | CI workflows for the checks and the scheduled verify (done) | None (scheduled after Round S by the owner) |

## 5. Risks

- **Workflow permissions.** Pushing `.github/workflows/` needs a token with workflow permission, which this session's GitHub access may lack. Mitigation: hand the owner the file to commit.

## 6. Open questions

- None.
