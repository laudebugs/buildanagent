# T69: Add reading settings to the manual: four typeface pairings and five text sizes

| Field | Value |
| --- | --- |
| ID | `T69` |
| Status | `ongoing` |
| Plan | [Book plan](../../plans/build-book.md) (Round T, the manual's reading experience) |
| Round / milestone | Round T (the manual) |
| Depends on | [T68](../done/T68-manual-sticky-header.md) |
| Size | L (two pull requests: the fonts and the early script, then the settings panel) |

## Goal

A reader can choose how the manual looks to them: one of four typeface pairings and one of five text sizes. The choice is saved on the device, applies to every chapter before the first paint and keeps working offline. The owner approved design S1 and the four pairings on 2026-11-23.

## Context

- The approved design: `docs/design/reading/reading-designs.html` (section 2, S1), `more-fonts.html` and `README.md` (final choices), on the branch `claude/happy-albattani-p54jjp`.
- [T68](../done/T68-manual-sticky-header.md) built the header's empty `data-slot="settings"`.
- [ADR 0059](../../decisions/0059-offline-manual-service-worker.md): the offline worker, its manifest and the save-for-offline control.
- `apps/manual/fonts/sources.json`, `scripts/fetch-fonts.mjs` and `scripts/subset-fonts.py`: the font pipeline, with byte-identity and stale tests.

## Scope

**In scope**

- Self-hosted Latin subsets of Space Grotesk, Inter, Bitter and Atkinson Hyperlegible, with their licences.
- An early external script and CSS variables that apply the pairing and the size before first paint.
- The settings button, the popover and the phone sheet, and the offline handling of the optional fonts.
- Tests, screenshots and a layout check at 150% on a 390 px screen.

**Out of scope**

- Changing the code font (Manual Code), the figures' labels or Pagefind's UI, and any `notes.js` change beyond what the sheet pattern needs.

## Tasks

- [ ] Add the four font families to the pipeline.
- [ ] Write the early script and the CSS variables.
- [ ] Handle the optional fonts offline.
- [ ] Build the settings button, popover and sheet.
- [ ] Write the tests and take the screenshots.

## Acceptance criteria

- [ ] Each pairing changes the computed font of headings and body, and only the active pairing's fonts load.
- [ ] The choice persists across a reload with no flash, and Reset restores the defaults.
- [ ] No horizontal scroll at 150% on a 390 px screen on a sample of chapters, and the header still fits one row.
- [ ] A non-default pairing works offline.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/manual/test/` plus Playwright checks on desktop Chromium and an iPhone 14 touch profile.

## Docs to update

`apps/manual/README.md`, `THIRD-PARTY-NOTICES.md`, the book plan's todo table and the book's fact-check log.
