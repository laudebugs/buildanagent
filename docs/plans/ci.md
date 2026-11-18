# Plan: run the local checks on every push, and the full verify on a schedule (Round X)

- **Status:** Draft
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
| X2 | Dependency security: upgrade every vulnerable pin to its latest fixed release, re-verify, record accepted alerts | None |
| X1 | CI workflows for the checks and the scheduled verify | None (scheduled after Round S by the owner) |

## 5. Risks

- **Workflow permissions.** Pushing `.github/workflows/` needs a token with workflow permission, which this session's GitHub access may lack. Mitigation: hand the owner the file to commit.

## 6. Open questions

- None.
