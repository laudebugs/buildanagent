# T68a: Tooling for research-paper references in the manual

| Field | Value |
| --- | --- |
| ID | `T68a` |
| Status | `done` |
| Plan | [Build the book §2, BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed) |
| Round / milestone | Round T (the book), added 2026-11-23 |
| Depends on | None |
| Size | M (a register field, one remark plugin, check rules, an audit script and the sources page) |

## Goal

Give the book the tooling for the owner's rule on research papers: no paper stays bare text. A chapter's first mention of a paper describes it, and every later mention links to the paper's entry on the Sources page, which links to the paper. This todo builds the syntax, the checks, the audit and the Sources page. The content todos that follow fill in every paper's description and convert the chapters.

## Context

- [BK6](../../plans/build-book.md#bk6-a-source-register-tied-to-our-fact-checks-with-citations-that-fail-the-build-proposed): the source register and its `[@id]` citations, which this extends.
- [`apps/manual/README.md`](../../../apps/manual/README.md): how chapters cite sources and how `check:book` reports problems.
- `apps/manual/src/markdown/remark-citations.ts` and `remark-terms.ts`: the plugins whose text splitting and masking the new plugin reuses.

## Scope

**In scope**

- `short`, `blurb` and `aliases` on register entries of kind `paper`, with `short` and `blurb` required except for ids on the temporary pending list, `papers-pending.json`.
- `[[paper:id]]` and `[[paper:id described]]` in chapter text: a link to the entry on the Sources page, with the blurb on a chapter's first use.
- `check:book` rules: no bare paper name, a described first mention, a paper URL of a known shape, and `[[paper:id]]` only for papers.
- The Sources page shows a paper's short name, blurb and "Cited in" links to each chapter that mentions it.
- `pnpm --filter @buildanagent/manual audit:papers`, a read-only report of paper mentions and unregistered candidates.
- The worked example: `short`, `blurb` and `aliases` for `ruan-skillcfi` and `wang-voyager`, and their chapter mentions converted without changing a claim.

**Out of scope** (and which todo covers it)

- Blurbs for the other papers, and converting their mentions: the content todos that follow (T68b and after).

## Tasks

- [x] Register schema, pending list and URL-shape rule, with tests
- [x] The `[[paper:…]]` remark plugin and the bare-name rule, with tests
- [x] `check:book` lists every `described` use
- [x] Sources page: short name, blurb, "Cited in"
- [x] `audit:papers` script and its test
- [x] The two worked-example entries and their chapter edits
- [x] README section "How to cite a research paper" and a BK6 note in the book plan

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/manual check:book`, the manual's tests and the book build pass
- [x] Each rule has a fixture test that fails when the rule is removed
- [x] `pnpm check`, `pnpm typecheck` and `pnpm fact-check-logs` pass

## Tests

Fixture tests in `apps/manual/test/` over `test/fixtures/book/`.

## Docs to update

`apps/manual/README.md`, the book plan's BK6 and todo table.

## Outcome

- The two worked examples are `ruan-skillcfi` (SkillCFI) and `wang-voyager` (Voyager), with blurbs checked against each paper (rows T68a-1 and T68a-2 of the book plan's fact-check log). Their mentions in Chapters 3, 12 and 13 now use `[[paper:id]]`.
- `papers-pending.json` holds the other 32 papers. One of them, `cormack-rrf`, links an author's PDF rather than a paper page, so its content todo also needs its DOI.
- The URL rule and the bare-name rule apply only to papers off the pending list, which the README and BK6 record.

## Risks and open questions

The bare-name rule would fail on every paper the chapters already name, so it applies only to entries with a `short`; the pending list keeps the others exempt until the content todos empty it.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
