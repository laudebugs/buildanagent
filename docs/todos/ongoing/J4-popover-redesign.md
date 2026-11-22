# J4: Rework the notes popover: swatches, a quoted passage, the note as the main text and an action row

> **History:** the owner asked for this on 2026-11-22, after [J2](../done/J2-notes-colours-popover.md) and [J3](../done/J3-note-dot-marker.md): when a reader clicks a noted passage or its marker, the popover shows the highlighted passage as its main text, which is wrong. The owner chose design A (desktop) and design D (phone) of the popover mockups, in version 2 with no italics.

| Field | Value |
| --- | --- |
| ID | `J4` |
| Status | `ongoing` |
| Plan | [Book plan BK24](../../plans/build-book.md#bk24-a-readers-notes-stay-in-their-browser-proposed) |
| Round / milestone | Round T (textbook), notes follow-up |
| Depends on | [J3](../done/J3-note-dot-marker.md) |
| Size | L |

## Goal

Make the note the main text of the popover. The popover shows, in order, the four colour swatches with the current colour ringed, the passage as a small upright quotation, the note at the body size, and an action row of Edit, Share and Remove below a hairline. A plain highlight shows the same quotation and an "Add a note" field with Save. On phone widths the popover becomes a bottom sheet.

## Context

- [`apps/manual/public/scripts/notes.js`](../../../apps/manual/public/scripts/notes.js): `buildPopover()`, `renderPop()`, `openPop()` and the colour buttons J2 built.
- [`apps/manual/README.md`](../../../apps/manual/README.md#a-readers-notes-stay-in-their-own-browser): the "A click opens a popover" bullet this todo rewrites.
- [`docs/design/book-tokens.json`](../../design/book-tokens.json): the edge shade for the quotation's bar and the contrast pairs every new text colour needs.

## Scope

**In scope**

- Content order: (1) the four swatches, the current colour ringed, which the reader can change; (2) the passage as a small quotation, 13 px, upright (no italics), in the muted text colour, with a 3 px bar on its left in the highlight's edge colour, clamped to 3 lines (2 on phones), its full text available through the notes panel or a tooltip; (3) the note as the main text at the body size (15.5 px); (4) an action row below a hairline: Edit, Share and Remove, Remove in the destructive colour, with 44 px targets on touch.
- A plain highlight with no note: the same quotation and an "Add a note" field with Save.
- Phone widths: a bottom sheet with a grab handle, closed by a swipe down or a tap outside, the quotation clamped to 2 lines, the same order.
- Layout from the mockups: a popover up to 330 px wide with 12 px 14 px padding and 10 px between rows, 18 px swatch circles, a 10 px left padding on the quotation, a note at 15.5 px with line height 1.55, 12 px monospace upper-case action labels, a sheet with a 16 px top radius, a 36 by 4 px grab handle and 16 px side padding.
- Keyboard use: a sensible focus order, Escape closes, and focus returns to the marker.
- The note and the quoted passage render as text, never HTML.
- Contrast tokens measured in both themes for every new text and non-text colour.
- Vitest tests in a DOM environment, a Playwright check at 1280 and 393 px (a long passage clamping and a plain highlight included), screenshots at `deviceScaleFactor` 2 for both widths, and the README text.

**Out of scope**

- Edits to `.github/workflows`.
- Changes to what is stored or to Share's link and text.

## Tasks

- [ ] Rebuild the popover's content in the order above, with the note as the main text.
- [ ] Add the quotation: upright, muted, a left bar in the edge colour, clamped to 3 lines (2 on phones), with the full text in a tooltip and the panel.
- [ ] Add the Add-a-note field and Save for a plain highlight, and Edit for a noted one.
- [ ] Add the action row with 44 px touch targets and a destructive Remove.
- [ ] Build the bottom sheet for phone widths with a grab handle, swipe down and tap outside to close.
- [ ] Keep focus order, Escape and the focus return working in both layouts.
- [ ] Measure the new colour pairs in the tokens file and extend `contrast.test.ts`.
- [ ] Write the tests, the screenshots and the README text.

## Acceptance criteria

- [ ] The popover's order is swatches, quotation, note, action row, in both layouts
- [ ] The quotation is upright, muted, barred in the edge colour and clamped to 3 lines (2 on phones)
- [ ] The note is the largest text in the popover, rendered as text, and a plain highlight shows an Add-a-note field with Save
- [ ] Edit, Share and Remove work, and Remove has the destructive colour and a 44 px touch target
- [ ] On a 393 px window the popover is a bottom sheet that closes on a swipe down and on a tap outside
- [ ] Escape closes it and focus returns to the marker in both layouts
- [ ] Every new colour pair is in the tokens file and passes `contrast.test.ts`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline, and the Playwright check passes at 1280 and 393 px

## Tests

Vitest for the order, the clamping classes, the text-only rendering, the Add-a-note flow, Edit, Remove and the focus return; a Playwright run in Chromium at 1280 and 393 px for the layout, a long passage clamping, a plain highlight and the sheet's close gestures.

## Docs to update

The manual's README section "A reader's notes stay in their own browser", and BK24 where the implementation differs.

## Risks and open questions

- Firefox and Safari cannot be run here; the README says what was and was not run.
- A swipe gesture on a native popover is implemented by the script, so touch behaviour is checked in Chromium's touch emulation only.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Code written to the guidelines, with tests, and `pnpm check`, `pnpm typecheck` and `pnpm test` passing locally
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description
