# X5: Check every relative link and anchor in the repository's Markdown

| Field | Value |
| --- | --- |
| ID | `X5` |
| Status | `done` |
| Plan | [CI §4](../../plans/ci.md#4-todos) |
| Round / milestone | Round X (CI) |
| Depends on | None |
| Size | S (one sitting) |

## Goal

Add a script that fails when a relative link or an anchor in a tracked Markdown file leads nowhere, and run it in `ci.yml`. AGENTS.md's step 5 tells every author to "confirm that every relative link and anchor resolves", and nothing checks it outside the docs and the book, whose own checks cover only their pages. The todo board makes broken links likely, because every todo's file moves from `ready/` to `ongoing/` to `done/` while plans and other todos link to it by path.

## Context

- [AGENTS.md, step 5](../../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges): the rule this todo automates.
- [CI plan](../../plans/ci.md): what `ci.yml` runs today, and the rule that the owner commits workflow changes.
- `scripts/package-docs.mjs`: its `headingAnchors()` builds GitHub's anchors for level-2 and level-3 headings, with `-1`, `-2` for a repeat. The checker needs every heading level, so it extends that function or shares its slug rule.
- `scripts/ci/fact-check-log.mjs` and its test: the pattern for a CI script with a `node --test` file beside it.
- `apps/docs` (`starlight-links-validator`) and `apps/manual` (`check:book`) already check the links inside their own pages; this todo leaves them alone.
- Lamina PDF's `docs/todos/done/X1-docs-link-checker.md`, read at `db8e3b0`: the same check, over every tracked `*.md` file, with GitHub's anchor rules.

## Scope

**In scope**

- `scripts/ci/markdown-links.mjs`: for every tracked `*.md` file, resolve each relative link to a tracked file or directory and each `#anchor` to a heading in its target.
- A rule for links into gitignored paths. `docs/reference/claude-agent-sdk/README.md` links its `source/` mirror, which `.gitignore` leaves out, so the link resolves locally after `pnpm run fetch-docs` but not in CI. The checker either accepts such a link and names it in its report, or the todo turns the link into code formatting.
- A `pnpm check:links` script in the root `package.json`.
- A list of skipped paths with a reason for each: the mirrored upstream docs under `docs/reference/*/source/`, the vendored skill under `.agents/skills/anatomy/` and other generated or vendored folders. The list also holds the page sources under `apps/docs/src/content/` and `apps/manual/src/content/`, because their links are site routes, such as `/concepts/approvals/`, that the apps' own checks resolve.
- Fixes for the broken links the first run finds.

**Out of scope**

- External links. A nightly check in `verify.yml` can follow as its own todo.
- Links inside the built sites, which the apps' own checks cover.
- Editing `.github/workflows/`: the owner commits the workflow line.

## Tasks

- [x] Run a first pass over the repository and record how many links break, by folder.
- [x] Write `scripts/ci/markdown-links.mjs`: list tracked `*.md` files with `git ls-files`, skip fenced code, resolve relative paths, and build each target's anchors with GitHub's slug rule.
- [x] Write `scripts/ci/markdown-links.test.mjs` with a passing and a failing fixture for a missing file, a missing anchor, a repeated heading, a link to a directory, a link into a gitignored path and a link inside a code fence.
- [x] Fix the broken links, or add a skipped path with its reason.
- [x] Add `check:links` to the root `package.json`, and list it in AGENTS.md's "Before you commit" and step 5. Not its `.github/workflows/` entry: see Outcome.
- [x] Hand the owner the one line for `ci.yml` (`- run: pnpm check:links`), in the pull request description.

## Acceptance criteria

- [x] `pnpm check:links` passes on `main` and exits non-zero on a link to a missing file or a missing anchor, naming the file and the line.
- [x] The check finishes in under 5 seconds on the repository (1,404 tracked Markdown files at `09f6b30b`, 593 skipped as sources, 811 scanned; under half a second).
- [x] `node --test scripts/ci/markdown-links.test.mjs` passes, and the CI step that runs `scripts/ci/*.test.mjs` picks it up.
- [x] Every skipped path has a written reason.

## Tests

`scripts/ci/markdown-links.test.mjs`, run by the `node --test scripts/ci/*.test.mjs` step in `ci.yml`. `pnpm check`, `pnpm typecheck` and `pnpm test` still pass.

## Docs to update

- AGENTS.md: "Before you commit", the `.github/workflows/` entry and step 5, which can then name the command.
- [CI plan §4](../../plans/ci.md#4-todos) and its list of what `ci.yml` runs.
- [L12's comparison](../ongoing/L12-docs-redesign.md#the-lamina-pdf-comparison), whose link-checker row points here.

## Outcome

- `scripts/ci/markdown-links.mjs` resolves every relative link and `#anchor` in a tracked, unskipped `.md` file against `git ls-files`' own tracked-file list, never the filesystem, so a path that only exists locally (a vendored mirror's `source/` before `pnpm run fetch-docs` runs, or Astro's `dist/`) fails exactly as it will in CI. GitHub's anchor slug (shared with `scripts/package-docs.mjs`'s own `headingAnchors` through a new, additive `slugify` export, which keeps that function's existing `#{2,3}`-only range so the six packages' generated `llms.txt` and their `docs-check.test.ts` stay byte for byte unchanged) is read at every heading level, and an `<a id="…">`/`<a name="…">` tag counts as a same-page anchor too, which `docs/research/redesign-vs-ai/redesign-vs-ai.md` already relies on for its four numbered tables.
- Four kinds of file are skipped as link sources, each with its own reason in `SKIP_RULES`: the SDKs' vendored upstream doc mirrors (`docs/reference/*/source/`), the vendored anatomy skill, `apps/docs` and `apps/manual`'s page sources (site routes the sites' own checks already cover), and a `*.src.md` template copied into a generated page elsewhere, whose relative links are written for that destination.
- **The first pass found 83 broken links**, by folder: 37 in `docs/todos`, 27 in `docs/research`, 10 in `docs/plans`, 8 in one template file (now skipped instead), 1 in `apps/manual`. Almost all were a todo's file moving from `ready/` to `done/` or `ongoing/` while something else still linked to its old path; five were not simple moves (a stripped underscore in an anchor, a link to an anchor that never existed, three todos whose "Depends on" cell held a fragment of another cell's text instead of a link, and two files with the wrong number of `../`). All are fixed; none needed report-only staging.
- **Not done, deliberately: the `.github/workflows/` entry in AGENTS.md and the "what `ci.yml` runs" list in [CI plan §4](../../plans/ci.md#4-todos).** Both describe what CI actually runs today, and `ci.yml` doesn't run `pnpm check:links` yet, because only the owner commits that line (Out of scope). Naming it there now would claim a check CI doesn't perform. "Before you commit" and step 5 name it, since those bind the author, not CI.
- 14 tests in `scripts/ci/markdown-links.test.mjs`, four of them against a real, uncommitted git repository in a temporary directory, so `trackedFiles()` and the CLI's exit code are covered against actual git behaviour.

## Risks and open questions

- **The first run may find many broken links.** Nobody has measured them. If the fixes outgrow one review, land the script first in report-only mode and fix the links folder by folder.
- **Anchor rules.** GitHub's slugs for headings with code, links or punctuation have edge cases; the test fixtures pin the ones the repository uses.
- **Moved todos.** A session that moves a todo's file must fix the links to it in the same commit, or the check fails. That failure is the point of the check, but it adds a step to every claim and every finish.
- **Model.** The script follows the pattern of the other `scripts/ci/` checks, so it is Sonnet's work with an Opus first review, under AGENTS.md's subagent rule.
- **Who decides.** The owner accepts or drops this todo, and commits the workflow line.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
