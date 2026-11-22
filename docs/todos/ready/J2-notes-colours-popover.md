# J2: Implement the notes' four colours, popover, note marker and share

> **History:** the owner asked for this on 2026-11-22. [J1](../done/J1-notes-colours-popover-research.md) chose the design; this todo builds it.

| Field | Value |
| --- | --- |
| ID | `J2` |
| Status | `ready` |
| Plan | [Book plan BK24](../../plans/build-book.md#bk24-a-readers-notes-stay-in-their-browser-proposed) |
| Round / milestone | Round T (textbook), notes follow-up |
| Depends on | [J1](../done/J1-notes-colours-popover-research.md) |
| Size | L |

## Goal

Build what [the J1 report](../../research/book/notes-colours-popover-and-share.md) recommends in `apps/manual/public/scripts/notes.js`: four highlight colours the reader picks and can change, a popover on a click with colour, Share and Remove, a visible marker on every noted highlight, and a Share that copies a quote and a text-fragment link, with a stored value that migrates to version 2.

## Context

- [`docs/research/book/notes-colours-popover-and-share.md`](../../research/book/notes-colours-popover-and-share.md) and its fact-check file: the design, the numbers and the tests it asks for.
- [`apps/manual/README.md`](../../../apps/manual/README.md#a-readers-notes-stay-in-their-own-browser): the section this todo updates.
- [`docs/design/book-tokens.json`](../../design/book-tokens.json): where the three new colours and their measured pairs go; regenerate with the manual's `tokens` script.

## Scope

**In scope**

- Three new highlight colours beside `highlight` in both modes, each with its text and accent pairs measured in the tokens file, and `contrast.test.ts` extended to check them.
- Eight `::highlight()` names (a plain and a noted one per colour) and their rules in `components.css`, with the noted rule's dashed underline.
- The click test, the popover, the marker container, Share and the version-2 store in `notes.js`, and the notes panel's matching actions.
- Vitest tests in a DOM environment, and a Playwright check in the pre-installed Chromium for click, remove, share and colour.
- The README section, and screenshots in the pull request at `deviceScaleFactor` 2 at a desktop width and a 393 px phone width.

**Out of scope** (and which todo covers it)

- Syncing notes to an account: not planned (BK24).
- Edits to `.github/workflows`.

## Tasks

- [ ] Add the colours to the tokens file with measured contrast, regenerate `tokens.css` and extend the contrast test.
- [ ] Register the eight highlight names and their rules, with priority 1 for noted names and a fixed registration order.
- [ ] Test a click against each stored range and each marker through `getClientRects()`, acting only inside the article or the marker container, and open the popover for the highlight that paints on top.
- [ ] Build the popover with the native `popover` attribute: colour buttons with `aria-pressed`, Share and Remove, each at least 44 px high on touch, placed through the element's style object.
- [ ] Draw the marker container: as wide as the page, clipping its overflow, taking no pointer events, with one `aria-hidden` marker above the end of each noted range's last line, clamped to the article's content box and repositioned on resize, font load and redraw.
- [ ] Build Share: one clipboard write of the quote, the chapter's title and a text-fragment link built as the report says, with the read-only fallback field, and never the note.
- [ ] Migrate the store: read version 1 as amber, write nothing on load, write version 2 on the first change, keep an unknown `color` as stored and refuse any other version.
- [ ] Add the same colour and Share actions to the notes panel rows.
- [ ] Write the tests and the README section, and take the screenshots.

## Acceptance criteria

- [ ] A reader can highlight in four colours and change a highlight's colour later
- [ ] A click on a highlight or its note marker opens a popover with Remove and Share, usable by keyboard through the panel and by touch
- [ ] A noted highlight shows a marker in Firefox-like conditions (no underline drawn), checked at a 393 px phone width without horizontal scroll
- [ ] Share writes the quote and a link and never the note, and the script makes no network request
- [ ] Every new colour pair is in the tokens file and passes `contrast.test.ts`
- [ ] A version-1 value loads as amber and is unchanged until the first change; an unknown version is never overwritten
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Tests

Vitest for the store, the click test, the link builder and the popover actions, with a quote that repeats in the chapter, one that repeats only in the sidebar and one selected from the middle of a word. A Playwright run in Chromium for click, remove, share and colour, including that a Share link scrolls to its passage.

## Docs to update

The manual's README section "A reader's notes stay in their own browser", and BK24 where the implementation differs from the design.

## Risks and open questions

- Firefox and Safari cannot be run here; their behaviour rests on MDN's data, so the README says what was and was not run.
- Pale colours sit close together under colour-vision deficiency; the popover and panel name each colour in text.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Code written to the guidelines, with tests, and `pnpm check`, `pnpm typecheck` and `pnpm test` passing locally
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description
