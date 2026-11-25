# X5: Check every relative link and anchor in the repository's Markdown

> **On hold (2026-11-25): proposed, awaiting the owner.** Leave this todo alone until the owner accepts it, even though it depends on nothing.

| Field | Value |
| --- | --- |
| ID | `X5` |
| Status | `ready` |
| Plan | [CI §4](../../plans/ci.md#4-todos) |
| Round / milestone | Round X (CI) |
| Depends on | None |
| Size | S (one sitting) |

## Goal

Add a script that fails when a relative link or an anchor in a tracked Markdown file leads nowhere, and run it in `ci.yml`. AGENTS.md's step 5 tells every author to "confirm that every relative link and anchor resolves", and nothing checks it outside the three apps. The todo board makes broken links likely, because every todo's file moves from `ready/` to `ongoing/` to `done/` while plans and other todos link to it by path.

## Context

- [AGENTS.md, step 5](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges): the rule this todo automates.
- [CI plan](../../plans/ci.md): what `ci.yml` runs today, and the rule that the owner commits workflow changes.
- `scripts/package-docs.mjs`: its `headingAnchors()` builds GitHub's anchors for level-2 and level-3 headings, with `-1`, `-2` for a repeat. The checker needs every heading level, so it extends that function or shares its slug rule.
- `scripts/ci/fact-check-log.mjs` and its test: the pattern for a CI script with a `node --test` file beside it.
- `apps/docs` (`starlight-links-validator`) and `apps/manual` (`check:book`) already check the links inside their own pages; this todo leaves them alone.
- Lamina PDF's `docs/todos/done/X1-docs-link-checker.md`, read at `db8e3b0`: the same check, over every tracked `*.md` file, with GitHub's anchor rules.

## Scope

**In scope**

- `scripts/ci/markdown-links.mjs`: for every tracked `*.md` file, resolve each relative link to a tracked path and each `#anchor` to a heading in its target.
- A `pnpm check:links` script in the root `package.json`.
- A list of skipped paths with a reason for each: the mirrored upstream docs under `docs/reference/*/source/`, and generated or vendored folders.
- Fixes for the broken links the first run finds.

**Out of scope**

- External links. A nightly check in `verify.yml` can follow as its own todo.
- Links inside the built sites, which the apps' own checks cover.
- Editing `.github/workflows/`: the owner commits the workflow line.

## Tasks

- [ ] Run a first pass over the repository and record how many links break, by folder.
- [ ] Write `scripts/ci/markdown-links.mjs`: list tracked `*.md` files with `git ls-files`, skip fenced code, resolve relative paths, and build each target's anchors with GitHub's slug rule.
- [ ] Write `scripts/ci/markdown-links.test.mjs` with a passing and a failing fixture for a missing file, a missing anchor, a repeated heading and a link inside a code fence.
- [ ] Fix the broken links, or add a skipped path with its reason.
- [ ] Add `check:links` to the root `package.json`, and list it in AGENTS.md's "Before you commit" and its `.github/workflows/` entry.
- [ ] Hand the owner the one line for `ci.yml` (`- run: pnpm check:links`), in the pull request description.

## Acceptance criteria

- [ ] `pnpm check:links` passes on `main` and exits non-zero on a link to a missing file or a missing anchor, naming the file and the line.
- [ ] The check finishes in under 5 seconds on the repository (1,391 tracked Markdown files at `c25b00db`).
- [ ] `node --test scripts/ci/markdown-links.test.mjs` passes, and the CI step that runs `scripts/ci/*.test.mjs` picks it up.
- [ ] Every skipped path has a written reason.

## Tests

`scripts/ci/markdown-links.test.mjs`, run by the `node --test scripts/ci/*.test.mjs` step in `ci.yml`. `pnpm check`, `pnpm typecheck` and `pnpm test` still pass.

## Docs to update

- AGENTS.md: "Before you commit", the `.github/workflows/` entry and step 5, which can then name the command.
- [CI plan §4](../../plans/ci.md#4-todos) and its list of what `ci.yml` runs.
- [L12's comparison](../ongoing/L12-docs-redesign.md#the-lamina-pdf-comparison), whose link-checker row points here.

## Risks and open questions

- **The first run may find many broken links.** Nobody has measured them. If the fixes outgrow one review, land the script first in report-only mode and fix the links folder by folder.
- **Anchor rules.** GitHub's slugs for headings with code, links or punctuation have edge cases; the test fixtures pin the ones the repository uses.
- **Moved todos.** A session that moves a todo's file must fix the links to it in the same commit, or the check fails. That failure is the point of the check, but it adds a step to every claim and every finish.
- **Model.** The script follows the pattern of the other `scripts/ci/` checks, so it is Sonnet's work with an Opus first review, under AGENTS.md's subagent rule.
- **Who decides.** The owner accepts or drops this todo, and commits the workflow line.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
