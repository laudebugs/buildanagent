# J3: Replace the note marker with a margin bubble and a numbered footnote dot

> **History:** the owner asked for this on 2026-11-22, after seeing [J2](../done/J2-notes-colours-popover.md)'s bubble marker, which draws over the letters after a noted passage and hides them. The owner first chose option 2 of the marker mockups everywhere, then changed it the same day to option 1 (a margin bubble) on a wide window and option 2 (the dot) on a narrow one.

| Field | Value |
| --- | --- |
| ID | `J3` |
| Status | `done` |
| Plan | [Book plan BK24](../../plans/build-book.md#bk24-a-readers-notes-stay-in-their-browser-proposed) |
| Round / milestone | Round T (textbook), notes follow-up |
| Depends on | [J2](../done/J2-notes-colours-popover.md) |
| Size | M |

## Goal

Replace J2's bubble marker, which covers the letters after a noted passage. Where the window leaves room beside the text column, a note gets a speech-bubble marker in the margin; where it does not, it gets a small numbered dot after the passage's last word, raised like a footnote mark, in space the line reserves. Both take the highlight's colour and open the same popover as a click on the highlight.

## Context

- [`apps/manual/public/scripts/notes.js`](../../../apps/manual/public/scripts/notes.js): `layoutMarkers()` draws J2's markers in a container outside the article; this todo changes where and how.
- [`apps/manual/README.md`](../../../apps/manual/README.md#a-readers-notes-stay-in-their-own-browser): the "A note has a marker" bullet this todo rewrites.
- [J1's report](../../research/book/notes-colours-popover-and-share.md): why J2 kept every element out of the article. This todo reverses that for one inline spacer, so the report's rule needs a recorded correction.

## Scope

**In scope**

- A dot of about 16 px, raised (`position: relative; top` about -0.5em), inserted right after the last word of each noted passage as an inline element that the chapter's text model, Pagefind, copy and paste, and the text-quote anchor all skip.
- The dot shows the note's number in the panel's order, takes the highlight's colour, has a 44 px target (an invisible `::after` inset of -14 px), opens the popover, is keyboard-focusable and carries an `aria-label` such as "Note 1".
- A passage that ends at a line end wraps its dot with the last word. The dot never causes sideways scroll at a 393 px width and never sits on a following character.
- A plain highlight stays unmarked, and the dotted underline on noted passages stays.
- A margin speech-bubble marker, about 28 px, in the highlight's colour, level with the passage's first line, where 44 px or more is free beside the text column; nothing is added to the article there. Hovering or focusing it brightens its passage, and markers that begin close together are stacked.
- The dot is used only where no such room exists, and a resize or rotation across that width swaps one for the other with the article's markup restored.
- Vitest tests in a DOM environment, a Playwright check at 1280 and 393 px that the dot overlaps no text and is not cut off at the right edge, and a desktop and a phone screenshot at `deviceScaleFactor` 2 in the pull request.
- The README text, the J1 report and fact-check correction, and BK24 where the design differs.

**Out of scope**

- Edits to `.github/workflows`.
- A sidenote layout, deferred until readers ask.

## Tasks

- [x] Decide where the dot lives so no chapter text moves or is searchable: record the choice and its reason.
- [x] Insert and remove the dots as the highlights change, keeping the text model, the anchors and Pagefind unaffected.
- [x] Style the dot: size, raise, colour per highlight colour, 44 px target, wrap with the last word, no overflow.
- [x] Make it focusable with an aria-label and open the popover from a click, Enter or Space.
- [x] Retire the bubble marker container and its layout code, and keep the click test working.
- [x] Write the tests, the screenshots and the README text.

## Acceptance criteria

- [x] A noted passage ends in a numbered dot that takes the highlight's colour, and a plain highlight has none
- [x] The dot never covers a following character, wraps with the last word, and causes no sideways scroll at 393 px
- [x] The dot is reachable by Tab, named "Note N", and opens the popover from the keyboard and by touch
- [x] The text model, the stored anchors, Pagefind and copy and paste ignore the dot
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline, and the Playwright check passes at 1280 and 393 px

## Tests

Vitest for the insertion, removal, numbering, text-model and anchor independence and the keyboard path; a Playwright run in Chromium at 1280 and 393 px for overlap and clipping.

## Docs to update

The manual's README section "A reader's notes stay in their own browser", the J1 report with a fact-check row, and BK24 where the implementation differs.

## Risks and open questions

- Firefox and Safari cannot be run here; the README says what was and was not run.
- An inserted element inside the article changes J2's rule that the script adds nothing there; the correction is recorded.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Code written to the guidelines, with tests, and `pnpm check`, `pnpm typecheck` and `pnpm test` passing locally
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description

## Outcome

J2's bubble marker is replaced by a pair that depends on the room beside the text column. `hasGutter()` measures it from the first paragraph's right edge (the article's box is wider than its text), and `refit()` swaps the two when a resize or rotation crosses the width.

- **Wide (44 pixels or more beside the column): a margin marker.** `layoutMarkers()` draws a 28 pixel speech-bubble button level with the passage's first line, in the highlight's colour, in a container outside the article, so nothing is added to the article. Markers that begin close together are stacked. Hovering or focusing one brightens its passage with a stronger shade (`manual-hover-*`), and Enter, Space or a click opens the popover. A redraw moves a marker instead of replacing it, so focus and hover survive.
- **Narrow: a numbered inline dot.** `placeDots()` inserts an inline `span` after the passage's last word, in space the line reserves. It holds no text (generated content), carries `data-pagefind-ignore`, and the text model, Pagefind, copy and the stored anchors are unchanged. It goes after every inline element the passage ends in. `clearDots()` removes every dot and joins the split text nodes before each redraw. Enter opens on keydown and Space on keyup, and focus returns after the popover closes or a redraw.
- **Colour.** `book-tokens.json` gains `highlightEdge*` (3:1 on the page, the marker and dot outline) and `highlightHover*` (4.5:1 under the text), both checked in `test/contrast.test.ts`.
- **Mutation observer.** The script drops its own mutation records after it changes the article, and reads the chapter again when another script's records were dropped with them.
- **Checks.** The Playwright run at 1280 and 393 pixels checks the marker's size, position and hover, the dot's size, raise, target, position and no overlap, the swap across a resize, the article's markup restored, no sideways scroll, and the keyboard path.
