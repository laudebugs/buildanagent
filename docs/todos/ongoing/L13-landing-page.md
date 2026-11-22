# L13: Build the landing page for buildanagent.fyi

| Field | Value |
| --- | --- |
| ID | `L13` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L7](../done/L7-website-app.md) |
| Size | L (split the figure from the page if the pull request grows past one review) |

## Goal

Replace the plain home page of `apps/site` with the owner's chosen design, the figure-first layout "A · Centred": a headline, a flat figure of the three layers and one turn of the loop, three short cells and a grid of the six packages. The page uses the book's tokens and fonts in light and dark, carries the "the prompt" logo in its header and favicon, and makes only claims that the package READMEs and npm confirm.

## Context

- [`docs/design/landing/README.md`](https://github.com/laudebugs/buildanagent/blob/claude/happy-albattani-p54jjp/docs/design/landing/README.md) on the manager's branch `claude/happy-albattani-p54jjp`: the owner's choices (2026-11-22). The same folder holds `mock-figure-first.html` (the "A · Centred" tab is the design), `logo-mark.svg`, `favicon.svg` and `logo-prompt.svg`. Fetch the branch by name and do not merge it.
- [`apps/site`](../../../apps/site) and [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md): the site is plain Astro with no adapter, and its `test` builds it and checks the pages, the links and the docs-writing rules.
- [`docs/design/book-tokens.json`](../../design/book-tokens.json), [`apps/manual/README.md`](../../../apps/manual/README.md) and the [L12 plan](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the tokens, the self-hosted fonts and the figure kit. L12a exports them from `@buildanagent/manual` by package name, and L12p adds one shared header source. This page reuses whatever lands first.
- [docs-writing.md](../../guidelines/docs-writing.md): the rules the copy follows.

## Scope

**In scope**

- The landing page at `/`, in the mock's section order: header, hero, figure, three cells, six packages, footer.
- The manual's tokens and self-hosted fonts, in light and dark.
- A flat figure drawn by a script, a stale-file test, an inline SVG with alt text, and a narrow variant for phones.
- A header with the inline mark (`currentColor` and the accent token) and the links Docs, Manual, Site and GitHub, in one small module that L12p later replaces with the shared source.
- The favicon at 16 and 32 pixels, checked on both grounds.
- A fact-check of every claim in the copy, logged in `docs/plans/reviews/fact-check-landing-page.md`.

**Out of scope**

- The shared header source and the tokens export (L12a, L12p).
- Package pages for the four packages that have none yet.
- The docs home (L12o) and the book's header.
- `.github/workflows/`.

## Tasks

- [x] Claim the todo and tell the manager.
- [x] Draft the copy with `/anthropic-skills:writing` and fact-check each claim against the package READMEs, `package.json` and `npm view`; the one-liners and the alpha-tag line match what npm shows.
- [x] Generate the site's tokens and fonts from the book's source, or from the L12a export if it has landed, and tell the manager which.
- [x] Draw the figure with a script: wide layout from the mock and a narrow one for 400 pixels, with no label overlapping a block, plus a test that fails when the committed SVG is stale.
- [x] Build the page, header and footer; inline the figure with its alt text; add the favicon.
- [x] Extend the `apps/site` tests: the page's headings and links, the alt text, no hex colours outside the tokens file, the figure's staleness and the favicon.
- [x] Check the page at 400 pixels and at desktop width in light and dark with Playwright, and attach the screenshots.

## Acceptance criteria

- [ ] `pnpm --filter @buildanagent/site test` and `build` pass, and so do `pnpm check`, `pnpm typecheck` and `pnpm test`.
- [ ] No horizontal scroll at 400 pixels, and no label touches a block in either figure.
- [ ] Every sentence of the copy that states a fact has a ✅ row in the fact-check log.
- [ ] The install line and the alpha line match npm's dist-tags on the day of the merge.

## Tests

`apps/site/test` holds the page, link, figure and token checks; the figure's script test lives beside the script. A Playwright check of the layout runs by hand and its screenshots go in the pull request.

## Docs to update

[`apps/site`'s README](../../../apps/site) if it has one, and the plan's todo table.

## Risks and open questions

- L12a may land mid-way. The page starts on a small generator of its own and switches to the export without a visible change.
- The mock draws the figure wide. The narrow variant is a new drawing, not a scaled one.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
