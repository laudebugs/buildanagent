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

Let `apps/docs` draw flat SVG figures the way the book does: a figure is a script that draws with the book's `svgkit`, a committed SVG sits beside it and a test fails when it is stale, a directive inlines it with its alt text and caption, and every colour comes from the theme tokens. Deliver the pipeline and the plan's first two figures: `package-map`, the six packages and what each imports, and `run-loop`, one run of the SDK's loop from the first model call to its stop reason. Both keep the flat style of the book and of the landing page's figure in `apps/site`. The manager asked for this on 2026-11-23 and, the same day, replaced the docs home's "three layers" figure with `run-loop` (see Out of scope).

## Context

- [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) and [L12](L12-docs-redesign.md): the plan, the nine figures and the design of the pipeline (scripts in `apps/docs/figures/`, a stale-file test, a `::figure` directive that inlines the SVG and fails without alt text).
- [L12a](../done/L12a-docs-theme-foundation.md): the book's exports (`@buildanagent/manual` design, tokens, `figures/svgkit`, `styles/figures.css`) that the docs already depend on.
- [`apps/manual/README.md`](../../../apps/manual/README.md#a-figure-is-a-script-that-draws-an-svg-and-the-build-inlines-it): how the book's figures work, including its SVG handling.
- `apps/site/figures/` (layers and its `lib/`) and the docs home mock (`docs/design/docs-home/` on the manager's branch `claude/happy-albattani-p54jjp`, tab A): the look the figures keep.
- [docs-writing.md](../../guidelines/docs-writing.md#draw-a-diagram-where-a-picture-answers-faster): the diagram rules a figure follows.

## Scope

**In scope**

- `apps/docs/figures/`: a build script that runs each figure script and writes its SVG beside it, and a registry of figures.
- A `::figure` directive (or the Starlight-appropriate equivalent) that inlines a committed SVG with its alt text and caption, fails the build without alt text or a caption, and sanitises the SVG it inlines (no scripts, event handlers, external references or `foreignObject`).
- `figures.css` from the book, token-only colours, and a wide and a narrow layout.
- Figures `package-map` (the six packages and how they depend on each other) and `run-loop` (one run of the loop: the model call, the tool calls it asks for and their results, until the model answers or another stop reason ends the run).
- Tests: a stale-SVG test, a test that the directive rejects missing alt text and unsafe SVG, a token-only colour test, and a build test that a page with a figure inlines it.

**Out of scope**

- Figures 3 to 9 (L12g, L12h, L12i and L12k) and any page content beyond the pages that prove the pipeline works.
- The docs home's "three layers" figure. The manager dropped it on 2026-11-23: the owner chose design A for the docs home, package cards with no illustration, so L12o needs no figure from this todo.
- The docs home page itself (L12o) and any header, theme or sidebar change (L12b, L12c).
- Editing anything under `.github/`.

## Tasks

- [x] Build the pipeline: scripts, registry, the `figure` directive, the sanitiser and the CSS wiring, in new files with minimal wiring.
- [x] Draw `package-map` and `run-loop` in the style of the book and the landing page.
- [x] Write the tests above, and prove each fails when its subject breaks.
- [x] Check the figures in light and dark and at a wide and a narrow width.

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/docs figures:build` writes the `package-map` and `run-loop` SVGs, and a test fails when a committed SVG is stale
- [x] The directive fails the build for a figure with no alt text, no caption or an unsafe SVG
- [x] No figure holds a colour value that isn't a theme token
- [x] The built page that shows a figure inlines it with its alt text and caption
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`apps/docs/test/`.

## Docs to update

`apps/docs/README.md` (how to add a figure), the L12 todo's table, the plan's todo table and the sentence in [docs-writing.md](../../guidelines/docs-writing.md#draw-a-diagram-where-a-picture-answers-faster) that says no test checks the diagram rules.

## Risks and open questions

- L12b and L12c change `apps/docs` at the same time, so this todo keeps to new files and minimal wiring, and rebases on `main` often.
- The landing page's figure draws with helpers that `apps/site` does not export. With `three-layers` dropped, no figure here copies its drawing, so the question closed without an export (see Outcome).

## Definition of done

- [ ] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

**What shipped.** `apps/docs/figures/` holds the pipeline and the two figures. `registry.ts` lists the figure ids and the folder's paths, `draw.ts` runs a script and rewrites the kit's header comment to name the docs' command, and `build.ts` is `figures:build`. `package-map.ts` and `run-loop.ts` draw with `@buildanagent/manual/figures/svgkit`, and their SVGs sit beside them. `src/plugins/figure.ts` is the `::figure` remark plugin, `src/plugins/figure-svg.ts` the sanitiser, and `src/styles/figures.css` the figure panel. The wiring is one entry in `markdown.remarkPlugins`, two `customCss` entries (the book's `figures.css`, then the panel), the figure SVGs in `render-inputs.ts` so Astro's cache drops a page whose figure changed, `figures/**` in `tsconfig.json`, one Biome ignore for the generated SVGs, and three devDependencies (`remark-directive` 4.0.0, `hast-util-to-html` 9.0.7 and `@types/hast` 3.0.5, all already in the lockfile). `run-loop` sits on "What the SDK is" and `package-map` on "Packages and entry points", each with page text that states every fact it shows, so no new page or sidebar entry was needed. The tokens test now accepts entries after `starlight.css` in `customCss`.

**Directive design.** A leaf directive, `::figure[caption]{id="…" alt="…"}`, because Starlight already registers remark-directive for its asides and runs its directive restoration after the user's remark plugins, so a figure needs no MDX and no component. The plugin replaces the directive with an empty paragraph whose `hName`, `hProperties` and `hChildren` render the `<figure>`, so the drawing goes in as hast elements, never as a raw HTML string, and works the same in `.md` and, once L12b enables it, `.mdx`. The MDX path is not yet tested, because the app has no MDX integration. The build fails, naming the page and line, on a missing or unregistered id, blank alt text, a blank caption, any other attribute, a caption with more than text and inline code, a container or inline form, or a figure shown twice on a page. The SVG's `role="img"` and `aria-label` carry the alt text, and the stage, which takes focus so a keyboard can scroll it, is named by the caption.

**Sanitiser rules.** The check is an allowlist of exactly what svgkit writes and fails closed: nothing is stripped or repaired. The file must match the kit's layout: the docs' header comment for this figure, the kit's root tag, then one `<style>` with no `<` in it, which is dropped unread. Then the drawing is read tag by tag: the elements are `g`, `rect`, `path`, `circle` and `text`, each closing the way the kit closes it; each element's attributes and every value match a pattern (numbers, path data of `M`, `L`, `Q` and `Z` only, `text-anchor` keywords, ids with the `<figure>--` prefix); every class is one the book's `figures.css` defines; text sits only in `<text>`, with only the four entities the kit's escaping writes. The book's own checker allows links to ids inside a figure; the docs refuse every `href`, because svgkit never writes one. The docs keep their own checker rather than export the book's `src/book/markup.ts`, which also serves isometric fragments: the flat case is small, and its value patterns and class check are stricter than the book's flat rules.

**Layout decision.** One drawing per figure, with no second narrow drawing, as the book's rule and the L12 Lamina row decide. Both figures are drawn 320 units wide, so they show whole on a 390 px phone, and on a narrower column the stage scrolls sideways under the book's hint, with the drawing at its natural size so labels stay at 12 px. Forced-colour rules give the marks system colours.

**Reuse decision.** The `three-layers` figure was dropped (see Out of scope), so nothing reuses `apps/site/figures/`. The two figures take the landing page's look through the shared kit, tokens and `fig-*` classes, not through its helpers, which stay unexported. A figure that redraws the landing page's layers should first move those helpers into a shared module.

**Checks.** Playwright screenshots at a device scale factor of 2, light and dark, 1100 px and 390 px wide, of a built site: the labels render in Manual Code at 12 px, in `--panel-text` (`#2a1e16` light, `#f2e8dc` dark), the model call, the results arrow and the gateway in terracotta, the stop path dashed and muted, and neither figure scrolls at 390 px. Each new test was broken and run, then restored: a stale SVG, a colour in a script, in a drawing and in the standalone style, the alt and caption checks, the element, attribute and entity allowlists, the panel's scroll rule, a stray file and a dropped caption in a full build each made a test fail.
