# T6: Flat figure pipeline: generated SVGs, numbering, themes and the staleness test

> **History:** the owner put the book's todos on hold on 2026-11-19 pending approval of the book plan, and approved the plan the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T6` |
| Status | `ready` |
| Plan | [Book plan §5, BK10 and BK11](../../plans/build-book.md#bk11-generated-checked-inlined-figures-that-work-without-javascript-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T2](T2-book-design.md), [T3](T3-book-content-model.md) |
| Size | M |

## Goal

Give chapters a way to add flat diagrams that stay correct. Each figure is a committed script that writes an SVG; a test fails when a committed SVG differs from what its script draws now; the build inlines it so it follows the page's theme, numbers it, and fails without alt text or a caption.

## Context

- [Book plan BK10 and BK11](../../plans/build-book.md#bk10-flat-diagrams-and-a-few-isometric-centerpieces-accepted).
- The garment repository at commit `bca44b0`: `scripts/figures/svgkit.py` (embedded font subset, glyph check, checked lines and arrowheads), `scripts/tests/figure_staleness.py` and `src/lib/markdown/rehype-figures.mjs` ([ADR 0054](../../decisions/0054-reuse-garment-textbook-code.md)).
- T2's tokens, which the figures' colours use.

## Scope

**In scope**

- `apps/book/figures/lib/svgkit.ts`, a TypeScript port of the garment helper
- One script per figure under `apps/book/figures/<chapter>/`, and a `figures:build` script
- The staleness test, and the figure plugin with numbering, inline SVG, alt text and caption rules
- One sample figure for Chapter 1 that exercises every helper
- A second figure kind, `analogy`, for analogy illustrations (BK22): the same tokens from `docs/design/book-tokens.json`, alt text, caption and both themes, with a caption that names the register entry and links to its "where the analogy breaks" note

**Out of scope** (and which todo covers it)

- Isometric and interactive figures ([T7](T7-book-isometric-figures.md))
- Each chapter's own figures (the chapter todos)

## Tasks

- [ ] Port `svgkit.py` to TypeScript with a header comment naming its origin, commit and Apache-2.0 licence: palette from T2's tokens as `var(--…)` references, so every figure renders in the light-panel colours in light mode and the dark-panel colours in dark mode, a subset font embedded as a data URI, `text()` that throws on a glyph outside the subset, checked lines and arrowheads.
- [ ] Write `figures:build`, which runs every figure script and writes its SVG next to it.
- [ ] Write the staleness test: run every script in memory and compare with the committed SVG byte for byte, naming the script to rerun on failure.
- [ ] Adapt `rehype-figures.mjs` with the same header comment: inline the SVG, number it from the outline, and fail without alt text or a caption.
- [ ] Draw the sample figure, check it in both themes and at 200% zoom, and add the files to THIRD-PARTY-NOTICES.md.
- [ ] Add the `analogy` kind: an analogy figure must name an entry in `src/content/analogies.json` whose `illustration` is that figure's id, and its caption starts with the analogy's name. Draw one sample analogy figure (the kitchen ticket rail from T10's register entry, flat).

## Acceptance criteria

- [ ] Changing a figure script without rerunning `figures:build` fails `pnpm test`
- [ ] A figure without alt text or a caption fails the build, naming the file
- [ ] The sample figure has a light and a dark rendering from the panel tokens of each mode, switches with the page theme, and needs no JavaScript
- [ ] Drawing a glyph outside the embedded subset throws, with the glyph named
- [ ] An analogy figure whose register entry is missing, or names another figure, fails the build; the sample analogy figure renders in both themes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest: the staleness test over every figure, plus unit tests for `svgkit.ts` and the figure plugin.

## Docs to update

- `apps/book/README.md`: how to add a figure
- THIRD-PARTY-NOTICES.md

## Risks and open questions

- Inline SVGs share the page's id space; prefix every id with the figure's id so two figures cannot clash.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
