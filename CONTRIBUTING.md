# Contributing: one pull request per change, checked and reviewed before it merges

Contributions of code and documentation are welcome. The full rules live in [AGENTS.md](AGENTS.md), which people and AI agents both follow; this page lists the ones a first pull request is most likely to trip over, and links to the rest.

## Install with pnpm on Node 22

The repo is a pnpm workspace and uses Node 22 (`.nvmrc`) and pnpm 10.34.9 (`packageManager` in `package.json`). Run `pnpm install` at the repo root. Never use npm or yarn, and never commit a `package-lock.json`.

## Pin every dependency exactly, to a release at least one week old

Pin every dependency to an exact version, and choose a release at least one week old. A known vulnerability overrides the age rule: move the dependency to the latest release that fixes it, however new, and name the alert in the commit message. The other coding standards, from TypeScript settings to how harnesses spawn third-party code, are in [AGENTS.md](AGENTS.md#coding-standards).

## Open one branch and pull request per piece of work

Branch from the latest `main`, name the branch for the work, and open a pull request against `main`. Before you open it, run the same three checks that CI runs:

```bash
pnpm check       # Biome lint and format
pnpm typecheck   # type-check every package
pnpm test        # run every harness's examples offline
```

We squash-merge a pull request once CI passes and its review findings are fixed. Branch names, commit messages and the merge rules are in [AGENTS.md](AGENTS.md#git).

## Every pull request gets two rounds of code review

The first round is one `/code-review high --max-findings default` on the pull request. If it confirms more than 6 findings, the second round is two reviews, `/code-review medium` and then `/code-review low`; otherwise it is one `/code-review low`. Each round's findings are fixed in new commits that list each finding and its fix. Copy, meaning any text a person reads, is drafted with `/anthropic-skills:writing` and checked with `/anthropic-skills:writing-review` after the code changes. If you don't use these Claude Code skills, a maintainer runs the reviews on your pull request and pushes the fixes or asks you for them. The details are in [AGENTS.md](AGENTS.md#every-pull-request-gets-two-rounds-of-code-review).

## Draft, fact-check and review every document before it merges

Later readers, including AI agents, act on these documents, so every new or rewritten document goes through five steps:

1. Draft it.
2. Fact-check each claim against its primary source.
3. Review the whole document.
4. Fix every finding.
5. Re-check every claim a fix touched.

The details of each step, the fact-check log format and the four rules for citing claims are in [AGENTS.md](AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges).

## Changing a workflow's actions

The workflows name each action by its release tag (`actions/checkout@v7.0.1`), and `.github/workflows/actions.lock` records the commit that tag resolved to. When you add a workflow, or add or change an action in one:

1. Install the extension: `gh extension install github/gh-actions-lock --pin v0.4.1`.
2. Run `gh actions-lock` at the repo root.
3. Commit `.github/workflows/actions.lock` with the workflow change.

CI's `lockfile` job runs `gh actions-lock --verify` on every pull request and fails if the two disagree. If it reports that a locked commit has moved, the action's maintainer has moved its tag: find out why before you relock.

## Your contribution is licensed under the repo's own terms

By opening a pull request, you agree to license your contribution under the repo's own terms: code under Apache-2.0 OR MIT, and documentation under CC BY 4.0 ([LICENSE](LICENSE)). Leave the mirrored upstream docs under `docs/reference/*/source/` unchanged; their fetch scripts regenerate them, and they keep their own licences ([THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
