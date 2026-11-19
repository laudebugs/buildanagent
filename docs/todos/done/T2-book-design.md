# T2: The owner's design as tokens and components: C's layout, C4 pages, theme-following panels and three fonts

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T2` |
| Status | `done` |
| Plan | [Book plan §5, BK12](../../plans/build-book.md#bk12-the-owner-picked-direction-cs-layout-c4s-page-colours-and-panels-that-follow-the-theme-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T1](T1-book-scaffold.md) |
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

- The behaviour behind listings and replays ([T4](../done/T4-book-listings.md), [T5](../ready/T5-book-interactive-listings.md))
- Figure drawing ([T6](../ready/T6-book-flat-figures.md), [T7](../ready/T7-book-isometric-figures.md))

## Tasks

- [x] Generate the CSS custom properties from [`docs/design/book-tokens.json`](../../design/book-tokens.json), the single source of the tokens, with a script that writes `apps/manual/src/styles/tokens.css`: light values on `:root`, dark values under `prefers-color-scheme: dark` and under `[data-theme="dark"]`. The panel tokens follow the theme too: `panelLight` values on `:root`, `panelDark` (C1 Ember) values under `prefers-color-scheme: dark` and `[data-theme="dark"]` (owner, 2026-11-19: "approved those colors"). A test fails when the committed CSS differs from what the script generates. A token change starts in the JSON file, never in the CSS.
- [x] Use `#F2C2A4` for dark-mode links (owner, 2026-11-19; 10.05:1 on `#2A1E16`), and underline links in both modes, since neither link colour is 3:1 apart from body text.
- [x] Download the three font families from `google/fonts` at a recorded commit into `apps/manual/public/fonts/`, each with its `OFL.txt`, and add them to THIRD-PARTY-NOTICES.md.
- [x] Read Google Sans Code's `TRADEMARKS.md` before subsetting. A subset is a Modified Version under the OFL, so give subset files neutral names and say "derived from Google Sans Code" in the notices.
- [x] Build the layout and each component as an Astro component with no client script, then add the scripts that tabs, replays and the stepper need as progressive enhancement.
- [x] Use the rule tokens only for decorative dividers: never for text, focus rings or figure lines that carry meaning.
- [x] Write the contrast test: read every text and background pair from the `contrast` lists in `docs/design/book-tokens.json`, recompute each WCAG ratio, fail below 4.5:1, and fail when a recorded ratio differs from the recomputed one.
- [ ] Render a component gallery page in both themes, excluded from search, and compare it with the reference board. (The gallery is rendered; the comparison is the owner's, because only the owner can open the board.)

## Acceptance criteria

- [x] Every text and background pair on the light page, the dark page, the light panel and the dark panel meets WCAG AA (4.5:1 for body text), checked by the contrast test in `pnpm test` against the ratios in `book-tokens.json`
- [x] Listings and figures use the panel tokens of the current mode: in light mode a light panel with its `#E4D6C2` border, in dark mode C1 Ember
- [x] Headings render in Instrument Serif, body text in Literata and code in Google Sans Code, all served from the site; the site loads no font, script or style from another origin
- [x] Each font's `OFL.txt` ships beside its files, and THIRD-PARTY-NOTICES.md lists all three with their source commit
- [x] Every component renders on the gallery page in both themes with JavaScript disabled, and every control is reachable and visible by keyboard
- [x] The plan's BK12 records the owner's answer on the dark link colour
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (all pass locally except `verify/copilot-sdk`, which needs Linux; CI runs it)

## Tests

A Vitest test computes the contrast of every text and background pair from the built CSS and fails below 4.5:1, and fails when a page token lacks a dark value. The gallery page is built in `pnpm test` through the book's build smoke test.

## Docs to update

- The plan's BK12 with the dark link colour
- THIRD-PARTY-NOTICES.md for the fonts
- `apps/manual/README.md`: the tokens and where each may be used

## Risks and open questions

- The owner's reference board may show details the token table does not, such as spacing or the stepper's controls; match the board and record each added token in BK12.
- Literata and Instrument Serif may lack glyphs the chapters use, such as arrows or box-drawing characters; the glyph check from T6 and the gallery page catch them early.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **Tokens.** `apps/manual/scripts/generate-tokens.ts` (`pnpm --filter @buildanagent/manual tokens`) writes `src/styles/tokens.css` from `docs/design/book-tokens.json`. The font faces, fluid sizes and layout widths go on `:root`. The light page and panel values follow on `:root` and `[data-theme="light"]`, and the dark values under `prefers-color-scheme: dark` (unless the reader chose light) and `[data-theme="dark"]`. A test fails when the committed CSS differs from the generator's output, and when a page or panel token lacks its other-mode value.
- **Contrast.** `test/contrast.test.ts` reads every pair from the JSON file, takes each colour from the generated CSS, recomputes the WCAG ratio, and fails below 4.5:1 or when a recorded ratio differs at two decimals. All 20 text pairs pass; the lowest are the light accent (4.80) and the light panel's terracotta (5.32). The test also checks the four focus-ring pairs at 3:1 and the eight decorative entries below 3:1.
- **Tokens T2 proposed, accepted by the owner on 2026-11-19** ("Keep all"; BK12): the dark panel's border `#45352A` (the dark rule, mirroring the light panel), focus-ring pairs, phone sizes, layout widths and the font files. The owner also kept Literata's name ("Keep 'Literata'").
- **The gallery comparison is the owner's.** T2 could not open the reference board, so the layout follows BK12's description. The gallery at `/gallery/` shows both themes at full width, one above the other, for the owner to compare with the board, and that task stays unticked until the owner has done so.
- **Fonts.** google/fonts at `9bbbcda` (2026-11-11), with each upstream file's SHA-256 in `apps/manual/fonts/sources.json`. The served files are WOFF2 subsets written by fontTools 4.68.0 (run through `uv`, since pnpm has no font subsetter); the originals stay out of git. Google Sans Code's subsets are named Manual Code in their files, CSS and name tables, following its `TRADEMARKS.md`. Each family's `OFL.txt` ships beside its files, and THIRD-PARTY-NOTICES.md and LICENSE list them.
- **Deviation.** The task said to download the families into `public/fonts/`. Only the subsets and licence files live there, because the upstream Literata files alone are 1.9 MB.
- **Components.** The chapter layout plus contents, sidebar, listing block, tabs, annotation markers, replay controls, figure frame with the isometric stepper, side notes, glossary card and term, citation, search box, theme toggle and previous and next links, all in `apps/manual/src/components/`. Each renders complete without JavaScript; tabs, the stepper, replays, glossary cards and search get small enhancement scripts whose controls render hidden until the script runs. `/gallery/` shows every component in both themes, has no `data-pagefind-body` and carries `noindex`.
- **Offline build test.** `test/build.test.ts` builds the site into a temporary folder with an allowlisted environment and checks the gallery, the hidden controls, unique ids and that no page loads a font, script or style from another origin. `astro.config.mjs` now keeps every script and style external, so T9's content security policy can allow them by origin.
- **For later todos.** T3 adds the header's links to `/sources/` and `/glossary/` with those pages; until then only the gallery's citation and glossary samples point there. Literata and Instrument Serif lack box-drawing glyphs, so figures and listings should draw those in the code face. `pnpm test` passes for every package except `verify/copilot-sdk`, which needs Linux's `unshare`, as in T1.
