# The sticky header: what changed and how it was checked

The manual's header is now sticky, with a phone menu and a reading progress line along its bottom edge (todo [T68](../../todos/done/T68-manual-sticky-header.md), the owner's pick H2 of 2026-11-23). This report records the measured sizes, the behaviour and what the checks could not run. All numbers come from `apps/manual/scripts/header-check.mjs` against a production build, in Chromium (Playwright's build 1243, Chromium 153.0.8010.12 by Playwright's `browsers.json`), as of 2026-11-23. Screenshots, before and after, are in [header-screenshots/](header-screenshots/).

## What changed

- **Header.** It is `position: sticky` on every page: 56 px tall on a desktop (it was 66 px) and one 52 px row on a phone (it was two rows, about 100 px). The phone row holds the wordmark, a search button, the settings slot, the theme toggle and a menu button; the menu lists Contents, Glossary, Sources and Notes.
- **Hiding.** A phone's header hides on a scroll down and returns on the first upward scroll. A desktop's never hides.
- **Progress line.** Chapter pages get a 3 px accent line that fills with how far the reader is through the chapter's main text.
- **Offsets.** `html` has `scroll-padding-top: calc(var(--header-height) + 12px)`, the chapter rails stick at `--header-height + 1.5rem`, and the skip link shows above the header.
- **Settings slot.** An empty `data-slot="settings"` wrapper, removed from the layout while empty, waits for the settings button ("Aa") that todo S1 will add.
- **Files.** New: `src/styles/header.css`, `src/scripts/header-state.ts` (the pure decisions), `src/scripts/header.ts` (the DOM wrapper), `scripts/header-check.mjs`, two Vitest files. Changed: `SiteHeader.astro`, `ChapterLayout.astro`, `BaseLayout.astro`, `layout.css` (the old header rules are removed, the rail offsets changed), `base.css` (the skip link's z-index), `test/styles.test.ts` and `apps/manual/package.json` (`check:header`, and `axe-core` 4.14.1, a dev dependency released 2026-11-16). `public/scripts/notes.js` is untouched.

## Behaviour

| Situation | Desktop (wider than 760 px, mouse) | Phone (up to 760 px, or touch) |
| --- | --- | --- |
| Height | 56 px | 52 px |
| Scroll down | stays | hides after an 8 px move, unless near the top |
| First scroll up | stays | returns after an 8 px move |
| Within one header height of the top | shown | shown |
| Menu or search open | not applicable | shown |
| Keyboard focus inside, or moving in | shown | shown |
| Reduced motion | no transition | no transition, still hides and returns |
| Without JavaScript (by design, not browser-tested) | static, wraps to as many rows as it needs | static, wraps; the phone buttons stay hidden |
| Progress line | rides the header's bottom edge | rides the bottom edge; at the top of the window while the header is hidden |

## Measurements

| Check | Result |
| --- | --- |
| Header height | 56.0 px (desktop), 52.0 px (phone) |
| One 56 px row at 761, 800 and 1024 px | yes, no sideways scroll |
| Progress line, top of chapter | 0 |
| Progress line, middle of the span | 0.50 (within 0.02) on both profiles |
| Progress line, end of the main text and through the sources and footer | 1 |
| Heading after a hash jump | top within 1 px of 68 px (desktop) and 64 px (phone), asserted; below the header on a jump up |
| Chapter rails at 1280 and 1600 px | 80 px from the top, 24 px below the header |
| axe-core, wcag2a/2aa/21a/21aa and best-practice, chapter page | no violation, on a desktop, a phone and a phone with the menu open |
| Reduced motion | transition 0 s; the phone header still hides and returns |

## How it was verified

`pnpm --filter @buildanagent/manual test` runs the pure functions over scroll traces (`test/header-state.test.ts`) and reads the source for the promises the files make each other (`test/header-static.test.ts`: the shared phone query, the heights, the rail offsets, the empty slot, the controls' attributes). `check:header` then drives the built book in Chromium at 1280×800 and as an iPhone 14 with touch, and asserts every row above, plus the menu, the search panel, Escape and focus return, a link and the Notes entry. It also asserts that the Notes button, and in one desktop case the selection toolbar and note popover, sit below the header. They can still sit under it elsewhere (see Notes and limits). The phone popover is a bottom sheet and is not asserted. `check:offline`, `check:touch-fields` and `check:note-sheet` still pass, and the offline manifest lists the new script and stylesheet with no new network request.

## What could not be run

- **WebKit is not installed here.** The check tries it and prints `SKIPPED`; the Chromium runs stand in. Safari's collapsing toolbar, rubber-band scroll and sticky-position quirks are untested. The script clamps the scroll position to the page's end so an overscroll bounce cannot read as an upward scroll, but that guard is untested in Safari.
- **A real touch device** is not available; Playwright's iPhone 14 profile only emulates touch and the screen size.
- **CI does not run `check:header`.** `.github/` is off limits to this work; wiring it in is a follow-up.
- **The no-JavaScript header** is covered only by `test/header-static.test.ts`, which reads the source. No browser ran it with scripting off.
- **The settings button** is not built (S1), so the slot is empty and tested only as an empty wrapper.

## Notes and limits

- **The notes toolbar and popover can still sit under the header.** Glossary cards now count their room from the header's bottom edge (`scripts/glossary.ts`, checked by `check:header`), but the selection toolbar and the note popover are placed by `position()` in `public/scripts/notes.js`, which this work does not edit. It needs the same top limit, `--header-height` plus its margin; that is the existing follow-up for the file's owner.
- A note popover opens above a passage only when there is no room below, so it can reach the header only in a window under about 400 px tall (a phone in landscape). The popover is a top-layer element, so no z-index stops it. Keeping it clear needs a clamp in `notes.js`, left to that file's owner.
- The saved-highlight name of the Notes button ("Notes, 1 saved") makes axe-core's `label-content-name-mismatch` rule fire. It comes from `notes.js` and predates the header, so the check runs axe before it creates a highlight.
- The offline-save control sits in the footer, in the page's flow, so the header cannot cover it. That control stays hidden on a loopback host without the offline test host, so the check does not measure it.
