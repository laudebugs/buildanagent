# @buildanagent/docs

The docs for `@buildanagent/gateway` and `@buildanagent/sdk`, built with Astro and Starlight for docs.buildanagent.fyi. The site is private and static: `pnpm --filter @buildanagent/docs build` writes it to `dist/`, and a broken internal link fails the build.

## Write a page that passes the tests

Pages live in `src/content/docs/`, and the explicit sidebar in `astro.config.mjs` names each one, in the order start, concepts, guides, testing, reference. `pnpm --filter @buildanagent/docs test` checks every page against [docs-writing.md](../../docs/guidelines/docs-writing.md):

- The first paragraph has 50 words or fewer, a sentence has 40 or fewer, and a paragraph has 100 or fewer.
- No todo, decision or round id, repository path or banned word appears, and headings are in sentence case.
- Each code block follows a sentence that introduces it. A block of more than five lines comes from a tested example, and a shorter inline block must type-check against the packages.
- Every page except the home page is in the sidebar and ends with a link to the next page.

## Show an example file

A fence with a `file` attribute takes its code from a file under a package's `examples/` folder, so the docs never show code that no longer runs. `region` picks a `// #region` of the file:

````md
```ts file="packages/sdk/examples/order-agent.ts" region="run"
```
````

The build replaces the fence's body with the region and titles the block with the file's name. A path outside an `examples/` folder, or a region that is missing, fails the build.

## Draw a figure with a script, and the build inlines it

A figure is a script that draws an SVG with the book's kit, and a page places the committed SVG with a directive. The build inlines the drawing, so it follows the page's theme in light and dark mode and needs no JavaScript. To add a figure:

1. Write `figures/<id>.ts`, a kebab-case id. Its default export draws the figure with `@buildanagent/manual/figures/svgkit` and returns it; [`figures/run-loop.ts`](figures/run-loop.ts) is the sample. The kit names no colour, only tones and fills that map to the book's `fig-*` classes, and it throws when a label overlaps another, leaves its box or uses a glyph the code font lacks.
2. Add the id to `FIGURE_IDS` in [`figures/registry.ts`](figures/registry.ts).
3. Run `pnpm --filter @buildanagent/docs figures:build`, which writes `figures/<id>.svg` beside each script. Commit both files.
4. Place the figure on its own line, with the caption in the brackets and alt text that states the figure's point:

   ```md
   ::figure[One run, from your input to its stop reason]{id="run-loop" alt="The run calls the model and runs the tools it asks for, then returns the results to the model. When the model answers in text, the run ends done; any other stop reason ends it early."}
   ```

5. State in the page's text every fact the figure shows, as [docs-writing.md](../../docs/guidelines/docs-writing.md#draw-a-diagram-where-a-picture-answers-faster) requires.

Draw a figure 320 units wide or less where you can. At that width it fits a 390 px phone whole. A wider figure keeps its natural size, so its labels stay at 12 px, and its panel scrolls sideways under a hint on a narrower screen. The kit allows up to 520.

The build fails, naming the page and line, when a figure has no alt text, no caption or an id the registry lacks. It also fails when the directive carries any other attribute, when a page shows one figure twice or when the caption holds more than text and inline code. `src/plugins/figure.ts` implements the directive. Starlight's remark-directive parses it, and the plugin runs before Starlight puts unknown directives back as text.

Each committed SVG starts with a `<style>` that embeds the code font and the panel tokens, so the file renders on its own, for example in a pull request. The page inlines the drawing without that standalone `<style>`. `src/plugins/figure-svg.ts` reads the rest of the file tag by tag, repairs nothing and refuses:

- an element other than `g`, `rect`, `path`, `circle` and `text`, such as `script`, `style`, `foreignObject`, `image`, `use` or `a`;
- an attribute other than the kit's, such as an event handler, `href`, `xlink:href`, `style` or `fill`, or a value outside the kit's pattern, such as path data with anything but numbers and `M`, `L`, `Q` and `Z`;
- a class that the book's `figures.css` doesn't define, so every colour comes from a theme token;
- a comment, a CDATA section, a doctype, a processing instruction, an entity other than the four the kit escapes labels with, or markup inside the standalone style;
- an id without the `<id>--` prefix, a root `<svg>` tag that differs from the kit's, or a file drawn for another figure.

`src/styles/figures.css` holds the figure panel, scoped to `.docs-figure`: the book's grid paper, the scrolling stage, the hint, a smaller padding under 40rem and system colours under forced colours. The panel stylesheet loads after the book's `figures.css`, which colours the marks. A change to the kit, the book's `figures.css`, the tokens or the code font makes the SVGs stale, so rerun `figures:build`.

Four test files guard the figures:

- `test/figures.test.ts` fails on a stale SVG, a stray file, a colour outside the tokens, a malformed SVG, or a missing scroll or forced-colour rule.
- `test/figure-svg.test.ts` plants each refused construct in a real committed SVG and requires the check to reject it.
- `test/figure-directive.test.ts` renders the directive through Astro's Markdown processor and requires each broken form to fail.
- `test/figure-build.test.ts` requires each placed figure inline on its page, with its alt text, its caption and the scrolling stage.

## How the docs tests share one build

Three tests read the built site: the figure build test, the favicon test and the API reference test. They share one build, made once per run by `test/built-site.ts`, a Vitest global setup. The build goes into a temporary folder. Separate builds at the same time can fail, because TypeDoc rewrites `src/content/docs/reference/` while each one runs. The setup runs before any test, so even a run of one test file waits for the build. When the build fails, the setup removes its folder and hands the tests the error, so only the tests that read built pages fail, with the build's output in their message.

## The API reference is generated

TypeDoc writes a page for every export of the gateway and the SDK under `src/content/docs/reference/gateway/` and `reference/sdk/` each time Astro builds. The pages are not committed, and the tests skip them. The entry points come from each package's own `exports` map, so the reference matches what users import (`src/api/packages.ts`).

`pnpm check:api-docs` fails when an exported function, class, interface, type alias, variable or enum has no TSDoc, or a `{@link}` doesn't resolve. `pnpm test` runs the same check, so CI enforces it, and a test builds the site and requires a page for every export.

TypeDoc 0.28 reads TypeScript only up to 6.0, so this app pins TypeScript 6.0.3 for it, while the rest of the repo builds with TypeScript 7. Only TypeDoc should use the pin: any tool that resolves `typescript` from this app sees 6.0.3, so the `typecheck` script and the test that type-checks inline blocks resolve the repo root's TypeScript instead.

Each entry file names its module for its import path with an `@module` tag, so the reference shows `@buildanagent/gateway/anthropic`, not the path of a source file.

## The theme is the book's

The docs look like the book because they read the book's design data instead of copying its CSS. Each piece has one home:

| Piece | Where it lives |
| --- | --- |
| Colours, fonts and sizes | `docs/design/book-tokens.json`, shared with the book |
| The tokens file | `src/styles/tokens.css`, generated by `scripts/generate-tokens.ts` through the book's `tokensCss()` (`@buildanagent/manual/design/tokens`) |
| The mapping onto Starlight | `src/styles/starlight.css`, which sets Starlight's `--sl-*` variables to `var()` references to the tokens |
| Code block themes and frame colours | `src/design/theme.ts`, which builds two Expressive Code themes from the book's `panelDark` and `panelLight` colours |
| Fonts | `public/fonts/`, a copy of the book's `apps/manual/public/fonts/` |
| Preloads for the two fonts every page uses | `src/components/Head.astro` |
| Colour pairs Starlight creates | `src/design/pairs.ts` |

Run `pnpm --filter @buildanagent/docs tokens` after changing `book-tokens.json`. It rewrites `tokens.css` and replaces `public/fonts/` with a fresh copy of the book's folder, so a font the book drops leaves the docs too. Starlight loads `tokens.css` before `starlight.css`, and `astro.config.mjs` lists them in that order.

Two parts of the page chrome differ from Starlight's defaults. `src/components/SocialIcons.astro` overrides the header links and puts Docs, Manual and Site before the GitHub icon, in the order of the site's header; on a phone they sit in the menu beside the theme select. Docs carries `aria-current="true"`, not `"page"`, because the link goes to the docs home, which is not always the page the reader is on. `src/chrome.ts` hard-codes the addresses until the shared header source (L12p) replaces that file. The Previous and Next links at the foot of a page are one compact row each, set in `starlight.css`: a rule border, no shadow, a 12px label, a title at the note size and a 44px minimum height.

Five test files guard the theme and the header:

- `test/tokens.test.ts` fails when `tokens.css` differs from what the generator writes, when the docs tokens differ from the book's anywhere between the header comment and the print block, or when `customCss` stops loading the tokens first.
- `test/fonts.test.ts` fails when `public/fonts/` has a file the book lacks, lacks one the book has, or differs from the book's copy by a byte, and when `Head.astro` preloads anything but the Literata and Instrument Serif roman files.
- `test/contrast.test.ts` measures every pair in `pairs.ts` in light and dark, from the colours `tokens.css` ships: 4.5:1 for text and 3:1 for focus rings and the edges that mark an aside, a code marker or an inline marker. It also checks that each Expressive Code theme takes its panel's colours, that every syntax colour reaches 4.5:1 on the panel, that the code markers take the measured panel colours, and that printed pairs reach the same ratios on the light colours and on bare paper. A further test lists the eight pairs that draw text in a background colour (`PRINTED_FILLS`) and requires, for each, a print rule that hides it or repaints it, then measures the printed colour on paper.
- `test/chrome.test.ts` reads `apps/site/src/landing/copy.ts` and fails when `chrome.ts` lists the site links under other labels or in another order, when an address differs, or when the links marked current are not exactly Docs.
- `test/styles.test.ts` fails when a docs stylesheet or component writes a hex colour or loads from another origin, when a `--sl-color-*` variable is set to anything but a colour token, when a decorative token (rules, highlights, panel border and grid) colours text, when inline code in a link stops inheriting the link's colour, and when headings leave the display face at weight 400. To judge a decorative token, the test follows a variable through every custom property that names it, to the declarations that finally paint it, in Starlight's files, Pagefind's `css/ui.css` (which paints the `--pagefind-ui-*` variables) and the docs' own. A chain that ends in anything but a border, a background or a box shadow, a cycle, and a variable nothing reads all count as not decorative. It also fails when the Previous and Next links gain a shadow or lose their rule border, their label and note sizes or their 44px minimum height.

The file `pairs.ts` holds 47 pairs: 34 text pairs and 13 non-text pairs. To add a colour pair, append an entry to `STARLIGHT_PAIRS` in `src/design/pairs.ts` with its role, the two tokens as `page.<key>` or `panel.<key>`, and `text` or `nonText`. The test reads both tokens in each mode, so a failure names the role, the mode and the ratio. The book's own pairs stay in `book-tokens.json`, whose test counts them, so the docs keep theirs apart.

### Printing, code markers and linked code

Starlight's print stylesheet forces light colours by resetting its own variables, but the mapping points those variables back at the tokens, so a printout from a dark-mode reader would keep the dark tokens. The generated `tokens.css` therefore ends with an `@media print` block that sets every token from the `light` and `panelLight` sets. Its selector, `:root:not([data-theme="light"]), [data-theme]`, matches every element the dark blocks match at the same specificity and comes after them, so paper gets dark text on a light page in either mode. A print rule in `starlight.css` also switches code to Expressive Code's light syntax colours: Expressive Code stores each theme's colour in a numbered variable, in the order of the themes list, so `--1` is the light theme. Browsers leave out background colours when printing unless the reader asks for them, so the contrast test also measures each printed text colour on bare white.

Text drawn in a background colour needs more, because bare paper drops its fill. Starlight hides the sidebar (`print:hidden`) and the copy button, and its `print.css` repaints the primary link button and the banner on no fill. Selected text does not print. A line marker's label is the one case the docs handle themselves: a print rule in `starlight.css` draws it in its line's edge colour on no fill.

Marked, inserted and deleted lines take measured colours too. `CODE_STYLE_OVERRIDES.textMarkers` in `theme.ts` puts each marker on the panel's grid shade, which every syntax colour reaches 4.5:1 on, and draws the edge and the diff sign in the panel's amber (marked), olive (inserted) or terracotta (deleted). A line marker's label is the panel background on that edge. Inline code inside a link inherits the link's colour, and the contrast test measures the link colour on the panel.

### What the mapping depends on

The mapping is written for Starlight 0.42.10, the exact version in `package.json`. It sets these variables, and a Starlight release that renames or drops one breaks the look without breaking the build:

- the grey scale `--sl-color-white`, `--sl-color-gray-1` to `-7` and `--sl-color-black`;
- the accent set `--sl-color-accent-low`, `--sl-color-accent` and `--sl-color-accent-high`, and `--sl-color-text`, `-text-accent`, `-text-invert`, `-bg`, `-bg-nav`, `-bg-sidebar`, `-bg-inline-code` and `-bg-accent`;
- the three hairline variables and the low, base and high shades of the blue, green, purple, orange and red families, which carry the asides;
- `--sl-font`, `--sl-font-mono`, `--sl-line-height` and `--sl-content-width`;
- the aside classes `.starlight-aside--note`, `--tip`, `--caution` and `--danger`, with `--sl-color-asides-border` and `--sl-color-asides-text-accent`.

Expressive Code takes `themes` from `codeThemes()` and `styleOverrides` from `CODE_STYLE_OVERRIDES`, whose values name `var(--panel-*)` and `var(--font-code)` so a code block follows the page's theme. It also takes `minSyntaxHighlightingColorContrast: 0`. Expressive Code's default of 5.5 makes it shift any syntax colour that falls short, but the book's panel colours are already measured at 4.5:1 or more, so the shift would only replace measured colours with unmeasured ones. One setting controls the plain panel and the markers, so zero also turns off correction on markers. The theme replaces that correction with the measured colours above, and the contrast test checks them. A test requires the setting.

### The fonts are copies

The docs serve their own copy of the book's six WOFF2 subsets, with each family's `OFL.txt` and the `TRADEMARKS.md` for Manual Code, because the two sites deploy separately and the docs cannot link to the book's files. `fonts.test.ts` keeps the copy identical. Do not edit a file in `public/fonts/`: change the book's and run the `tokens` script. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) covers both copies.

### Upgrading Starlight

Pin Starlight exactly and move one minor release in each pull request, so a visual change has one cause. Read the changelog for renamed or removed `--sl-*` variables and for Expressive Code changes, update the version named in `starlight.css` and in this README, and run `pnpm --filter @buildanagent/docs build`. Then open the built site in light and dark, and look at a page with an aside, a code block, a table and the search dialog. Finally rerun the four tests: they catch a wrong colour, not a missing variable, so the look is the check for that.

## Licence

The docs are CC BY 4.0 ([LICENSE-DOCS](../../LICENSE-DOCS)), and every page's footer says so.
