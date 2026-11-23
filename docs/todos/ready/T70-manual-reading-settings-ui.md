# T70: Build the manual's reading settings panel

| Field | Value |
| --- | --- |
| ID | `T70` |
| Status | `ready` |
| Plan | [Book plan](../../plans/build-book.md) (Round T, the manual's reading experience) |
| Round / milestone | Round T (the manual) |
| Depends on | [T69](../done/T69-manual-reading-fonts-and-early-script.md), [T68](../done/T68-manual-sticky-header.md) |
| Size | L |

## Goal

A reader can choose a typeface pairing and a text size from the header and see the book change at once. The choice is saved on the device and, when the reader has saved the book for offline use, the chosen pairing's fonts are saved with it. This is part 2 of the owner's design S1 (approved 2026-11-23); [T69](../done/T69-manual-reading-fonts-and-early-script.md) built the fonts, the early script and the CSS it writes to.

## Context

- The approved design: `docs/design/reading/reading-designs.html` (section 2, S1), on the branch `claude/happy-albattani-p54jjp`.
- `window.manualReadingSettings` (`public/scripts/reading-settings.js`): the keys, the allow-lists, `read` and `apply`, which the panel must reuse.
- The notes popover and sheet (`notes.js`, which this todo does not change): the pattern for a desktop popover that becomes a phone bottom sheet.
- [ADR 0059](../../decisions/0059-offline-manual-service-worker.md): the offline worker, its `SAVE_ALL` message and the optional fonts kept out of the shell.

## Scope

**In scope**

- The header's "Aa" button in the settings slot, with icon I1: a big A and a small a on one baseline.
- A popover on a desktop and a bottom sheet on a phone, built on the notes sheet's pattern.
- Four pairing radios, each with its heading and body names and an Aa sample, and a five-step size control with a live label such as "115% · Large".
- Reset, and the note "Saved on this device".
- A `SAVE_FILES` message to the offline worker, which saves the chosen pairing's optional fonts.
- The size of those fonts, shown in the control.

**Out of scope**

- New pairings or sizes, the code font, the figures' labels and Pagefind's UI.

## Tasks

- [ ] Draw icon I1 and fill the header's settings slot.
- [ ] Build the popover and the phone sheet, with focus, Escape and reduced-motion rules.
- [ ] Build the four radios and the five-step size control with its live label.
- [ ] Write the choice to localStorage, apply it at once and add Reset and "Saved on this device".
- [ ] Add `SAVE_FILES` to the offline worker (`SAVE_ALL` has saved the whole manifest list, optional fonts included, since T67b) and show the size in the control.
- [ ] Write the tests and take the screenshots.

## Acceptance criteria

- [ ] Choosing a pairing or size changes the page at once, survives a reload with no flash, and Reset restores the defaults.
- [ ] The panel works by keyboard and touch, and has no axe-core violation.
- [ ] No horizontal scroll at 150% on a 390 px screen with the panel open, and the header still fits one row.
- [ ] A non-default pairing works offline after the reader saves the book.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass.

## Tests

`apps/manual/test/` plus Playwright checks on desktop Chromium, desktop WebKit where it is installed, and an iPhone 14 touch profile.

## Docs to update

`apps/manual/README.md`, ADR 0059, the book plan's todo table and the book's fact-check log.

## Risks and open questions

- WebKit is not installed in the cloud sessions, so Safari's engine may stay unchecked here.
- Saving the optional fonts raises the offline size; the control must say how much.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` to `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` to `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
