# L12d: Give apps/docs a figure pipeline and its first two figures

| Field | Value |
| --- | --- |
| ID | `L12d` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12a](../done/L12a-docs-theme-foundation.md) |
| Size | M |

## Goal

Let `apps/docs` draw flat SVG figures the way the book does: a figure is a script that draws with the book's `svgkit`, a committed SVG sits beside it and a test fails when it is stale, a directive inlines it with its alt text and caption, and every colour comes from the theme tokens. Deliver the pipeline and the first two figures: `package-map` and the docs home page's "three layers" illustration, which shows the harness, the loop (the SDK) and the gateway with what each does. L12o needs the second one, and it is drawn like the landing page's figure in `apps/site` so the two stay consistent. The manager asked for this on 2026-11-23.

## Context

- [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) and [L12](L12-docs-redesign.md): the plan, the nine figures and the design of the pipeline (scripts in `apps/docs/figures/`, a stale-file test, a `::figure` directive that inlines the SVG and fails without alt text).
- [L12a](../done/L12a-docs-theme-foundation.md): the book's exports (`@buildanagent/manual` design, tokens, `figures/svgkit`, `styles/figures.css`) that the docs already depend on.
- [`apps/manual/README.md`](../../../apps/manual/README.md#a-figure-is-a-script-that-draws-an-svg-and-the-build-inlines-it): how the book's figures work, including its SVG handling.
- `apps/site/figures/` (layers and its `lib/`): the landing page's figure script, which this todo reuses where sensible instead of copying.
- [docs-writing.md](../../guidelines/docs-writing.md#draw-a-diagram-where-a-picture-answers-faster): the diagram rules a figure follows.

## Scope

**In scope**

- `apps/docs/figures/`: a build script that runs each figure script and writes its SVG beside it, and a registry of figures.
- A `::figure` directive (or the Starlight-appropriate equivalent) that inlines a committed SVG with its alt text and caption, fails the build without alt text or a caption, and sanitises the SVG it inlines (no scripts, event handlers, external references or `foreignObject`).
- `figures.css` from the book, token-only colours, and a wide and a narrow layout.
- Figures `package-map` (the six packages and how they depend on each other) and `three-layers` (harness, loop and gateway, with what each does: tools, sessions and approvals; model calls and tool calls; streaming, retries and cost).
- Tests: a stale-SVG test, a test that the directive rejects missing alt text and unsafe SVG, a token-only colour test, and a build test that a page with a figure inlines it.

**Out of scope**

- Figures 3 to 9 (L12g, L12h, L12i and L12k) and any page content beyond a page that proves the pipeline works.
- The docs home page itself (L12o) and any header, theme or sidebar change (L12b, L12c).
- Editing anything under `.github/`.

## Tasks

- [ ] Build the pipeline: scripts, registry, the `figure` directive, the sanitiser and the CSS wiring, in new files with minimal wiring.
- [ ] Draw `package-map` and `three-layers`, reusing the landing page's drawing code where sensible.
- [ ] Write the tests above, and prove each fails when its subject breaks.
- [ ] Check the figures in light and dark and at a wide and a narrow width.

## Acceptance criteria

- [ ] `pnpm --filter @buildanagent/docs figures:build` writes both SVGs, and a test fails when a committed SVG is stale
- [ ] The directive fails the build for a figure with no alt text, no caption or an unsafe SVG
- [ ] No figure holds a colour value that isn't a theme token
- [ ] The built page that shows a figure inlines it with its alt text and caption
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`apps/docs/test/`.

## Docs to update

`apps/docs/README.md` (how to add a figure), the L12 todo's table and the plan's todo table.

## Risks and open questions

- L12b and L12c change `apps/docs` at the same time, so this todo keeps to new files and minimal wiring, and rebases on `main` often.
- The landing page's figure may draw with helpers that are not exported; reusing them may need a small export from `apps/site` or a shared module, which is a design decision to record.

## Definition of done

- [ ] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed
