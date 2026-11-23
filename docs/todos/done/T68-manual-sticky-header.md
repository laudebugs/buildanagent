# T68: Make the manual's header sticky, with a reading progress line

| Field | Value |
| --- | --- |
| ID | `T68` |
| Status | `done` |
| Plan | [Book plan](../../plans/build-book.md) (Round T, the manual's reading experience) |
| Round / milestone | Round T (the manual) |
| Depends on | [T67b](../done/T67b-manual-save-for-offline.md) |
| Size | M |

## Goal

The manual's header stays reachable while a reader scrolls, and a thin line along its bottom edge shows how far the reader is through the chapter. The owner approved design H2 on 2026-11-23: on a phone the header is one slim row that slides away on the way down and returns on the first upward scroll, and on desktop it stays visible.

## Context

- The approved design: `docs/design/reading/reading-designs.html` (section 1, H2) and its `README.md`, on the branch `claude/happy-albattani-p54jjp`.
- `apps/manual/src/components/SiteHeader.astro`, the layouts, `Sidebar.astro`, the notes popover and the offline-save footer control: the pieces the header change must not overlap.
- Settings (S1) come later. The header holds a hidden slot for the "Aa" button until they ship.

## Scope

**In scope**

- A sticky header: 56 px on desktop, one 52 px row on a phone with the wordmark, a search icon, the hidden settings slot, the theme toggle and a menu button (Contents, Glossary, Sources, Notes).
- Hide on scroll down and return on the first upward scroll on a phone, with focus and reduced-motion rules.
- A 3 px reading progress line on chapter pages.
- `scroll-padding-top`, the rail offset and no overlap with the notes controls, search results or the offline-save control.
- Playwright tests and before and after screenshots.

**Out of scope**

- The settings panel and the "Aa" button (S1), new network resources and any `notes.js` change.

## Tasks

- [x] Build the sticky header and the phone menu.
- [x] Add the scroll-direction logic and the progress line.
- [x] Fix the anchor offsets and the overlaps.
- [x] Write the tests and take the screenshots.

## Acceptance criteria

- [x] The header stays fixed on scroll at 56 px (desktop) and 52 px (phone).
- [x] The phone header hides on scroll down and returns on scroll up, and focus inside it reveals it.
- [x] The progress line is about 0 at the top, about 50% mid-chapter and 100% at the chapter end.
- [x] A jumped-to heading is visible below the header, and the pages pass axe.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/manual/test/` plus a Playwright check, desktop Chromium and WebKit and an iPhone 14 touch profile.

## Docs to update

`apps/manual/README.md` and the book plan's todo table.

## Outcome

The header is sticky at 56 px on a desktop and one 52 px row on a phone, with a menu, a search panel, hide-on-scroll, a 3 px progress line, scroll padding, rail offsets and an empty settings slot. `check:header` (new, run by hand) passes in Chromium on both profiles; WebKit is not installed here, so it was not run. The measurements, the behaviour table and the limits are in [the report](../../research/book/sticky-header.md), and the README section "The header stays in reach" explains how to extend it.

Follow-ups: run `check:header` in CI (`.github/` was off limits), run it in WebKit where installed, and clamp the note popover below the header in `notes.js` for very short windows.

- [x] `pnpm check`, `pnpm typecheck`, `pnpm test`, `check:book`, the build and the four maintainability checks pass.
