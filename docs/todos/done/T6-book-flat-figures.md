# T6: Flat figure pipeline: generated SVGs, numbering, themes and the staleness test

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T6` |
| Status | `done` |
| Plan | [Book plan §5, BK10 and BK11](../../plans/build-book.md#bk11-generated-checked-inlined-figures-that-work-without-javascript-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T2](../done/T2-book-design.md), [T3](../done/T3-book-content-model.md) |
| Size | M |

## Goal

Give chapters a way to add flat diagrams that stay correct. Each figure is a committed script that writes an SVG; a test fails when a committed SVG differs from what its script draws now; the build inlines it so it follows the page's theme, numbers it, and fails without alt text or a caption.

## Context

- [Book plan BK10 and BK11](../../plans/build-book.md#bk10-flat-diagrams-and-a-few-isometric-centerpieces-accepted).
- The garment repository at commit `bca44b0`: `scripts/figures/svgkit.py` (embedded font subset, glyph check, checked lines and arrowheads), `scripts/tests/figure_staleness.py` and `src/lib/markdown/rehype-figures.mjs` ([ADR 0054](../../decisions/0054-reuse-garment-textbook-code.md)).
- T2's tokens, which the figures' colours use.

## Scope

**In scope**

- `apps/manual/figures/lib/svgkit.ts`, a TypeScript port of the garment helper
- One script per figure under `apps/manual/figures/<chapter>/`, and a `figures:build` script
- The staleness test, and the figure plugin with numbering, inline SVG, alt text and caption rules
- One sample figure for Chapter 1 that exercises every helper
- A second figure kind, `analogy`, for analogy illustrations (BK22): the same tokens from `docs/design/book-tokens.json`, alt text, caption and both themes, with a caption that names the register entry and links to its "where the analogy breaks" note

**Out of scope** (and which todo covers it)

- Isometric and interactive figures ([T7](T7-book-isometric-figures.md))
- Each chapter's own figures (the chapter todos)

## Tasks

- [x] Port `svgkit.py` to TypeScript with a header comment naming its origin, commit and Apache-2.0 licence: palette from T2's tokens as `var(--…)` references, so every figure renders in the light-panel colours in light mode and the dark-panel colours in dark mode, a subset font embedded as a data URI, `text()` that throws on a glyph outside the subset, checked lines and arrowheads.
- [x] Write `figures:build`, which runs every figure script and writes its SVG next to it.
- [x] Write the staleness test: run every script in memory and compare with the committed SVG byte for byte, naming the script to rerun on failure.
- [x] Adapt `rehype-figures.mjs` with the same header comment: inline the SVG, number it from the outline, and fail without alt text or a caption.
- [x] Draw the sample figure, check it in both themes and at 200% zoom, and add the files to THIRD-PARTY-NOTICES.md.
- [x] Add the `analogy` kind: an analogy figure must name an entry in `src/content/analogies.json` whose `illustration` is that figure's id, and its caption starts with the analogy's name. Draw one sample analogy figure (the kitchen ticket rail from T10's register entry, flat).

## Acceptance criteria

- [x] Changing a figure script without rerunning `figures:build` fails `pnpm test`
- [x] A figure without alt text or a caption fails the build, naming the file
- [x] The sample figure has a light and a dark rendering from the panel tokens of each mode, switches with the page theme, and needs no JavaScript
- [x] Drawing a glyph outside the embedded subset throws, with the glyph named
- [x] An analogy figure whose register entry is missing, or names another figure, fails the build; the sample analogy figure renders in both themes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest: the staleness test over every figure, plus unit tests for `svgkit.ts` and the figure plugin.

## Docs to update

- `apps/manual/README.md`: how to add a figure
- THIRD-PARTY-NOTICES.md

## Risks and open questions

- Inline SVGs share the page's id space; prefix every id with the figure's id so two figures cannot clash.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `figures/lib/svgkit.ts` ports the garment kit at `bca44b0`. It embeds the upright Manual Code subset from `public/fonts/` as a data URI and reads that file's character map, so `text()` throws on a glyph the font lacks and names it with its code point. It draws boxes, lines, curves, dots, arrowheads and box-to-box arrows. It throws when a mark leaves the canvas, a label overflows its box, two labels overlap, a line or curve crosses a label, or two boxes cannot be joined. Every id is `<figure id>--<name>`, numbers carry at most two decimals, and the file holds no timestamp, so a redraw writes the same bytes.
- Colours are the `fig-*` classes in `src/styles/components.css`, over the panel tokens. Each committed SVG embeds those rules, both modes' panel tokens and the font, so it renders on its own; the font makes the file about 61 KB. The build drops that `<style>` when it inlines the figure, because T2's build test forbids inline styles on a page.
- `figures:build` writes the SVG of every `figures/<chapter>/<id>.ts`, and of the two fixture books' figure scripts, beside its script. `test/figures.test.ts` redraws each figure and fails, naming the script, when a committed SVG differs byte for byte, when a script's SVG is missing, or when an SVG has no script. One test edits a copied script and checks that its SVG goes stale.
- A chapter places a figure as `:::figure[Caption]{#id}` holding one `::svg{alt="…"}`. `remark-figures` inlines the drawing on the figure panel and names it with the alt text; T3's plugins number it from the outline and build its caption. An analogy illustration adds `analogy="<register id>"`, and `rehype-analogy-figures` checks the entry and the caption, then links the caption to the entry's break note. Every rule fails with the chapter's file and line in `check:book` and the build, through T3's `failAt`. `check-book.test.ts` gains twelve failing fixtures, and the first review round added five more; each produces exactly one problem.
- The samples are Chapter 1's `figures/call-workflow-loop/who-decides.ts` and the fixture book's kitchen ticket rail, `test/fixtures/book/figures/first/ticket-rail.ts`. The ticket rail stays in the fixture book because the book's analogy register is empty: registering the analogy now would claim it before T10 writes Chapter 1. The site fixture places both, with its own `figures/` and `analogies.json`, so the build test checks the ticket rail's caption link and break note on a built page. Both render in both themes and at 200% zoom in headless Chrome, and the gallery shows the Chapter 1 figure in each theme.
- The three adapted files carry the Apache-2.0 header and are listed in THIRD-PARTY-NOTICES.md. Biome skips the generated SVGs, which the staleness test checks instead. The WOFF2 reader moved from `test/` to `src/design/woff2.ts`, so the figure kit and the font tests share it.
- **First review round, and the owner's decision of 2026-11-19.** On a phone a figure keeps its natural size and its panel scrolls sideways, with a hint and a focusable, caption-named stage; the kit refuses a figure wider than 520 units (our choice), and both samples were redrawn to fit. At 360 px every label renders at 12 px in Chrome. The inliner now passes only the kit's elements and attributes. Blank captions fail for every numbered block, and an unmarked illustration fails whichever chapter's entry names it. The fixtures' figures and analogy register come from `BOOK_FIXTURE_DIR`, so the book's `figures/` holds only Chapter 1's figure.
- **Second review round.** The scroll hint now shows exactly when a stage overflows. Its animation runs on the stage's scroll timeline, which stays inactive while nothing scrolls. This timeline replaces the width threshold, which showed the hint at some widths where nothing scrolled. The stage stays focusable on every screen, our choice, because CSS cannot make it focusable only while it overflows. New tests cover the WOFF2 reader's failure paths and its decompress-once cache, and the figure registry's handling of Windows path separators.
