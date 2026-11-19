# T4: Code listings from real file regions, with path, lines and pin

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T4` |
| Status | `done` |
| Plan | [Book plan §5, BK8 and BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T3](../done/T3-book-content-model.md) |
| Size | M |

## Goal

Let a chapter include code only from a file that CI type-checks and runs. The `::listing` directive cuts a named region from a real file, shows its listing number, path, line range and the pinned SDK version, and fails the build when anything it names is missing. The `book:switch-report` script then tells us which chapters can move to our own packages.

## Context

- [Book plan BK8 and BK9](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted): the owner's decision on code sources and the listing design.
- Each `verify/<sdk>/tsconfig.json` includes `examples/**/*.ts`, and each harness's `test` script runs `tsc -p` before the examples ([`verify/vercel-ai-sdk/package.json`](../../../verify/vercel-ai-sdk/package.json)).
- [ci.yml](../../../.github/workflows/ci.yml) and `scripts/ci/results-drift.mjs`: what CI already runs on every push.

## Scope

**In scope**

- The `::listing{#id file region}` directive, region extraction, marker stripping and Shiki highlighting
- The caption line: listing number, repo path, line range, and the pinned version of the harness's main package
- The check that each listed file sits under a `tsconfig.json` that a workspace package's `typecheck` runs
- `// #region` markers in the `verify/` examples the Part I chapters name
- `book:switch-report`, which reads each chapter's `switchTo` and `docs/todos/done/`

**Out of scope** (and which todo covers it)

- Annotations, tabs and replays ([T5](../ready/T5-book-interactive-listings.md))

## Tasks

- [x] Write the directive with `remark-directive`, reading files relative to the repo root.
- [x] Map each `verify/<sdk>` harness to its main package (for example `ai` for `vercel-ai-sdk`) in one table in `apps/manual/src/data/harnesses.json`, and read the pin from that harness's `package.json`.
- [x] Add `// #region` and `// #endregion` comments to the examples §4.1 of the plan names; run that harness's `pnpm test` to confirm the results do not change.
- [x] Write the tsconfig-coverage check and the missing-file, missing-region and missing-package failures.
- [x] Write `book:switch-report` and run it in `pnpm test` as a report that never fails.

## Acceptance criteria

- [x] A fixture chapter's listing shows `Listing N.M`, the path, the line range and the pin read from the harness's `package.json`
- [x] Renaming a region, deleting a listed file or listing a file outside every checked `tsconfig.json` fails the build
- [x] `node scripts/ci/results-drift.mjs` passes after the region markers are added
- [x] `book:switch-report` lists, for each chapter, its `switchTo` todos and which are done
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (on macOS all pass except `verify/copilot-sdk`, which needs Linux's `unshare` and runs in CI)

## Tests

Vitest tests for the directive on fixture files, one per failure. The region markers are covered by the existing `pnpm test` of each harness.

## Docs to update

- `apps/manual/README.md`: how to add a listing and a region
- The `verify/<sdk>/README.md` of each harness whose examples gain markers, with one line on why they are there

## Risks and open questions

- The weekly SDK-update job rewrites `verify/*/package.json`; the displayed pin follows it, which is correct, but prose that names a version must say "as of".

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- A chapter shows runnable code with `::listing[Caption]{#id file="…" region="…"}`. The caption is required, as for every numbered block, and without `region` the listing shows the whole file. The listing takes T3's numbering: the book index numbers it in order with the chapter's other listings, `rehype-numbering` writes "Listing N.M", and `[[lst:id]]` links to it.
- The book index resolves each listing when the book loads (`src/book/listings.ts`, `src/book/regions.ts`), so `check:book` and the build report a broken one through T3's `ProblemList`, each as one problem naming the chapter's file and the directive's line. A region error also names the listed file's own line. The caption check runs at render time through T3's `failAt`, with the same file and line.
- A listing fails when its file is missing, is named by anything but a plain path from the repository root, resolves through a symbolic link to outside the repository, is not TypeScript, or no workspace package's `typecheck` covers it. The coverage check (`src/book/typecheck-coverage.ts`) finds the file's nearest `package.json`, requires it to match a `pnpm-workspace.yaml` glob that no `!` glob cancels, and asks `tsc -p <config> --listFilesOnly` whether a config in that package's `typecheck` script holds the file, so `extends` and its inherited `exclude` apply as in `pnpm typecheck`. A listing also fails when its harness is missing from `src/data/harnesses.json` or its main package is missing or not pinned exactly. Finally, a missing, empty or malformed region fails, and so do a missing caption or `file` and an unknown attribute.
- `src/data/harnesses.json` maps the eight harnesses to `@anthropic-ai/claude-agent-sdk`, `agents`, `@github/copilot-sdk`, `@google/adk`, `langchain`, `@openai/agents`, `@earendil-works/pi-coding-agent` and `ai`. Each caption reads the pin from the harness's `package.json`, such as `ai@7.0.162` as of November 2026.
- Shiki 4.6.0 tokenises the lines with its CSS-variables theme, and the page renders them in the markup that `src/components/listing-html.ts` gives both the plugin and `ListingBlock`, with its `tok-*` classes. Each line therefore shows its number in the file, and the panel keeps the design tokens' colours. The listed lines and pin join `renderDependencies`, so a changed file or pin clears Astro's content cache, and under `astro dev` it restarts the server.
- 39 regions mark the code §4.1 names in 26 example files across all eight harnesses. The capstones are listed whole, except the OpenAI capstone's injection guardrail. Seven harnesses' `pnpm test` passed with unchanged verdicts, and `results-drift.mjs` found no drift. `copilot-sdk`'s `tsc` passed, but its examples need Linux's `unshare`, so only CI runs them. Each harness README says why the markers are there.
- `book:switch-report` lists each written chapter's `switchTo` todos and which are done. The manual's `test` runs it after Vitest, and it exits 0 even when the book fails to load. With no chapter written yet, it says so.
- Tests: `test/check-book.test.ts` adds 25 failing fixtures for listings, 76 in all, each producing exactly one problem through `check:book` and through the build's path. `test/listings.test.ts` (12 tests) checks the caption, line numbers, nested markers, dedenting, Shiki's classes, renumbering, the cache dependencies, the workspace globs and every real region. `test/switch-report.test.ts` adds 3 tests, and the build test checks a real listing on the built site fixture; the manual runs 147 tests.
- Pins: `shiki` 4.6.0 and `yaml` 2.9.1, the versions Astro 7.4.11 already resolves; neither has an install script. Fact-check rows 292–310 in `docs/plans/reviews/fact-check-build-book.md` cover T4's claims, rows 306–310 those of its first review round.
- `pnpm check`, `pnpm typecheck` and the manual's build, tests and `check:book` pass. `pnpm -r --no-bail test` passes for every package except `verify/copilot-sdk`, which refuses to run on macOS without `unshare`; CI runs it on Linux.
- Left for later: a `:::listing` that holds its own code block still goes through Astro's default Shiki theme, whose inline colours differ from the panel's tokens; T5 builds annotations, tabs and replays on the file listings.

