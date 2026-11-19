# T26: Checked inline code: identifiers resolve to listings, transcripts or the pinned `.d.ts`

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T26` |
| Status | `done` |
| Plan | [Book plan §5, BK17](../../plans/build-book.md#bk17-code-in-the-prose-is-checked-like-code-in-a-listing-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../done/T5-book-interactive-listings.md) |
| Size | M |

## Goal

Make code in the prose as checked as code in listings, by the owner's decision. Every API identifier in a chapter's inline code must resolve to a symbol or string in a listing the chapter includes, to a value in that example's recorded transcript, or to an export in the pinned SDK's `.d.ts`. Otherwise it must carry a hand-checked marker that cites a row of the chapter's fact-check log, and the build fails on anything else.

## Context

- [Book plan BK17](../../plans/build-book.md#bk17-code-in-the-prose-is-checked-like-code-in-a-listing-accepted): the owner's rule and the proposed marker syntax.
- T4's listing directive and `harnesses.json`, which name each listing's file and package; T5's transcripts in `verify/<sdk>/results/transcripts/`.
- Each harness's `node_modules/<package>/` `.d.ts` files at the pinned version, the same files our [SDK references](../../reference/) checked their API diffs against.

## Scope

**In scope**

- A remark plugin that finds identifier-like inline code in chapter prose
- Resolution against the chapter's listings, their transcripts and the `.d.ts` exports of the packages those listings import
- The hand-checked marker, `` `name`{checked=row-N} ``, checked against `apps/manual/fact-checks/<slug>.md`
- A small, tested list of patterns that skip the check: file paths, shell commands, numbers and plain values

**Out of scope** (and which todo covers it)

- Checking prose claims about behaviour: each chapter's fact-check log does that (BK17)
- Listings themselves ([T4](../done/T4-book-listings.md))

## Tasks

- [x] Define "identifier-like": a span that matches a JavaScript identifier or a dotted member path such as `result.steps`, and is not on the skip list.
- [x] Collect each listing's identifiers and string literals with the TypeScript compiler API, reading the listed region of the real file.
- [x] Collect the values in each listing's transcript: tool names, message roles, stop reasons and `check()` messages.
- [x] Read the export names of each imported package's `.d.ts` from the harness's `node_modules`, without hard-coding paths (resolve them as [AGENTS.md](../../../AGENTS.md#coding-standards) requires).
- [x] Write the marker check: the cited row must exist in the chapter's fact-check file and be ✅ or ✏️.
- [x] Fail the build on an unresolved identifier, naming the chapter, the line and the four places searched (the fourth, the standard library, by the owner's decision of 2026-11-19).

## Acceptance criteria

- [x] A fixture chapter that names an identifier found in no listing, transcript or `.d.ts`, and has no marker, fails the build with the chapter and line
- [x] The same identifier with `{checked=row-N}` builds when row N exists and is ✅ or ✏️, and fails when the row is missing or ⚠️
- [x] Identifiers found in a listing, a transcript or a pinned `.d.ts` build with no marker
- [x] File paths and shell commands in inline code are skipped, by tested patterns
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (on macOS all pass except `verify/copilot-sdk`, which needs Linux's `unshare` and runs in CI, and `scripts/ci/packages-pack.test.mjs`'s offline install, which fails the same way on `main` here)

## Tests

Vitest tests for the plugin with one fixture per resolution source and one per failure. The build of every chapter runs the check in CI's `book` job.

## Docs to update

- `apps/manual/README.md`: the rule, the marker and the skip list
- The plan's BK17 if the marker syntax changes

## Risks and open questions

- Some identifiers live in types re-exported through several files; follow re-exports with the compiler API instead of scanning text.
- Prose names concepts that are not API identifiers, such as `pass^k`; the skip list must stay short, or the rule loses its force, so review every addition.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally (on macOS all pass except `verify/copilot-sdk`, which needs Linux's `unshare` and runs in CI, and `scripts/ci/packages-pack.test.mjs`'s offline install, which fails the same way on `main` here); pushed as #82
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The rule.** `src/markdown/remark-checked-code.ts` runs last among the remark plugins, so `check:book` and the build fail at the same chapter and line. An identifier or a dotted member path, with an optional `()`, is checked by every name in it; a name after a dot is a property, whatever it spells, so `part.type` is checked by both names. Any other span is checked by its identifiers when the compiler parses it as code, such as `stopWhen: isStepCount(5)`, `maxTurns = 10` or a template literal's `${…}`; strings and numbers in it are left out. A reserved word alone, arithmetic notation such as `pass^k` (plain names and numbers joined by `^`, `+`, `-`, `*`, `/` or `**`), and a span that does not parse go unchecked. A failure names the span, the missing names and every listing, transcript, package and library searched, then gives the marker to write.
- **The four places.** `src/book/code-names.ts` parses each listed file once per book load and takes every identifier, keyword and string literal whose node starts on a listed line; comments and lines outside the region offer nothing. It reads the transcript of each listed example, with or without `replay`, for tool names, message roles, stop reasons and `check()` messages; a missing or stale transcript offers nothing. It resolves each package import from the listed file with the compiler's bundler resolution, so the harness's `node_modules` and the package's `exports` map pick the `.d.ts`, and the checker lists the module's exports after every re-export. Only exported names count: `maxTurns` on an options type needs its marker, as BK17's `maxBudgetUsd` does, and a default export counts as `default`. An import whose `.d.ts` cannot be found, or declares its module only ambiently, fails. By the owner's decision of 2026-11-19, built-ins resolve too. `src/book/standard-library.ts` reads the globals that TypeScript's library declares as each listed file's nearest `tsconfig.json` selects it, so `Promise`, `fetch` and `process` pass and a member path such as `JSON.parse` resolves through its root's type. Environment variables still need a marker, because `process.env` names no property; the library loads only for a name the other places lack.
- **The marker.** `` `name`{checked=row-N} `` must touch its span and cite a row that `fact-checks/<slug>.md` numbers once, with a ✅ or ✏️ verdict, read from the `#` and `Verdict` columns of any table in the log (`src/book/fact-check-log.ts`, whose `FactCheckLogs` reads each log once per load). A missing row, a ⚠️ row, a row numbered twice, a malformed marker and a marker set apart from its span each fail; the page shows the code without the marker. The syntax is BK17's, unchanged.
- **The skip list.** `src/book/inline-code.ts` holds three patterns: a span that starts with one of the seven toolchain commands (`git`, `node`, `npm`, `npx`, `pnpm`, `tsc`, `tsx`), a path with a slash or a dotted name without `()` that ends in one of 20 file extensions, and a literal value (a number, a quoted string, a template literal without `${…}`, `true`, `false`, `null`, `undefined`, `NaN` or `Infinity`). A test fixes each list in full, so every addition shows in review. Fenced code in a listing that names no file offers no names. These definitions are our choices.
- **The parser.** typescript 7.0.2 exports only its version and eleven `./unstable/*` entries, whose client runs the native compiler in a child process. The check therefore reads code with typescript 6.0.3 (published 2026-04-16), an exact dependency aliased as `typescript-api`, which leaves the manual's `tsc` at 7.0.2. It loads on first use: `book:switch-report` never loads it, and a build loads it once the book has a file listing, because `renderDependencies` reads each listed file's imports. One compiler host per load shares every parsed declaration file. The tests assert that each chapter's names are worked out once per load and use no timing.
- **Render inputs.** `astro.config.mjs` hashes each written chapter's fact-check log, each listed example's transcript and each listed file's nearest `tsconfig.json` with its other render inputs and watches them under `astro dev`. `renderDependencies` names each package a listing imports at the version its harness resolves, so a new version renders every chapter again while an unrelated lockfile change does not.
- **Tests.** The manual runs 300 tests after merging T7 and T9, 41 of them T26's. `test/checked-code.test.ts` (15) covers the span rules, each skip pattern, the marker parser, the log's rows, the real AI SDK listing's names, transcript values, exports (including `tool`, re-exported from `@ai-sdk/provider-utils`) and standard library, a passing fixture for every resolution source and both verdicts, and the render inputs. `test/check-book.test.ts` adds 25 one-problem fixtures that fail both `check:book` and the build. The site build test checks four spans that resolve through listings and one, `streamText`, that only ai's `.d.ts` exports. The fixture package lives in `test/fixtures/book/installed/demo-sdk/`, because Git ignores every `node_modules`, and `withSdk` copies it into a fixture copy's harness.
- `pnpm check`, `pnpm typecheck`, the manual's build, test and `check:book` pass. `node --test scripts/ci/*.test.mjs` passes except `packages-pack.test.mjs`'s offline install, which fails the same way on `main` here. `pnpm -r --no-bail test` passes for every package except `verify/copilot-sdk`, which needs Linux's `unshare`.
- Fact-check rows 479–494 in `docs/plans/reviews/fact-check-build-book.md` cover T26's claims, with its choices marked as ours: rows 479–486 the build, rows 487–491 the first review round and rows 492–494 the second.
