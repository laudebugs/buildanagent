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

## 4. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| X1 | CI workflows for the checks and the scheduled verify | None (scheduled after Round S by the owner) |

## 5. Risks

- **Workflow permissions.** Pushing `.github/workflows/` needs a token with workflow permission, which this session's GitHub access may lack. Mitigation: hand the owner the file to commit.

## 6. Open questions

- None.
