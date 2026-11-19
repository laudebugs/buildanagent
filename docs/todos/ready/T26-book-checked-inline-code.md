# T26: Checked inline code: identifiers resolve to listings, transcripts or the pinned `.d.ts`

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T26` |
| Status | `ready` |
| Plan | [Book plan §5, BK17](../../plans/build-book.md#bk17-code-in-the-prose-is-checked-like-code-in-a-listing-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T5](../ongoing/T5-book-interactive-listings.md) |
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

- [ ] Define "identifier-like": a span that matches a JavaScript identifier or a dotted member path such as `result.steps`, and is not on the skip list.
- [ ] Collect each listing's identifiers and string literals with the TypeScript compiler API, reading the listed region of the real file.
- [ ] Collect the values in each listing's transcript: tool names, message roles, stop reasons and `check()` messages.
- [ ] Read the export names of each imported package's `.d.ts` from the harness's `node_modules`, without hard-coding paths (resolve them as [AGENTS.md](../../../AGENTS.md#coding-standards) requires).
- [ ] Write the marker check: the cited row must exist in the chapter's fact-check file and be ✅ or ✏️.
- [ ] Fail the build on an unresolved identifier, naming the chapter, the line and the three places searched.

## Acceptance criteria

- [ ] A fixture chapter that names an identifier found in no listing, transcript or `.d.ts`, and has no marker, fails the build with the chapter and line
- [ ] The same identifier with `{checked=row-N}` builds when row N exists and is ✅ or ✏️, and fails when the row is missing or ⚠️
- [ ] Identifiers found in a listing, a transcript or a pinned `.d.ts` build with no marker
- [ ] File paths and shell commands in inline code are skipped, by tested patterns
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest tests for the plugin with one fixture per resolution source and one per failure. The build of every chapter runs the check in CI's `book` job.

## Docs to update

- `apps/manual/README.md`: the rule, the marker and the skip list
- The plan's BK17 if the marker syntax changes

## Risks and open questions

- Some identifiers live in types re-exported through several files; follow re-exports with the compiler API instead of scanning text.
- Prose names concepts that are not API identifiers, such as `pass^k`; the skip list must stay short, or the rule loses its force, so review every addition.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
