# T2: The owner's design as tokens and components: C's layout, C4 pages, theme-following panels and three fonts

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T2` |
| Status | `ready` |
| Plan | [Book plan §5, BK12](../../plans/build-book.md#bk12-the-owner-picked-direction-cs-layout-c4s-page-colours-and-panels-that-follow-the-theme-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T1](../ongoing/T1-book-scaffold.md) |
| Size | M |

## Goal

Give the book the look the owner picked. This todo turns the owner's type and colour choices into CSS custom properties for the light and dark themes. It builds direction C's layout and components on them, and checks every text and background pair against WCAG AA, so no chapter waits on design.

## Context

- [Book plan BK12](../../plans/build-book.md#bk12-the-owner-picked-direction-cs-layout-c4s-page-colours-and-panels-that-follow-the-theme-accepted): the owner's pick, with every token value and the measured contrast ratios.
- The owner's design canvas, board "Reference design" (a private page): the layout this todo reproduces.
- The font files and licences in [google/fonts](https://github.com/google/fonts): `ofl/instrumentserif/`, `ofl/literata/` and `ofl/googlesanscode/`, each with `OFL.txt`; Google Sans Code also has `TRADEMARKS.md`.
- [Book plan BK9](../../plans/build-book.md#bk9-listings-come-from-real-regions-and-become-interactive-in-three-tiers-accepted-the-mechanism-is-proposed) and [BK11](../../plans/build-book.md#bk11-generated-checked-inlined-figures-that-work-without-javascript-proposed): the listing, tab, annotation, replay and figure components need styles.
- The `/fixing-accessibility` and `/web-typography` skills: contrast, focus and type checks.

## Scope

**In scope**

- CSS custom properties for C4's light and dark pages and for the code and figure panels, which follow the theme (light panel in light mode, C1 Ember in dark mode), with `prefers-color-scheme` and a manual toggle
- Instrument Serif for headings, Literata for body text and Google Sans Code for code, served from the site with their OFL licences
- Direction C's layout: header, wide title, figure panel with the isometric stepper, article column with side notes, previous and next links
- Components: contents and sidebar, listing block, tabs, annotation markers, replay controls, figure frame, side notes, glossary card, citation and search box
- A contrast test over every text and background pair in both themes, both page sets and both panel sets

**Out of scope** (and which todo covers it)

- The behaviour behind listings and replays ([T4](T4-book-listings.md), [T5](T5-book-interactive-listings.md))
- Figure drawing ([T6](T6-book-flat-figures.md), [T7](T7-book-isometric-figures.md))

## Tasks

- [ ] Generate the CSS custom properties from [`docs/design/book-tokens.json`](../../design/book-tokens.json), the single source of the tokens, with a script that writes `apps/book/src/styles/tokens.css`: light values on `:root`, dark values under `prefers-color-scheme: dark` and under `[data-theme="dark"]`. The panel tokens follow the theme too: `panelLight` values on `:root`, `panelDark` (C1 Ember) values under `prefers-color-scheme: dark` and `[data-theme="dark"]` (owner, 2026-11-19: "approved those colors"). A test fails when the committed CSS differs from what the script generates. A token change starts in the JSON file, never in the CSS.
- [ ] Use `#F2C2A4` for dark-mode links (owner, 2026-11-19; 10.05:1 on `#2A1E16`), and underline links in both modes, since neither link colour is 3:1 apart from body text.
- [ ] Download the three font families from `google/fonts` at a recorded commit into `apps/book/public/fonts/`, each with its `OFL.txt`, and add them to THIRD-PARTY-NOTICES.md.
- [ ] Read Google Sans Code's `TRADEMARKS.md` before subsetting. A subset is a Modified Version under the OFL, so give subset files neutral names and say "derived from Google Sans Code" in the notices.
- [ ] Build the layout and each component as an Astro component with no client script, then add the scripts that tabs, replays and the stepper need as progressive enhancement.
- [ ] Use the rule tokens only for decorative dividers: never for text, focus rings or figure lines that carry meaning.
- [ ] Write the contrast test: read every text and background pair from the `contrast` lists in `docs/design/book-tokens.json`, recompute each WCAG ratio, fail below 4.5:1, and fail when a recorded ratio differs from the recomputed one.
- [ ] Render a component gallery page in both themes, excluded from search, and compare it with the reference board.

## Acceptance criteria

- [ ] Every text and background pair on the light page, the dark page, the light panel and the dark panel meets WCAG AA (4.5:1 for body text), checked by the contrast test in `pnpm test` against the ratios in `book-tokens.json`
- [ ] Listings and figures use the panel tokens of the current mode: in light mode a light panel with its `#E4D6C2` border, in dark mode C1 Ember
- [ ] Headings render in Instrument Serif, body text in Literata and code in Google Sans Code, all served from the site; the site loads no font, script or style from another origin
- [ ] Each font's `OFL.txt` ships beside its files, and THIRD-PARTY-NOTICES.md lists all three with their source commit
- [ ] Every component renders on the gallery page in both themes with JavaScript disabled, and every control is reachable and visible by keyboard
- [ ] The plan's BK12 records the owner's answer on the dark link colour
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

A Vitest test computes the contrast of every text and background pair from the built CSS and fails below 4.5:1, and fails when a page token lacks a dark value. The gallery page is built in `pnpm test` through the book's build smoke test.

## Docs to update

- The plan's BK12 with the dark link colour
- THIRD-PARTY-NOTICES.md for the fonts
- `apps/book/README.md`: the tokens and where each may be used

## Risks and open questions

- The owner's reference board may show details the token table does not, such as spacing or the stepper's controls; match the board and record each added token in BK12.
- Literata and Instrument Serif may lack glyphs the chapters use, such as arrows or box-drawing characters; the glyph check from T6 and the gallery page catch them early.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
