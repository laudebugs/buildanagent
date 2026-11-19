# U23: Fold U22's findings into the build guides and the book's todos

| Field | Value |
| --- | --- |
| ID | `U23` |
| Status | `done` |
| Plan | [Build guides §4d, U23](../../plans/build-guides.md#u23-fold-u22-into-the-build-guides-and-the-books-todos-added-2026-11-19) |
| Round / milestone | Research (added 2026-11-19) |
| Depends on | [U22](../done/U22-survey-agent-research-papers.md) |
| Size | M |

## Goal

The owner asked to review every SDK-reference and book todo against U22's findings and update them, reviewed on Opus. U23 does that: a mapping pass first (no edits), then the actual additions and corrections to the build guides and the book's not-yet-drafted chapter todos that the mapping finds real value in, following this repo's drafted/fact-checked/reviewed process for anything already merged.

## Context

- [`agent-research-papers.md`](../../research/papers/agent-research-papers.md) (U22) and its fact-check: the source of every claim this round cites.
- [`docs/guides/agent-harness.md`](../../guides/agent-harness.md) and [`docs/guides/agent.md`](../../guides/agent.md): the two build guides the mapping proposes changing.
- [`docs/plans/build-book.md`](../../plans/build-book.md) and the T-numbered todos in `docs/todos/{ready,done}/`: the book's chapter plan.
- `docs/research/papers/notes/sdk-references-mapping.md` and `book-todos-mapping.md`: this round's own mapping notes.

## Scope

**In scope**

- Reviewing the eight SDK references, the three comparison docs, the three build guides, and every book (`T*`) todo against U22, and recording the verdict for each.
- Adding or correcting content in a build guide, or a book todo's own `## Context`/`## Scope`, only where the mapping finds real value — not as a reflex.
- Re-verifying any claim the mapping marked weaker (a search-summary figure, or a paper U22 itself could only fact-check against a page summary) before using it in a correction.

**Out of scope** (and which todo covers it)

- Drafting or rewriting an already-written book chapter's prose beyond a narrow, cited correction: a later `T*` todo when that chapter is revised.
- Opening any new SDK-reference or book-chapter todo: not proposed by this round.

## Tasks

- [x] Review the eight SDK references, three comparison docs and three build guides against U22 (done: `sdk-references-mapping.md`).
- [x] Review every book todo against U22 (done: `book-todos-mapping.md`).
- [x] Apply the real, cited additions/corrections the mapping found, re-verifying any weaker claim first.
- [x] Fact-check each changed document's touched claims; log corrections.
- [x] Review the whole of each changed document with `/anthropic-skills:writing-review`; fix and re-check.

## Acceptance criteria

- [x] Every claim added or corrected cites its U22 section or primary source, and every relative link and anchor resolves.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

None (documentation only); `pnpm check`, `pnpm typecheck` and `pnpm test` must still pass.

## Docs to update

`docs/guides/agent-harness.md`, `docs/guides/agent.md`, `docs/research/agent/agent-research.md` and `docs/research/agent/fact-check.md` (if the cost-table correction holds up), and any book todo the mapping finds real value in.

## Risks and open questions

- Several candidate papers are themselves marked ⚠️ in U22's own fact-check (read only via a page-summarizing fetch, or cited from a search summary); re-check each one directly before using it in a correction, not just in an addition.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, fact-checked against primary sources, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
