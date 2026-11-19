# Contributing: one pull request per change, checked and reviewed before it merges

Contributions of code and documentation are welcome. The full rules live in [AGENTS.md](AGENTS.md), which people and AI agents both follow; this page lists the ones a first pull request is most likely to trip over, and links to the rest.

## Install with pnpm on Node 22

The repo is a pnpm workspace and uses Node 22 (`.nvmrc`) and pnpm 10.28.0 (`packageManager` in `package.json`). Run `pnpm install` at the repo root. Never use npm or yarn, and never commit a `package-lock.json`.

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

The first round runs `/code-review high` on the pull request. If it finds more than 6 issues, the second round is `/code-review medium` followed by `/code-review low`; otherwise it is `/code-review low`. Fix each round's findings in new commits that list each finding and its fix. Copy, meaning any text a person reads, is drafted with `/anthropic-skills:writing` and checked with `/anthropic-skills:writing-review` once the code changes are done. The details are in [AGENTS.md](AGENTS.md#every-pull-request-gets-two-rounds-of-code-review).

## Draft, fact-check and review every document before it merges

Later readers, including AI agents, act on these documents, so every new or rewritten document goes through five steps:

1. Draft it.
2. Fact-check each claim against its primary source.
3. Review the whole document.
4. Fix every finding.
5. Re-check every claim a fix touched.

The details of each step, the fact-check log format and the four rules for citing claims are in [AGENTS.md](AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges).

## Your contribution is licensed under the repo's own terms

By opening a pull request, you agree to license your contribution under the repo's own terms: code under Apache-2.0 OR MIT, and documentation under CC BY 4.0 ([LICENSE](LICENSE)). Leave the mirrored upstream docs under `docs/reference/*/source/` unchanged; their fetch scripts regenerate them, and they keep their own licences ([THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
