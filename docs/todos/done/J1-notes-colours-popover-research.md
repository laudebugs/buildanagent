# J1: Research and design: highlight colours, a popover and a note marker for the book's notes

> **History:** the owner asked for this on 2026-11-22: rework the book's highlights and notes (BK24) with four highlight colours, a popover with remove and share, and a note marker that does not depend on Firefox drawing a CSS-highlight underline. The work is two todos, this research and design (J1) and the implementation (J2), which starts after this one merges.

| Field | Value |
| --- | --- |
| ID | `J1` |
| Status | `done` |
| Plan | [Book plan BK24](../../plans/build-book.md#bk24-a-readers-notes-stay-in-their-browser-proposed) |
| Round / milestone | Round T (textbook), notes follow-up |
| Depends on | None |
| Size | M |

## Goal

Decide how the notes script draws four highlight colours, opens a popover on a click, shows a note as visibly attached to its passage, and shares a passage, and record the decision where the implementation can follow it. One short research report with its own fact-check file answers each question from primary sources, and BK24 in the book plan changes to match.

## Context

- [`apps/manual/public/scripts/notes.js`](../../../apps/manual/public/scripts/notes.js) and the README section [A reader's notes stay in their own browser](../../../apps/manual/README.md#a-readers-notes-stay-in-their-own-browser): what exists today (one highlight colour, a toolbar, a panel, localStorage key `manual-notes` with `"v":1`).
- [Book plan BK24](../../plans/build-book.md#bk24-a-readers-notes-stay-in-their-browser-proposed): the browser-only decision and the Firefox 140 to 145 underline gap.
- [`docs/design/book-tokens.json`](../../design/book-tokens.json): the source of every colour, with measured contrast pairs.
- MDN, the CSS Custom Highlight API, `caretPositionFromPoint`, `Range.getClientRects`, text fragments, the Web Share API and the Clipboard API; caniuse and the specifications for support as of November 2026.

## Scope

**In scope**

- `docs/research/book/notes-colours-popover-and-share.md`, one short report, and its `fact-check-notes-colours-popover-and-share.md`.
- Update BK24 in the book plan (and an ADR only if the decision needs one).

**Out of scope** (and which todo covers it)

- The script, the CSS, the tokens, the tests and the README: [J2](../done/J2-notes-colours-popover.md), after this merges.

## Tasks

- [x] Research how to draw several named highlights with the CSS Custom Highlight API, how to hit-test a click on a highlight, and how to draw a note marker that does not depend on the highlight's underline.
- [x] Compare what "share" can mean on a static site with local-only notes, recommend one, and state what leaves the browser.
- [x] Specify the stored value's migration: existing notes without a colour, and a value written by a newer version is never overwritten.
- [x] Specify the accessibility behaviour and the contrast numbers for four colours in both themes.
- [x] Fact-check every browser-support claim as of November 2026 against MDN, caniuse or the specification.
- [x] Update BK24 in the book plan.
- [ ] Run `/anthropic-skills:writing-review` on the report and the pull request description.

## Acceptance criteria

- [x] The report recommends one design for colours, the popover, the note marker and share, and each recommendation cites a source
- [x] Every browser-support claim carries "as of November 2026" and a ✅, ✏️ or ⚠️ row in the fact-check file
- [x] The report says what leaves the browser: nothing
- [x] BK24 in the book plan matches the report
- [x] `pnpm check` and `pnpm test` pass

## Tests

None beyond `pnpm check` and `pnpm test`: this todo changes documents only.

## Docs to update

The book plan's BK24.

## Risks and open questions

- Firefox 140 to 145 draws no underline from CSS highlights, so the note marker cannot rely on one.
- A text-fragment link may not scroll to a passage that the chapter's own scripts change after load.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Report drafted with `/anthropic-skills:writing`, and every claim fact-checked against its source
- [x] `pnpm check` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description
