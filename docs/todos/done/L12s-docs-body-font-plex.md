# L12s: Set the docs' body text in IBM Plex Sans

| Field | Value |
| --- | --- |
| ID | `L12s` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-24) |
| Depends on | [L12r](L12r-docs-body-font-inter.md) |
| Size | S |

## Goal

Replace Inter with IBM Plex Sans as the body face of `docs.buildanagent.fyi`, the owner's decision of 2026-11-24, which supersedes [L12r](L12r-docs-body-font-inter.md). Instrument Serif stays for the page title, the second-level headings and the home page's card titles; third-level headings and smaller take the body face at weight 600 at the sizes L12r set. The code font (Manual Code) and the colours do not change. The book keeps its own fonts.

## Context

- The book does not use Plex, so the docs cannot copy it from the book as they copied Inter. The docs app owns the Plex files.
- IBM publishes the family under the SIL Open Font License 1.1 with the Reserved Font Name "Plex". A subset is a Modified Version and may not use that name, so the plan ships IBM's own split WOFF2 files unchanged.
- L12r left the type scale (h3 to h6 at 1.375, 1.125, 1.0625 and 1rem, weight 600) and the 1.65 body line height; both stay.

## Scope

**In scope**

- IBM's official WOFF2 files for the weights and styles the docs render, pinned to one release at least a week old, with the licence file and a source note recording the version, URL and SHA-256 of every file.
- `theme.ts`, the generated `tokens.css`, `Head.astro`, `starlight.css` and a metric-matched fallback face.
- Tests, the README, `AGENTS.md`, `THIRD-PARTY-NOTICES.md` and fact-check rows.

**Out of scope**

- The book's fonts and `apps/site`.
- Any change to colours, contrast pairs or the code font.

## Tasks

- [x] Fetch and verify the upstream package; choose the files; record the pin and hashes.
- [x] Wire the faces, the fallback and the preload; regenerate `tokens.css`; drop Inter from the docs.
- [x] Update the tests, then look at the built pages at 1280 and 390 px in both themes.
- [x] Update the README, `AGENTS.md`, the notices and the fact-check log.

## Acceptance criteria

- [x] The docs' `--font-body` is IBM Plex Sans, `--font-display` is Instrument Serif and `--font-code` is Manual Code, and no Inter or Literata file, rule or preload remains in `apps/docs`.
- [x] The Plex files match the SHA-256 values recorded beside them, and the Instrument Serif and Manual Code files stay byte-identical with the book's.
- [x] The colour pairs are unchanged and pass, and the book's tests pass untouched.

## Tests

`apps/docs/test/fonts.test.ts`, `tokens.test.ts` and `styles.test.ts`.

## Docs to update

`apps/docs/README.md`, `AGENTS.md`, `THIRD-PARTY-NOTICES.md`, the fact-check log, the L12 umbrella todo and the plan's todo table.

## Risks and open questions

- Whether IBM's split files count as unmodified under the OFL is a reading of the licence's text; the notices record it.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

The docs' body text is IBM Plex Sans: IBM's own Latin1 WOFF2 files for regular, italic and semibold from `@ibm/plex-sans` 1.1.0 (2.0.0 was six days old), unchanged and so under the name "IBM Plex Sans" despite the Reserved Font Name "Plex". The docs' WOFF2 total falls from 325,412 to 201,596 bytes. A metric-matched Arial stand-in keeps lines the same height with fonts blocked. Heading sizes, Instrument Serif, Manual Code and the colours are unchanged. Claims are in the fact-check log, rows L12s-1 to L12s-23. Open question for the owner: whether to accept the reading of the OFL recorded in `THIRD-PARTY-NOTICES.md` (row L12s-10).
