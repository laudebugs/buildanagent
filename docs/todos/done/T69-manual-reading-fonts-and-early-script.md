# T69: Add the manual's reading fonts, early script and text sizes

| Field | Value |
| --- | --- |
| ID | `T69` |
| Status | `done` |
| Plan | [Book plan](../../plans/build-book.md) (Round T, the manual's reading experience) |
| Round / milestone | Round T (the manual) |
| Depends on | [T68](../done/T68-manual-sticky-header.md) |
| Size | L |

## Goal

The manual can apply a reader's typeface pairing and text size before the first paint, with no settings panel yet. This is part 1 of the owner's design S1, approved on 2026-11-23: four typeface pairings (Book, Readable, Sans, Slab) and five text sizes (90 to 150%). The panel that writes the choice is [T70](../ready/T70-manual-reading-settings-ui.md).

## Context

- The approved design: `docs/design/reading/reading-designs.html` (section 2, S1), `more-fonts.html` and `README.md` (final choices), on the branch `claude/happy-albattani-p54jjp`.
- [T68](../done/T68-manual-sticky-header.md) built the header's empty `data-slot="settings"`.
- [ADR 0059](../../decisions/0059-offline-manual-service-worker.md): the offline worker, its manifest and the save-for-offline control.
- `apps/manual/fonts/sources.json`, `scripts/fetch-fonts.mjs` and `scripts/subset-fonts.py`: the font pipeline, with byte-identity and stale tests.
- [The reading settings report](../../research/book/reading-settings.md): what part 1 changed and measured.

## Scope

**In scope**

- Self-hosted Latin subsets of Space Grotesk, Inter, Bitter and Atkinson Hyperlegible, with their licences.
- A blocking early script and generated CSS variables that apply the pairing and the size before first paint, and a header that keeps its own size at every text size.
- Keeping the optional fonts out of the offline shell.
- Tests and a layout check at 150% on a 390 px screen.

**Out of scope**

- The settings button, the popover and the phone sheet, and saving the optional fonts for offline use ([T70](../ready/T70-manual-reading-settings-ui.md)).
- Changing the code font (Manual Code), the figures' labels or Pagefind's UI.

## Tasks

- [x] Add the four font families to the pipeline.
- [x] Write the early script and the CSS variables.
- [x] Keep the optional fonts out of the offline shell.
- [x] Write the tests and the browser check.

## Acceptance criteria

- [x] Each pairing changes the computed font of headings and body, and only the active pairing's fonts load.
- [x] A stored choice applies before the first paint, and an unknown value or blocked storage gives the defaults.
- [x] No horizontal scroll at 150% on a 390 px screen on a sample of chapters, and the header still fits one row; on a desktop the header stays one 56 px row at every size.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/manual/test/` (`reading-settings.test.ts`, `tokens.test.ts`, `fonts.test.ts`, the offline tests) plus `check:reading`, a Playwright check on desktop Chromium and an iPhone 14 touch profile.

## Docs to update

`apps/manual/README.md`, `THIRD-PARTY-NOTICES.md`, ADR 0059, the book plan's todo table and the book's fact-check log.

## Outcome

Part 1 is in pull request #397. The four families are in the font pipeline with their OFL texts. `public/scripts/reading-settings.js` sets `data-reading-font` and `data-reading-size` on `<html>` from two localStorage keys, accepting only exact values. `reading.css` is generated from `book-tokens.json`, and the header divides its rem lengths by `--reading-scale`. The eight optional font files stay out of the offline shell, which is 59 files and 1,632 KiB. Review found that the search field and the wordmark's viewport term still grew with the text size; both are fixed and `check:reading` now measures the header on a desktop at every size.

## Risks and open questions

None left for part 1. Whether the shell should hold a reader's chosen pairing is part of T70.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` to `ongoing/`
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally
- [x] This file moved to `done/` in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
