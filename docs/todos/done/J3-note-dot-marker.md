# J3: Replace the note marker with a numbered footnote dot after the passage

> **History:** the owner asked for this on 2026-11-22, after seeing [J2](../done/J2-notes-colours-popover.md)'s bubble marker, which draws over the letters after a noted passage and hides them. The owner chose option 2 of the marker mockups.

| Field | Value |
| --- | --- |
| ID | `J3` |
| Status | `done` |
| Plan | [Book plan BK24](../../plans/build-book.md#bk24-a-readers-notes-stay-in-their-browser-proposed) |
| Round / milestone | Round T (textbook), notes follow-up |
| Depends on | [J2](../done/J2-notes-colours-popover.md) |
| Size | M |

## Goal

Replace J2's bubble marker with a small numbered dot, raised like a footnote mark and placed right after the last word of a noted passage in space the line reserves, so it never covers a following character. It shows the note's number, takes the highlight's colour and opens the same popover as a click on the highlight.

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
- Desktop and phone use the same dot; there is no margin marker.
- Vitest tests in a DOM environment, a Playwright check at 1280 and 393 px that the dot overlaps no text and is not cut off at the right edge, and a desktop and a phone screenshot at `deviceScaleFactor` 2 in the pull request.
- The README text, the J1 report and fact-check correction, and BK24 where the design differs.

**Out of scope**

- Edits to `.github/workflows`.
- Any margin marker.

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

The bubble marker and its container are gone. `placeDots()` in `apps/manual/public/scripts/notes.js` inserts one inline `span` after the last word of each noted passage; `clearDots()` removes every dot and joins the split text nodes before each redraw.

- **Where the dot lives.** Inside the article, as an inline element, so the line reserves its room. It splits the text node at the passage's end, which leaves the joined text, the text model and the stored anchors unchanged. A dot never goes inside a link or code: it moves out past inline ancestors the passage ends in.
- **No searchable text.** The number is generated content (`::before` with `attr(data-n)`), and the element carries `data-pagefind-ignore`, so Pagefind, selection and copy and paste skip it. A word joiner at the start of the content keeps the dot on the line of the word before it.
- **Look.** About 16 pixels, raised `-0.5em`, the highlight's colour with a 1.5 pixel accent border (3:1 at the edge), an invisible `::after` inset of -14 pixels for a 44 pixel target, and no dot for a plain highlight.
- **Numbering and keyboard.** The number is the note's place among the notes in the panel's order, and the panel labels each note "Note N". Tab reaches a dot, Enter or Space opens the popover, and focus comes back when it closes.
- **Mutation observer.** The script drops its own mutation records after it changes the article, so its dots never trigger a redraw.
- **Checks.** The Playwright run at 1280 and 393 pixels checks the dot's size, raise, target, right edge, position after the last word, no overlap with the next character, no sideways scroll and the keyboard path.
