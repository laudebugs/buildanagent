# L12a: Give apps/docs the book's theme through generated tokens, shared fonts and a Starlight mapping

| Field | Value |
| --- | --- |
| ID | `L12a` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | None |
| Size | M |

## Goal

Make `docs.buildanagent.fyi` look like `manual.buildanagent.fyi` without copying its CSS: the docs app generates a tokens file from `docs/design/book-tokens.json` the way the book does, self-hosts the book's fonts, and maps the tokens onto Starlight's variables in one stylesheet, in light and dark, with the colour pairs measured. Every later L12 todo builds on it, and `apps/site` can reuse the pipeline.

## Context

- The L12 plan (study of 2026-11-22): the book's theme is four colour sets in `docs/design/book-tokens.json` (`light`, `dark`, `panelLight`, `panelDark`), three fonts (Instrument Serif at weight 400, Literata, Manual Code; all OFL), fluid sizes, a 1.7 line height and a 42rem measure. `apps/manual/src/design/tokens.ts` writes `--color-*`, `--panel-*`, `--font-*`, `--size-*`, `--measure` and `--gutter`.
- `apps/manual/README.md`: the tokens script, the staleness test and the self-hosted font subsets.
- The manager's defaults (2026-11-22): the theme follows the system, with Starlight's theme select restyled; body font Literata; plain diagram backgrounds. The logo slot and the shared header are one-line changes later.

## Scope

**In scope**

- `apps/manual/package.json` gains `exports` for `./design/tokens`, `./design/contrast`, `./design/woff2`, `./figures/svgkit` and `./styles/figures.css` (the last split out of `components.css` so the book's `figureRules()` still reads it), and `tokensCss()` takes the header comment and the font base path. The book's behaviour and tests do not change.
- `apps/docs` takes `@buildanagent/manual` as a `workspace:*` devDependency, generates `src/styles/tokens.css` with `scripts/generate-tokens.ts` (`pnpm --filter @buildanagent/docs tokens`), and a test fails when the file is stale.
- One `src/styles/starlight.css` (in Starlight's `customCss`) maps `--sl-*` onto the tokens with `var()` only, no hex values: backgrounds, text greys, rules, the accent, link colour, fonts, content width, the aside colour families, and headings in Instrument Serif at weight 400.
- Expressive Code gets two themes generated from `panelLight` and `panelDark`, with `styleOverrides` that use `var(--panel-*)` and `var(--font-code)`.
- The generator copies the six WOFF2 subsets with their `OFL.txt` and `TRADEMARKS.md` from `apps/manual/public/fonts/` into `apps/docs/public/fonts/`; a test fails when a byte differs from the book's; a `Head` override preloads Literata roman and Instrument Serif regular; `THIRD-PARTY-NOTICES.md` names the docs copy.
- A docs contrast test checks the extra pairs Starlight's roles create (sidebar current item, aside titles, links, code on panel) with the manual's contrast function, 4.5:1 for text and 3:1 for non-text, in light and dark; a test fails on any hex value in a docs stylesheet.

**Out of scope**

- The logo, the header and footer overrides, the sidebar topics, diagrams and the new packages' pages (other L12 todos).
- Changing `docs/design/book-tokens.json` (the manual's contrast test asserts exactly 38 pairs).

## Tasks

- [x] Add the manual's exports and parameterise `tokensCss()`; run the manual's tests.
- [x] Generate the docs tokens file and write its staleness test.
- [x] Write `starlight.css` and the Expressive Code themes.
- [x] Copy the fonts, add the preload and the byte-identity test.
- [x] Write the contrast and no-hex tests.
- [ ] Screenshot the built site in light and dark (Playwright, scale 1, into `/tmp`) and attach the findings to the pull request.

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/docs tokens` writes `tokens.css`, and a test fails when it is stale.
- [x] No hex value appears in `starlight.css` or any other docs stylesheet (a test checks it).
- [x] The contrast test passes for every named pair in light and dark.
- [x] The docs font files are byte-identical to the book's (a test checks it).
- [x] The book's tests and build still pass. (`pnpm --filter @buildanagent/manual test`: 496 passed; the build was not rerun.)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the docs build is no more than a few seconds slower than its 19 s baseline.

## Tests

`apps/docs/test/tokens.test.ts`, `fonts.test.ts`, `contrast.test.ts` and `styles.test.ts`, ported from the manual's equivalents; the manual's own tests.

## Docs to update

`apps/docs/README.md` (the theme section), AGENTS.md's `apps/` entry, THIRD-PARTY-NOTICES.md, the plan's todo table.

## Risks and open questions

Starlight's Expressive Code themes and `--sl-*` variables may change in a minor release: pin exactly and record in the README which variables the mapping depends on.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

**What shipped.** `apps/manual` exports `./design/tokens`, `./design/contrast`, `./design/woff2`, `./figures/svgkit` and `./styles/figures.css`. The `fig-*` rules moved from `components.css` to `figures.css` so the book's `figureRules()` and the docs can read them without the book's page styles, and `tokensCss()` takes a header comment and a font folder. `apps/docs` generates `src/styles/tokens.css` with that function, copies the book's six WOFF2 subsets and their licence files into `public/fonts/`, maps the tokens onto Starlight 0.42.10's `--sl-*` variables in `src/styles/starlight.css`, and builds two Expressive Code themes from the panel colours. A `Head` override preloads the two roman faces. `pairs.ts` lists 47 colour pairs that Starlight's roles, linked inline code and the code markers create, and four test files (`tokens`, `fonts`, `contrast`, `styles`) guard the result.

Printing gets its own rules. The generated `tokens.css` ends with an `@media print` block that sets the light and light-panel colours, and a print rule switches code to Expressive Code's light syntax colours, so printing in dark mode gives dark text on a light page. Marked, inserted and deleted code take measured panel colours, because zero contrast correction also turned off Expressive Code's own marker correction. A contrast test requires that text drawn in a background colour is hidden or repainted when printed, so a printed line-marker label takes its line's edge colour on no fill. The styles test fails on a decorative variable that nothing reads, and it scans Pagefind's stylesheet. `pnpm --filter @buildanagent/docs test` passes with 148 tests. The README's theme section says where each piece lives, what the mapping depends on and how to upgrade Starlight.

**Decisions and rejected alternatives.**

- Fonts are copied into `apps/docs/public/fonts/` and a test keeps them identical to the book's. Rejected: linking to manual.buildanagent.fyi, which makes every docs page fetch from another origin and ties the docs to the book's deploy.
- The docs' extra colour pairs live in `src/design/pairs.ts`, not in `book-tokens.json`. Rejected: adding them to the JSON, because the book's contrast test asserts exactly 38 pairs and the todo keeps the JSON unchanged.
- `minSyntaxHighlightingColorContrast` is 0. Rejected: keeping Expressive Code's default of 5.5, which would shift measured panel colours to unmeasured ones.
- Light and dark follow the system, as the book does, and the body font is Literata (the manager's defaults of 2026-11-22). Rejected: a docs-only palette.

**Not verified.** The light and dark screenshots of the built site and the build time against the 19 s baseline are the builder's own measurements, which the documentation pass did not repeat. The builder checked the print stylesheet in Chromium with print media and a dark scheme and saw dark text on a light page; the documentation pass opened no browser. Starlight's search dialog and a file tree were not looked at in a browser. The book's build was not rerun in the documentation pass.
