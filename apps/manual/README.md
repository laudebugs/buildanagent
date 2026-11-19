# `@buildanagent/manual`: the textbook at manual.buildanagent.fyi

The book is a static Astro site with Pagefind search, built from the [book plan](../../docs/plans/build-book.md). This README covers what a contributor needs before changing its look: where the design tokens come from, where each token may be used, how the fonts are made, and which components exist. Every colour, font and size on a page comes from one file, [`docs/design/book-tokens.json`](../../docs/design/book-tokens.json), so a design change starts there and never in the CSS.

## Commands

Run each from the repo root.

| Command | What it does |
| --- | --- |
| `pnpm --filter @buildanagent/manual build` | Builds the site into `apps/manual/dist/` and indexes the chapters with Pagefind |
| `pnpm --filter @buildanagent/manual dev` | Serves the site locally while you edit |
| `pnpm --filter @buildanagent/manual test` | Runs the offline tests, including a full build into a temporary folder |
| `pnpm --filter @buildanagent/manual typecheck` | Type-checks the app's TypeScript with the root `tsc` setup |
| `pnpm --filter @buildanagent/manual check:book` | Syncs Astro's content types and validates each chapter's front matter; T3 adds the book's checks |
| `pnpm --filter @buildanagent/manual tokens` | Regenerates `src/styles/tokens.css` from `book-tokens.json` |

## The tokens come from one JSON file

`scripts/generate-tokens.ts` reads `book-tokens.json` and writes `src/styles/tokens.css`. The generated file puts the light page and light panel values on `:root` and on any `[data-theme="light"]` element. The dark values apply under `prefers-color-scheme: dark`, unless the reader chose light, and on any `[data-theme="dark"]` element. Because the panel tokens follow the same rule, a code or figure panel always matches its page: a light panel framed by `#E4D6C2` in light mode, C1 Ember in dark mode.

Four tests guard the file. First, `test/tokens.test.ts` fails when the committed CSS differs from what the script writes, and when a page or panel token has a value in one mode only. Second, `test/contrast.test.ts` reads every pair from the JSON file's `contrast` lists and recomputes its WCAG ratio from the colours the CSS ships. It fails below 4.5:1 for text and below 3:1 for focus rings, and it fails when a recorded ratio differs from the recomputed one at two decimals. Third, `test/styles.test.ts` fails when a stylesheet or component writes its own hex colour. Fourth, the same test fails when a decorative token colours anything but a border or a background.

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

The site serves Instrument Serif, Literata and Google Sans Code from `public/fonts/`, so a reader's browser fetches nothing from another origin. The files come from [google/fonts](https://github.com/google/fonts) at the commit `fonts/sources.json` records. That file is the one list of the families: each one's upstream folder, its served folder and file names, its licence files and, for Google Sans Code, its neutral name, beside the SHA-256 of each upstream file. Two scripts rebuild them, and both run only when a font changes:

```sh
cd apps/manual
node scripts/fetch-fonts.mjs
uv run --no-project --with fonttools==4.68.0 --with brotli==1.2.1 \
  python -I scripts/subset-fonts.py fonts/sources.json fonts/upstream public/fonts
```

`fetch-fonts.mjs` downloads the upstream files into the gitignored `fonts/upstream/` and refuses a file whose hash differs from the manifest; after a re-pin, `--record` writes the new hashes. `subset-fonts.py` writes WOFF2 subsets with Latin, punctuation, arrows, maths and box-drawing characters, and copies each family's `OFL.txt` beside them. Google Sans Code's `TRADEMARKS.md` keeps the Google mark off modified versions, so its subsets are named Manual Code in their files, their CSS and their name tables. Instrument Serif and Literata keep their names, because neither licence reserves a font name and neither family has a trademark file; the owner chose to keep Literata's name on 2026-11-19. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) records the licences. `test/fonts.test.ts` checks the licence files, and it reads each subset's WOFF2 name table to check the family names and that no Manual Code name record mentions Google.

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

Literata stays variable on both its axes, optical size (7–72) and weight (200–900), because the plan sets no narrower range, though narrowing both axes would roughly halve the body font. In a trial during T2 on a smaller Latin subset, the full axes took 125,796 bytes; limiting weight to 300–700 took 116,524 bytes; limiting weight to 400–700 and optical size to 12–36 took 65,596 bytes. A later todo can narrow the axes if the chapters never use the extremes.

## The components work without JavaScript

Each component in `src/components/` renders a complete page with no script. A few then add behaviour as progressive enhancement, and their buttons render with `hidden` until the script shows them:

- **Layout:** `SiteHeader`, `ChapterHead` (the wide title), `Sidebar` with `Contents`, the article column in `layouts/ChapterLayout.astro`, and `PrevNext`. The columns switch with container queries on the `.layout` element, not with viewport media queries, so the layout follows the width it is given: the sidebar joins at 64rem and the side-note margin at 69rem.
- **Code:** `ListingBlock` with `AnnotationMarker` and `Annotations`; `Tabs` with `TabPanel`, which show every panel under its own heading until `scripts/tabs.ts` builds the tab list; `Replay` with `StepControls`, which `scripts/steps.ts` steps through.
- **Figures:** `FigureFrame` on grid paper, which becomes the isometric stepper when it has steps; `scripts/steps.ts` then shows one step at a time and dims the figure parts of the others.
- **Prose:** `SideNote`, `GlossaryCard`, `GlossaryTerm` (its card opens on hover and focus and stays open while the pointer is on it, and `scripts/glossary.ts` lets Escape close it), `Citation` and `SearchBox`.
- **Theme:** `ThemeToggle`, driven by `public/scripts/theme.js`, which applies a stored choice before the first paint. The button's label names its action, "Switch to light theme" or "Switch to dark theme", and follows the system setting while the reader has stored no choice.

The gallery at `/gallery/` renders every component in both themes, one above the other at full width, so each shows the layout at the width a reader sees it. It stays out of the search index and carries `noindex`. Its citation and glossary samples link to `/sources/` and `/glossary/`, the pages the content model adds. The owner compares the gallery with the reference board after any design change.
