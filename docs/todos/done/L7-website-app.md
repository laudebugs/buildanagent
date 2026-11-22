# L7: Build the website for buildanagent.fyi

| Field | Value |
| --- | --- |
| ID | `L7` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | None |
| Size | S |

## Goal

Stand up `apps/site`, the website for `buildanagent.fyi`: what buildanagent is, the packages, and links to the docs and the repository ([DS2](../../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted), ADR 0049).

## Context

- [DS2](../../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted) and [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md)
- [docs-writing.md](../../guidelines/docs-writing.md) for the copy
- Lamina PDF's `apps/site`

## Scope

**In scope**

- `apps/site` (`@buildanagent/site`, private), plain Astro, pinned like `apps/docs`
- A landing page, a page per package, and links to `docs.buildanagent.fyi` and the repository
- A footer with the licences: code Apache-2.0 OR MIT, content CC BY 4.0

**Out of scope** (and which todo covers it)

- Deploys (L8)

## Acceptance criteria

- [x] `pnpm -C apps/site build` writes a static site to `apps/site/dist/`
- [x] The landing page's copy passes the writing review, with its scores in the pull request description
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

A build test under `apps/site/test/`.

## Docs to update

AGENTS.md (layout), README.md, the plan's todo table.

## Risks and open questions

The site makes claims about the product; each one needs a source in the repo, as every document does.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

`apps/site` (`@buildanagent/site`, private) builds a static Astro site for buildanagent.fyi from Markdown pages inside one layout: a landing page, a page for the gateway and one for the SDK. Every page links to `docs.buildanagent.fyi` and the repository, and every footer names the code licence, Apache-2.0 OR MIT, and the content licence, CC BY 4.0, with a link to the code licence's text.

- **A test builds the site.** It builds into a temporary folder and checks each page's title, description, footer and links, that every internal link points at a built page, and the docs-writing rules over the Markdown: an opening paragraph of 50 words or fewer, sentences of 40 and paragraphs of 100, and no id, path or banned word.
- **Every claim has a row.** Rows L7-1 to L7-16 in `docs/plans/reviews/fact-check-website-app.md` tie each statement to a package README, a `package.json` or the registry.
- **The pin is the docs app's.** Astro 7.4.11, as the docs app and the book use.
- **The site holds no script and no font.** It is plain HTML and one stylesheet with a light and a dark theme, so there is nothing to load or to deploy but the files.
