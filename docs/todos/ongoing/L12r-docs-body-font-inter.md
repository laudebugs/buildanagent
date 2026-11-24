# L12r: Set the docs' body text in Inter and keep Instrument Serif for titles

| Field | Value |
| --- | --- |
| ID | `L12r` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-24) |
| Depends on | [L12a](../done/L12a-docs-theme-foundation.md) |
| Size | S |

## Goal

Change the body text of `docs.buildanagent.fyi` from Literata to Inter, the owner's decision of 2026-11-24 (option A). Instrument Serif stays for the page title, the home page's card titles and the second-level headings; third-level headings and smaller take Inter at weight 600. The code font does not change. The book keeps its own fonts.

## Context

- L12a gave the docs the book's three fonts through `docs/design/book-tokens.json` and a byte-identical copy of the book's font folders.
- The book already ships Inter as a face of its reading settings (`font.reading.faces.inter`), self-hosted as a variable roman and italic subset, so the docs need no new source file.
- The owner's mock (docs.buildanagent.fyi, option A): h2 in Instrument Serif at 400, h3 and smaller in Inter at 600, body in Inter at 400, 16px with a 1.65 line height.

## Scope

**In scope**

- `apps/docs/src/design/theme.ts` builds the docs' tokens with Inter as the body face, and the docs font copy takes the Inter folder in place of the Literata one.
- `starlight.css` sets h3 to h6 in the body face at weight 600; `Head.astro` preloads Inter's roman file.
- Tests, the README's theme section, `THIRD-PARTY-NOTICES.md` and fact-check rows.

**Out of scope**

- The book's fonts, tokens and files, and `apps/site`.
- Any change to colours or contrast pairs.

## Tasks

- [ ] Choose Inter as the docs' body face in `theme.ts` and regenerate `tokens.css` and `public/fonts/`.
- [ ] Map headings and the preload, and update the tests.
- [ ] Look at the built pages in a browser at 1280 and 390 px, light and dark.
- [ ] Update the README, the notices and the fact-check log.

## Acceptance criteria

- [ ] The docs' `--font-body` is Inter, `--font-display` is Instrument Serif and `--font-code` is Manual Code, and no Literata file, rule or preload remains in `apps/docs`.
- [ ] The docs font files are byte-identical with the book's, and the colour pairs are unchanged and pass.
- [ ] The book's tests pass untouched.

## Tests

`apps/docs/test/fonts.test.ts`, `tokens.test.ts` and `styles.test.ts`.

## Docs to update

`apps/docs/README.md` (the theme section), `THIRD-PARTY-NOTICES.md`, the fact-check log and the L12 umbrella todo.

## Risks and open questions

- Inter's variable font is wider than Literata's at the same size, so lines may wrap earlier; the screenshots check it.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
