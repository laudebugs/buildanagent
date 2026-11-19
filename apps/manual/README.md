# `@buildanagent/manual`: the textbook at manual.buildanagent.fyi

The book is a static Astro site with Pagefind search, built from the [book plan](../../docs/plans/build-book.md). This README first covers writing a chapter. The build computes every chapter, figure, listing and table number and checks every citation, glossary tag and analogy, so **a chapter is ready when `check:book` passes, because that check runs the same rules as the build**. The README then covers the book's look: where the design tokens come from, where each token may be used, how the fonts are made, and which components exist. Every colour, font and size on a page comes from one file, [`docs/design/book-tokens.json`](../../docs/design/book-tokens.json), so a design change starts there and never in the CSS.

## Commands

Run each from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm --filter @buildanagent/manual build` | Builds the site into `apps/manual/dist/` and indexes the chapters with Pagefind |
| `pnpm --filter @buildanagent/manual dev` | Serves the site locally while you edit |
| `pnpm --filter @buildanagent/manual test` | Runs the offline tests, including a full build into a temporary folder |
| `pnpm --filter @buildanagent/manual typecheck` | Type-checks the app's TypeScript with the root `tsc` setup |
| `pnpm --filter @buildanagent/manual check:book` | Checks the outline, the three registers and every chapter against the build's own rules, without building |
| `pnpm --filter @buildanagent/manual book:switch-report` | Lists each written chapter's `switchTo` todos and which are done; `test` runs it too, and it never fails |
| `pnpm --filter @buildanagent/manual tokens` | Regenerates `src/styles/tokens.css` from `book-tokens.json` |
| `pnpm --filter @buildanagent/manual anatomy:css` | Regenerates `src/styles/anatomy.css` from the vendored anatomy kit's `iso.css` |
| `pnpm --filter @buildanagent/manual figures:build` | Runs every figure script, the book's and the two fixture books', and writes its SVG or fragment beside it |
| `pnpm --filter @buildanagent/manual figures:audit` | Proves every isometric figure with the anatomy skill's geometry audit and its line check in both themes; needs Chrome |

## The outline places the chapter and gives it its number

Each chapter lives at `src/content/chapters/<slug>.md`, and its page is `/<slug>/`. Its slug must appear in [`src/outline.ts`](src/outline.ts), which lists the two parts and their chapters in reading order. The chapter's number is its position there, counted across both parts, so moving a chapter in the outline renumbers it, its figures, listings and tables, and every reference to them. The contents page lists every chapter in the outline, as plain text until its file exists. Each chapter also needs its fact-check log at `fact-checks/<slug>.md`, and `check:book` fails without it ([`fact-checks/README.md`](fact-checks/README.md)).

The outline also gives each chapter its opening type: `scenario`, `incident`, `question`, `fact`, `code` or `analogy`. `check:book` fails when two consecutive chapters share an opening type, or when one type opens more than a quarter of the chapters, rounded up.

## The front matter is strict, and the chapter ends with exercises

The front matter takes exactly these six keys, and any other key, a misspelt one included, fails the check:

```yaml
---
title: "Use the least autonomy that works: a call, a workflow, then a loop"
summary: One or two sentences for the page's description.
opening: scenario
sources: [anthropic-building-effective-agents]
glossary: [agent, agent-loop, workflow]
switchTo: [B11]
---
```

- `opening` must be the type the outline plans for this chapter. To change it, change the outline, which reruns the rotation check.
- `sources` lists the register ids the chapter relies on, in the order its source list shows them; it needs at least one.
- `glossary` lists the glossary ids whose first use the chapter links; it may be empty.
- `switchTo` lists the todos whose code will replace the chapter's `verify/` listings; it may be empty.

The chapter's last `##` section is `## Exercises`, and it holds a list. The layout adds the chapter's sources after it, so the chapter has no sources section of its own.

## Citations point at the source register

Cite a source with `[@id]`, or several with `[@a; @b]`. The id must be in [`src/data/sources.json`](src/data/sources.json) and in the chapter's `sources`. The page shows each citation as the source's position in `sources`, such as `[1]`, linked to `/sources/#<id>`.

Each register entry names the fact-check log that verified it:

```json
{
  "id": "anthropic-building-effective-agents",
  "title": "Building effective agents",
  "publisher": "Anthropic",
  "url": "https://www.anthropic.com/engineering/building-effective-agents",
  "kind": "post",
  "asOf": "November 2026",
  "verifiedIn": "docs/research/agent/fact-check.md"
}
```

`kind` is `docs`, `repo`, `paper`, `spec` or `post`, and an optional `version` holds a tag or commit. `verifiedIn` is a path from the repository root, and it must name a fact-check log. Four kinds count: a `fact-check*.md` file under `docs/research/` or in `docs/plans/reviews/`, a `docs/reference/<sdk>/fact-check.md`, and a chapter's own log in `apps/manual/fact-checks/`. That log must contain the URL, whether as an inline link, a bare URL or a reference-style definition. To cite a new source, first add its row to the chapter's fact-check log, `apps/manual/fact-checks/<slug>.md`, then add the entry with that log as `verifiedIn`. Set `"secondary": true` when the check rests on a search summary or a secondary write-up; the sources page then says so.

## References name an id, and the build writes the number

Mark a numbered block with a container directive, its caption in brackets and its id after `#`:

```markdown
:::figure[The loop runs until a stop condition holds]{#tool-call-round-trip}
::svg{alt="What the drawing shows"}
:::

:::table[How each SDK stops the loop]{#stop-defaults}
| SDK | Default cap |
| --- | --- |
:::

:::listing[One model call]{#one-call}
…a fenced code block…
:::
```

Ids are kebab-case and unique across the book for each kind. A table must hold a table and a `:::listing` a code block, and every block needs a caption. Refer to a block with `[[fig:tool-call-round-trip]]`, `[[tbl:stop-defaults]]` or `[[lst:one-call]]`, and to a chapter with `[[ch:tools]]`. The build replaces each reference with a numbered link such as "Figure 3.2"; a reference to a planned chapter shows its number without a link. An unknown id or a malformed reference fails with the file and line. Inside code, both reference and citation syntax stay as written. A `:::listing` with its code in the chapter suits a snippet that runs nowhere; code a reader should trust comes from a real file through `::listing`, described next. A figure holds its generated drawing, as [the figures section](#a-figure-is-a-script-that-draws-an-svg-and-the-build-inlines-it) describes.

## A listing shows a region of a real file

A listing shows only code that CI type-checks and runs, because the build cuts it from a real file instead of taking it from the chapter. The chapter names the file and a region in it with a leaf directive, written with two colons:

```markdown
::listing[One model call]{#one-call file="verify/vercel-ai-sdk/examples/01-generate-text.ts" region="call"}
```

The file marks the region with comments on their own lines, which change nothing when the example runs:

```ts
// #region call
const { model, requests } = scripted(["Hello from the mock."]);
const result = await generateText({ model, instructions: "You are terse.", prompt: "Say hello." });
// #endregion
```

The build cuts the lines between the markers, drops any markers of regions nested inside, removes the indentation the lines share and highlights them with Shiki. The caption line shows the number, such as "Listing 1.1", then the caption you wrote, the file's path, the line range and the pinned version of the harness's main package, such as `ai@7.0.162` as of November 2026. Each code line also shows its own number in the file. Without `region`, the listing shows the whole file without its markers. References use the same id as any listing, `[[lst:one-call]]`.

Region names are kebab-case and unique in their file, and an `// #endregion` may repeat its name (`// #endregion call`). The build finds markers line by line without parsing the code, so a line inside a template literal or a block comment that starts with `// #region` also counts as a marker.

The pin comes from the harness's own `package.json`. [`src/data/harnesses.json`](src/data/harnesses.json) names each `verify/` harness's main package, such as `ai` for `verify/vercel-ai-sdk`. The weekly SDK-update job rewrites those pins, so each caption follows the harness's current pin; prose that names a version still says "as of <month year>".

The book loads every listing before it renders a page, so `check:book` and the build fail on the same problems, each named with the chapter's file and the directive's line. A listing fails when:

- its file is missing, its path is not a plain path from the repository root (it is absolute, or holds `./`, `..` or `//`), or the file resolves through a symbolic link to a place outside the repository;
- the file is not TypeScript (`.ts`, `.tsx`, `.mts` or `.cts`), or no workspace package's `typecheck` covers it, as the next paragraph explains;
- the file sits in no harness that `harnesses.json` lists, or the harness's `package.json` lacks the main package or pins it as a range instead of an exact version;
- the region is missing, empty or malformed (an unnamed or repeated `#region`, an `#endregion` without its `#region` or naming another one, a `#region` never closed), and such a message also names the file's own line;
- the directive lacks a caption or `file`, or takes an attribute other than `id`, `file` and `region`.

A file counts as covered when `pnpm typecheck` would check it. Its nearest `package.json` must match a glob in `pnpm-workspace.yaml` that no `!` glob cancels, and one `tsc -p <config>` in that package's `typecheck` script must hold the file in its program. To decide, the check runs the manual's own `tsc`, from its exact `typescript` devDependency, as `tsc -p <config> --listFilesOnly`. TypeScript therefore applies `extends`, `files`, `include` and `exclude` itself, and a file that an included example imports also counts.

Five of these rules are our choices, not BK9's: an exact pin, TypeScript files only, paths from the repository root only, a file inside a harness that `harnesses.json` lists, and no attribute but `id`, `file` and `region`, which catches a misspelt `region`. Because of the harness rule, a listing from `packages/` fails as "in no harness", so the todo that moves a chapter's listings to our own packages must widen that rule first.

To add a listing, mark the region in the example, run that harness's `pnpm test` to confirm its results do not change, then write the directive and run `check:book`. Renaming or deleting a region breaks every chapter that lists it, and `check:book` names each one. When a chapter's `switchTo` todos are all done, `book:switch-report` says the chapter is ready to move its listings to our own packages.

## A figure is a script that draws an SVG, and the build inlines it

Each flat figure is a TypeScript script, and the SVG it writes is committed beside it. A test redraws every figure and fails when a committed SVG differs from what its script draws now, so a figure cannot drift from its script. The build inlines the SVG instead of linking it, so the figure takes the page's colours in both themes and needs no JavaScript. To add a figure to a chapter:

1. Write `figures/<chapter slug>/<figure id>.ts`. Its default export draws the figure with [`figures/lib/svgkit.ts`](figures/lib/svgkit.ts) and returns it; [`figures/call-workflow-loop/who-decides.ts`](figures/call-workflow-loop/who-decides.ts) is the sample.
2. Run `pnpm --filter @buildanagent/manual figures:build`, which writes `<figure id>.svg` beside every script. Commit both files.
3. Place the figure in the chapter with its caption, its id and its alt text:

   ```markdown
   :::figure[A call, a workflow and a loop differ in who decides the next step]{#who-decides}
   ::svg{alt="Three columns of boxes joined by arrows: a call, a workflow and a loop."}
   :::
   ```

The kit throws while drawing, naming the figure, when a mark breaks one of its rules:

- A label uses a character that the embedded code font lacks, such as `↺`; the message names the character and its code point. The font is the upright Manual Code subset in `public/fonts/`, so the check matches what readers see.
- The figure is wider than 520 units, the widest a chapter's figure panel shows whole at desktop widths. This limit is our choice.
- A mark leaves the canvas, a label is wider or taller than its box leaves room for, two labels overlap, or a line or curve crosses a label.
- `connect()` joins two boxes that overlap or share no band across the gap between them, or an arrow is shorter than twice its head.
- An id does not start with `<figure id>--`. Inlined figures share the page's id space, and kebab-case ids never hold `--`, so two figures cannot clash.

The figure colours its marks with the `fig-*` classes in `src/styles/components.css`, never with colour attributes. The kit measures labels at those classes' font sizes. Each committed SVG also embeds the code font as a data URI and the panel tokens of both modes, so the file renders on its own, for example in a pull request. The build drops that `<style>` element when it inlines the figure, because the page serves the same font and tokens and its content security policy allows no inline style. A change to the kit, the `fig-*` rules, the tokens or the code font therefore makes the figures stale: rerun `figures:build`. The font makes each committed SVG about 61 KB, but no page carries it.

A page shows a figure at its natural size, so its labels stay at 12 px, the approved phone label size, on every screen (BK11). Where the panel is narrower than the figure, as on a phone, the drawing keeps its size and the panel's drawing area, the stage, scrolls sideways. A figure never splits into a second drawing, and none of this needs JavaScript. The note "Scroll sideways to see the whole figure →" shows under the drawing exactly when the stage overflows, because the note's animation runs on the stage's scroll timeline, which stays inactive while nothing scrolls. A browser without scroll-driven animations never shows the note, but the stage still scrolls. The stage takes keyboard focus on every screen, since CSS cannot make it focusable only while it overflows, and the figure's caption names it for screen readers.

The inlined drawing may hold only what the kit writes: `g`, `rect`, `path`, `circle` and `text` elements, the kit's attributes, and links to ids inside the figure. A script, an image, a `foreignObject`, a second `<style>`, an event handler or a link elsewhere fails the build, so a hand-edited SVG cannot put script or outside content on a page.

The build and `check:book` fail, with the chapter's file and line, when a figure lacks its alt text or its caption, or holds anything besides one `::svg` or `::viewer`. They also fail when its SVG is missing or was drawn for another figure. Figure numbers come from the outline, like every other block's.

### An analogy illustration names its register entry

An analogy illustration is a figure marked with the analogy it draws (BK22):

```markdown
:::figure[A kitchen ticket rail: the cook works one ticket at a time]{#ticket-rail analogy="kitchen-ticket-rail"}
::svg{alt="Three order tickets hang from a rail…"}
:::
```

The register entry must name this figure as its `illustration`, and the caption must start with the analogy's name. The page then adds a link from the caption to a note under it that says where the analogy breaks, taken from the entry's `breaks`. The build fails when the entry is missing or names another figure, when the caption starts with anything else, and when a figure that an entry names as its illustration lacks the mark. The sample is `test/fixtures/book/figures/first/ticket-rail.ts`. The site fixture places the same drawing, so the build test checks it on a built page. Both fixtures register the analogy in their own `analogies.json`. The analogy belongs to Chapter 1, whose todo adds it to the book's register when it writes the chapter.

## An isometric figure is drawn with the anatomy skill and proved by its audits

A few chapters get an isometric centerpiece, an interactive drawing of a small machine (BK10). Each is a script like a flat figure, but it draws with the anatomy skill vendored in [`.agents/skills/anatomy/`](../../.agents/skills/anatomy/SKILL.md), pinned at upstream commit `1482e84` ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)). Read the skill's `SKILL.md` and `references/craft.md` before designing one. To add an isometric figure to a chapter:

1. Write `figures/<chapter slug>/<figure id>.ts`. Its default export builds the camera with the kit's `fitProjection`, makes the audit's `recorder`, draws every part through `IsoParts` from [`figures/lib/isokit.ts`](figures/lib/isokit.ts), and returns an `IsoFigure` with the card's title, hint and readout. `IsoParts` draws each slab or cylinder with the kit and records the same shape for the audit, so the audit checks what the page shows. A part whose name starts with `stand.` is the ground, and every other part must rest on one that leads to it. The fixture book's [`loop-bench.ts`](test/fixtures/book/figures/first/loop-bench.ts) is the sample centerpiece.
2. Run `figures:build`, which writes `<figure id>.html`, the kit's card around the drawing, beside the script. Commit both files; the staleness test covers fragments as it covers SVGs.
3. Run `figures:audit`. For every isometric figure it runs the skill's geometry audit, which must print `audit passed`, then the skill's `scripts/lines.mjs` on a light and a dark check page, which must each print `line ends: 0`. The line check needs Chrome; set `CHROME_PATH` if the skill's search does not find it. The book's CI job runs the same command.
4. Place the figure with `::viewer` where a flat figure has `::svg`:

   ```markdown
   :::figure[The agent loop's bench: context, model and tool, each with a lamp]{#loop-bench}
   ::viewer{alt="An isometric bench with three stations: …"}
   :::
   ```

The build inlines the fragment in the chapter, with no iframe, on the same scrolling stage as a flat figure, so the drawing keeps its natural size and its labels never shrink under 12 px. The alt text goes first, as a visually hidden paragraph, and the drawing itself is hidden from screen readers. The card's top-left corner shows the figure's number. The first paint is complete: the static page already shows the first step's part lit and its readout. Where parts carry `data-iso-step` and `data-iso-readout` attributes (pass them as `attributes` to `IsoParts`), [`src/scripts/iso-figures.ts`](src/scripts/iso-figures.ts) walks through the steps, moves the lit part and the readout, and adds Play and Next buttons. It plays only while the card is on screen and starts paused when the reader prefers reduced motion. Without JavaScript the reader sees the first step and no buttons.

The fragment may hold only what the kit writes for a card and its drawing: `figure`, `div`, `span`, `svg`, `g`, `path`, `circle` and `text`, the kit's attributes with values the kit writes, and ids that start with `<figure id>--`. Its `data-*` attributes come from a closed list, each with the values it may take: the kit's tones, shades, flags and card corners, the part names `isokit.ts` writes, and the step number and readout text that `iso-figures.ts` reads. A script, a style element or attribute, an event handler, a link, a `url()`, an entity the kit never writes, in text or in a value, an image, an iframe, a second drawing, or a self-closing tag outside the drawing fails the build. Flat SVGs and fragments go through one checker, `src/book/markup.ts`, and each kind adds its own allowlist. Two kit helpers write inline styles, `fadeLineSvg` and pulsing dots, so a book figure cannot use them; the page's content security policy allows no inline style. A chapter page shows each figure once, and figure ids are unique across the book, so a chapter's ids need no prefix. The component gallery shows the fixture's centerpiece once per theme, and there each copy's ids take the theme as a prefix.

[`src/styles/anatomy.css`](src/styles/anatomy.css) gives the drawing its colours. `anatomy:css` generates it from the kit's `iso.css`: it keeps the kit's rules for parts, drops the kit's grey palettes, card and phone layout, and maps every `--anatomy-*` colour to the panel tokens of each mode, as [`src/design/anatomy-css.ts`](src/design/anatomy-css.ts) lists. `hi` is the panel text and `mid` the panel comment colour. The one lit part is outlined in the panel's terracotta and its faces are tinted with it, so even a small part reads as the lit one. The side shades and faint lines are `color-mix()` blends of panel tokens. The tops lighten toward the page colour, our choice: the page is lighter than the panel in both modes, while the panel's lighter tokens are text colours or, in dark mode, the decorative grid and border. No hex value leaves `tokens.css`. A test fails when the file is stale, so rerun `anatomy:css` after updating the vendored skill.

An isometric analogy illustration is an isometric figure with the analogy mark, checked against the register like a flat one; the fixture book's [`tally-counter.ts`](test/fixtures/book/figures/first/tally-counter.ts) is the sample. The site fixture re-exports both samples, so the build test sees them on a built page, and `figures:audit` proves each drawing once.

## Glossary terms link on their first use

[`src/data/glossary.json`](src/data/glossary.json) holds each term's definition in plain text, its spellings (`match`, the term itself when omitted) and at least one register source. A chapter tags a term by listing its id in `glossary`. The build links the term's first use to `/glossary/#<id>` and gives screen readers the definition through `aria-describedby`; later uses stay plain. Terms match any case and a plural, while an abbreviation (`"kind": "abbr"`, with its `expansion`) matches its exact case. A tagged id that the glossary lacks fails the check, and so does a tagged term that the chapter's text never uses.

## Each analogy explains one concept, across the whole book

Analogies are optional (BK22). A chapter that uses one first registers it in [`src/content/analogies.json`](src/content/analogies.json):

```json
{
  "id": "kitchen-ticket-rail",
  "concept": "agent loop",
  "analogy": "a kitchen ticket rail",
  "chapter": "call-workflow-loop",
  "illustration": "ticket-rail",
  "breaks": "A cook remembers yesterday's orders; a model sees only what the transcript carries."
}
```

The chapter then marks each use with `:analogy[the ticket rail]{#kitchen-ticket-rail}`. A later chapter refers back to the same analogy by the same id; it may not name an analogy from a later chapter. `illustration` is the id of a figure in that chapter, or `null`; that figure carries the analogy's mark, as the figures section describes. The check compares analogies and concepts without case, punctuation or a leading article. It fails on the same analogy listed twice, on an analogy that explains a second concept, on a concept given a second analogy, and on a chapter that names an id the register lacks. It cannot tell that two different phrasings describe nearly the same image, such as a kitchen ticket rail and a waiter's order spike, so reviewers catch near-duplicates when they vet a chapter's analogies.

## The content model lives in `src/book/`

The outline checks, the three registers, the index that numbers blocks and the listing resolver live in `src/book/`, and the Markdown plugins that use them in `src/markdown/`. `check:book` loads the outline and the three registers, then renders every chapter through the build's own plugins and prints each problem as `file:line: message`. The tests run the same plugins on the fixture book in `test/fixtures/book/`, with one failing fixture for each rule `check:book` applies. That directory is also its own repository root, holding a workspace of one harness, `verify/demo-sdk`, whose example the second chapter lists. When the content model, a plugin, the outline, a register, another chapter's numbered blocks, a body's line offset, a listed file or its harness's pin change, `astro.config.mjs` clears Astro's content cache, so no chapter keeps stale numbers, links, listings or error lines.

The build reads chapters from `src/content/chapters/` and their logs from `fact-checks/`, unless `BOOK_FIXTURE_DIR` names a directory that holds `chapters/`, `fact-checks/`, `figures/` and `analogies.json`; the build then reads all four from there. Only the tests set it, pointing it at `test/fixtures/site/` because the book has no chapter of its own yet, and any build that uses it says so on stderr. The book's `figures/` therefore holds only the book's own figures; the site fixture's scripts draw Chapter 1's figure, the ticket rail and the two isometric samples by importing their scripts. The citation, glossary and figure plugins, the strict schema, the text splitter, the figure kit and its staleness check are adapted from the owner's garment engineering textbook and are licensed Apache-2.0 only ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md)).

## The tokens come from one JSON file

`scripts/generate-tokens.ts` reads `book-tokens.json` and writes `src/styles/tokens.css`. The generated file puts the light page and light panel values on `:root` and on any `[data-theme="light"]` element. The dark values apply under `prefers-color-scheme: dark`, unless the reader chose light, and on any `[data-theme="dark"]` element. Because the panel tokens follow the same rule, a code or figure panel always matches its page: a light panel framed by `#E4D6C2` in light mode, C1 Ember in dark mode.

Four checks in three test files guard the file. First, `test/tokens.test.ts` fails when the committed CSS differs from what the script writes, and when a page or panel token has a value in one mode only. Second, `test/contrast.test.ts` reads every pair from the JSON file's `contrast` lists and recomputes its WCAG ratio from the colours the CSS ships. It fails below 4.5:1 for text and below 3:1 for focus rings, and it fails when a recorded ratio differs from the recomputed one at two decimals. Third, `test/styles.test.ts` fails when a stylesheet or component writes its own hex colour. Fourth, the same file fails when a decorative token colours anything but a border or a background.

To change a token, edit the JSON file, update its recorded ratio if a colour changed, then run `pnpm --filter @buildanagent/manual tokens`.

## Where each token may be used

| Custom property | Use it for | Never use it for |
| --- | --- | --- |
| `--color-text`, `--color-text-soft`, `--color-text-muted` | Body text; ledes and side notes; labels, numbers and control borders | Text on a panel |
| `--color-accent` | Labels, figure numbers and the focus ring | Body text |
| `--color-link` | Links, which keep their underline in both modes because neither link colour is 3:1 apart from body text | Anything that is not a link |
| `--color-rule` | Dividers and card borders | Text, focus rings or a line that carries meaning |
| `--panel-text`, `--panel-comment` | Code and figure text on a panel; comments, line numbers and panel labels | Text on the page |
| `--panel-amber`, `--panel-olive`, `--panel-terracotta` | Keywords, strings and highlights on a panel; the terracotta bar that marks a highlighted line | Text on the page |
| `--panel-grid`, `--panel-border` | The grid paper behind a figure and the panel's edge | Text, focus rings or a line that carries meaning |
| `--font-display`, `--font-body`, `--font-code` | Headings and chapter links; body text and notes; listings, labels and figure captions | |
| `--size-*`, `--line-height-body` | Type sizes, which scale from the phone value at 360 px to the desktop value at 1280 px | |
| `--page-width`, `--measure`, `--side-note-width`, `--gutter` | Direction C's widths: the page, the article column, the side-note margin and the side gutter | |

A figure colours its parts with the `fig-*` classes in `src/styles/components.css`, not with `fill` and `stroke` attributes, so every figure colour stays in a stylesheet that the style test reads.

## The fonts are self-hosted subsets

The site serves Instrument Serif, Literata and Google Sans Code from `public/fonts/`, so a reader's browser fetches nothing from another origin. The files come from [google/fonts](https://github.com/google/fonts) at the commit `fonts/sources.json` records. That file is the one list of the families. For each family it records the upstream folder and the SHA-256 of each upstream file, the served folder and file names, the licence files and, for Google Sans Code, the neutral name. Two scripts rebuild the served files, and both run only when a font changes:

```sh
cd apps/manual
node scripts/fetch-fonts.mjs
uv run --no-project --with fonttools==4.68.0 --with brotli==1.2.1 \
  python -I scripts/subset-fonts.py fonts/sources.json fonts/upstream public/fonts
```

`fetch-fonts.mjs` downloads the upstream files into the gitignored `fonts/upstream/` and refuses a file whose hash differs from the manifest; after a re-pin, `--record` writes the new hashes. `subset-fonts.py` writes WOFF2 subsets with Latin, punctuation, arrows, maths and box-drawing characters, and copies each family's `OFL.txt` beside them.

Google Sans Code's `TRADEMARKS.md` keeps the Google mark off modified versions, so its subsets are named Manual Code in their files, their CSS and their name tables. Instrument Serif and Literata keep their names, because neither licence reserves a font name and neither family has a trademark file; the owner chose to keep Literata's name on 2026-11-19. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) records the licences. `test/fonts.test.ts` checks the licence files, and it reads each subset's WOFF2 name table to check the family names and that no Manual Code name record mentions Google.

### What a page downloads

The subsets, as committed, weigh:

| File | Bytes | Preloaded |
| --- | --- | --- |
| `instrument-serif/instrument-serif-regular.woff2` | 23,024 | Yes |
| `instrument-serif/instrument-serif-italic.woff2` | 24,128 | No |
| `literata/literata-roman.woff2` | 145,056 | Yes |
| `literata/literata-italic.woff2` | 149,452 | No |
| `manual-code/manual-code-roman.woff2` | 42,228 | No |
| `manual-code/manual-code-italic.woff2` | 46,048 | No |

`layouts/BaseLayout.astro` preloads the two files every page paints first: the title in Instrument Serif and the body in Literata's roman, 168 KB together. The other four load when a page first uses them.

Literata stays variable on both its axes, optical size (7–72) and weight (200–900), because the plan sets no narrower range, though narrowing both axes would roughly halve the body font. T2 measured the trade on a smaller Latin subset: the full axes took 125,796 bytes; limiting weight to 300–700 took 116,524 bytes; limiting weight to 400–700 and optical size to 12–36 took 65,596 bytes. A later todo can narrow the axes if the chapters never use the extremes.

## The components work without JavaScript

Each component in `src/components/` renders its full content with no script. A few then add behaviour as progressive enhancement, and their buttons render with `hidden` until the script shows them:

- **Layout:** `SiteHeader`, `ChapterHead` (the wide title), `Sidebar` with `Contents`, the article column in `layouts/ChapterLayout.astro`, and `PrevNext`. The columns switch with container queries on the `.layout` element, not with viewport media queries, so the layout follows the width it is given: the sidebar joins at 64rem and the side-note margin at 69rem.
- **Code:** `ListingBlock` with `AnnotationMarker` and `Annotations`; `Tabs` with `TabPanel`, which show every panel under its own heading until `scripts/tabs.ts` builds the tab list; `Replay` with `StepControls`, which `scripts/steps.ts` steps through.
- **Figures:** `FigureFrame` on grid paper, which becomes the isometric stepper when it has steps; `scripts/steps.ts` then shows one step at a time and dims the figure parts of the others. `GeneratedFigure` puts a figure from `figures/` in a `FigureFrame`, inlined as a chapter's is; the gallery uses it.
- **Prose:** `SideNote`, `GlossaryCard`, `GlossaryTerm` (its card opens on hover and focus and stays open while the pointer is on it, and `scripts/glossary.ts` lets Escape close it), `Citation` and `SearchBox`.
- **Theme:** `ThemeToggle`, driven by `public/scripts/theme.js`, which applies a stored choice before the first paint. The button's label names its action, "Switch to light theme" or "Switch to dark theme", and follows the system setting while the reader has stored no choice.

The gallery at `/gallery/` renders every component in both themes, one above the other at full width, so each shows the layout at the width a reader sees it. It stays out of the search index and carries `noindex`. Its citation and glossary samples link to the `/sources/` and `/glossary/` pages. The owner compares the gallery with the reference board after any design change.
