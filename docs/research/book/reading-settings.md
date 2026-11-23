# Reading settings, part 1: four pairings and five sizes reach the page before its first paint

The owner approved design S1 on 2026-11-23: a reader of the manual chooses one of four typeface pairings and one of five text sizes, saved on the device. Before the settings panel can exist, the book needs the pairings' fonts, a way to apply a stored choice before the first paint, and CSS that changes the type without loading fonts the reader did not choose. This report covers [T69](../../todos/done/T69-manual-reading-fonts-and-early-script.md): what changed, what each pairing costs in bytes, which px sizes became rem, and what the browser checks measured. **In every pairing a page requests only the chosen pairing's fonts and the code face. The choice is on `<html>` in the first animation frame. At 150% on a 390 px phone, no checked page scrolls sideways and the header stays one 52 px row.**

## Four pairings come from google/fonts at the book's pinned commit

The four new families come from google/fonts at commit `9bbbcda6f8aa91198223c77345d548af4b61940d`, the commit the book's other fonts already use. `fonts/sources.json` now lists them, and `fetch-fonts.mjs --record` wrote the SHA-256 of each new upstream file. The ten existing entries did not change. Each download also matches the git blob id that the commit's tree records for its path, and the three existing families' subsets rebuild byte for byte.

| Pairing | Headings | Body | Upstream folder and files |
| --- | --- | --- | --- |
| Book (default) | Instrument Serif 400 | Literata | unchanged |
| Readable | Atkinson Hyperlegible 700 | Atkinson Hyperlegible | `ofl/atkinsonhyperlegible/`: static Regular, Italic and Bold |
| Sans | Space Grotesk 600 | Inter | `ofl/spacegrotesk/`: variable roman, weight 300–700; `ofl/inter/`: variable roman and italic |
| Slab | Bitter 700 | Bitter | `ofl/bitter/`: variable roman and italic |

The owner's mock names "Atkinson Hyperlegible", so the book uses `ofl/atkinsonhyperlegible/`, the 2020 static family, not `ofl/atkinsonhyperlegiblenext/`. The heading weights are the mock's: 700 for Atkinson Hyperlegible and Bitter, 600 for Space Grotesk. A new custom property, `--weight-display`, carries the weight to every element set in the display face: 400 for Book, as before.

The body text uses weight 400, 600 for table headers, bold for `strong`, and italic. Atkinson Hyperlegible ships Bold but no Bold Italic file, and the book leaves Bold Italic out. A bold italic word therefore gets a slanted bold that the browser draws. Space Grotesk has no italic at all, so an italic word in a Sans heading also gets a slant the browser draws. Inter and Bitter are variable on weight and ship italics, so they need nothing drawn.

### What each pairing downloads

The subsets keep the book's Latin range, written by the unchanged `subset-fonts.py` with fontTools 4.68.0:

| Family | Files | Bytes |
| --- | --- | --- |
| Atkinson Hyperlegible | regular 19,464, italic 20,788, bold 19,976 | 60,228 |
| Space Grotesk | roman 29,964 | 29,964 |
| Inter | roman 90,144, italic 99,840 | 189,984 |
| Bitter | roman 39,980, italic 39,164 | 79,144 |
| **The four new families** | 8 files | **359,320** |

What a reader fetches first, the preloaded upright files, is 168,080 bytes for Book (unchanged), 39,440 for Readable, 120,108 for Sans and 39,980 for Slab. Italics load when a page uses them. Inter's variable files keep their optical-size axis; at 90 to 100 KB each they weigh less than Literata's, so the book does not narrow them.

### The licences: all four are OFL 1.1, and only Bitter reserves a name

Each family's `OFL.txt` at the pinned commit carries the standard SIL Open Font License 1.1 text, identical below its header to Literata's. Each copy ships unchanged beside its subsets.

- **Atkinson Hyperlegible:** "Copyright 2020 Braille Institute of America, Inc." No Reserved Font Name.
- **Space Grotesk:** "Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)". No Reserved Font Name.
- **Inter:** "Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)". No Reserved Font Name. Its name table says 2016 and carries the notice "Inter UI and Inter is a trademark of rsms."
- **Bitter:** "Copyright 2011 The Bitter Project Authors (https://github.com/solmatas/BitterPro) with Reserved Font Name "Bitter Pro"." Its name table carries "Bitter is a trademark of Sol Matas (www.solmatas.com)."

None of the four folders holds a `TRADEMARKS.md`. Bitter's Reserved Font Name is "Bitter Pro", which the served family, Bitter, does not use. "BitterPro" appears in the subsets only inside the copyright notice's URL, which the OFL requires a modified version to keep, so the book serves Bitter under its own name. Inter and Bitter keep their names in the same way the owner chose to keep Literata's on 2026-11-19, despite their trademark notices. As of 2026-11-23 the owner has not ruled on these two names, and that decision is open.

## A blocking script puts the choice on `<html>` before the first paint

`public/scripts/reading-settings.js` is a classic script that `BaseLayout` loads in `<head>`, right after `theme.js` and before the stylesheet. Like `theme.js`, it is a same-origin file served as-is, so the content security policy allows it by path and no inline script is added.

The script reads two localStorage keys, `manual-reading-font` and `manual-reading-size`, and sets two attributes on `<html>`:

- `data-reading-font`: `readable`, `sans` or `slab`. Book, the default, removes the attribute.
- `data-reading-size`: `90`, `115`, `130` or `150`. The default, 100, removes the attribute.

Only those exact strings count, and anything else, such as `Sans`, `115%` or `__proto__`, leaves the default. Every storage call sits in try/catch, and so does the rest of the script's start-up, after it has put its API on `window`. The script then adds a preload link for the chosen pairing's upright files. The layout's two static preloads for Book had to go, because they would have fetched Instrument Serif and Literata in every pairing.

A blocking script cannot be a module, so it cannot export functions. The script therefore leaves its lists and functions, frozen, on `window.manualReadingSettings`, which it sets before it reads anything: the two keys, `PAIRINGS` with each pairing's preload files, `SIZES`, `readFont`, `readSize`, `read(storage)` and `apply(root, settings)`. Part 2's settings panel will use them, so the allow-lists live in one file. The script uses optional chaining and `??`, so it runs from Safari 13.1, Chrome 80 and Firefox 74, and it avoids `Object.hasOwn` (Safari 15.4), `at()`, `structuredClone`, `replaceAll` and logical assignment, so a stored choice still applies there. In an older browser the script is a syntax error: the page shows Book at 100% and `window.manualReadingSettings` stays undefined, so the panel must check for it. `public/scripts/reading.js`, which records a reader's place, could not hold this code: it is a deferred module, and the choice must be on `<html>` before the first paint.

## The CSS names a pairing's fonts only under that pairing's attribute

The new `font.reading` block of `docs/design/book-tokens.json` lists the pairings, their faces, heading weights and the size steps. `scripts/generate-tokens.ts` writes `src/styles/reading.css` from it, beside `tokens.css`, and a test fails when the file is stale. The file holds an `@font-face` rule for each new face and one rule per pairing, `:root[data-reading-font="sans"]` for example, that sets `--font-display`, `--font-body` and `--weight-display`. A browser downloads a face only once an element uses its family, so the unused `@font-face` rules cost nothing. Each pairing's fallback stack is a system serif (Slab) or sans (Readable, Sans).

A size step sets the root `font-size` to its percent, which every rem length follows, and sets `--reading-scale`. The docs site generates its own `tokens.css` with the same generator, so `reading.css` stays a separate file that the docs never load. The docs site's font copy now takes only the folders of its display, body and code fonts, so the four new families stay out of `apps/docs/public/fonts/`.

## The px audit found five text sizes; four became rem and the header stays fixed

Text sized in px would ignore the reader's size. Every `font-size` in `src/styles/` and every px length beside text was checked:

| Rule | Was | Now | Why |
| --- | --- | --- | --- |
| `.notes-pop__quote` | 13px | 0.8125rem | the popover's quote is text |
| `.notes-pop__note` | 15.5px | 0.96875rem | the note is text |
| `.notes-pop__field` | 15.5px | 0.96875rem | the field is text; under a finger it still takes `max(1rem, …)` |
| `.notes-pop__actions` | 12px | 0.75rem | the action labels are text |
| `.fig-text`, `.fig-text--heading` | 12px, 14px | unchanged | an SVG's text scales with its SVG, and `svgkit.ts` measures labels at these sizes |

The four conversions give the same computed sizes at 100%. Every other text size already uses a rem token, an em or a rem clamp, and the public scripts set no font size. Pagefind's own stylesheet on the search page is unchanged.

The header is the exception by design. At 150% its rem-sized wordmark and buttons would no longer fit one row on a phone, so every rem length in the header is divided by `--reading-scale`, and the header keeps its default size at every text size. The wordmark's size is a clamp of rem and viewport parts, so only its rem parts are divided. The search field's height and padding are divided too; only its text follows the reader's size, so that it keeps 16px under a finger. On a 1280 px desktop `check:reading` finds the header 56 px high at every size, its three buttons and the search field 36 px high and the wordmark 24.89 px at 1024 px wide at every size.

One overflow turned up at 150%. The gallery's sample search box grew wider than a 390 px screen, because a form field cannot shrink below its own width. The search box now caps itself at its column's width and lets its field shrink. Where the box fits, nothing changes.

The default look did not change. Screenshots of the model gateway chapter in Book, taken from a build of the commit before this change and from this branch, are byte-identical at 1280 × 900 and on the iPhone 14 profile, and no pixel differs. The report therefore commits only the desktop shot from this branch.

## The browser checks pass in every pairing, size and page

`check:reading` ran in Chromium 157.0.8103.78 (Playwright 1.63.0) on 2026-11-23 against a production build, with 137 checks passing and `--all` passing on every built page.

- **Fonts.** Each pairing sets the chapter title, a section heading and the body in its faces. Listings keep Manual Code. The pairing's faces report `loaded`.
- **Requests.** On the model gateway chapter, Book requests Literata's and Instrument Serif's romans and Manual Code's two files, as before. Readable requests Atkinson Hyperlegible's regular and bold, Sans requests Inter's and Space Grotesk's romans, and Slab requests Bitter's roman. Each also requests Manual Code, and none requests another pairing's files. Unknown stored values, and storage that throws, give Book.
- **Before the first paint.** The attributes are on `<html>` in the first animation frame and when the parser adds `<body>`.
- **Sizes.** The root font size is 14.4, 16, 18.4, 20.8 and 24 px at the five steps. On the phone the body text measures 15.44, 17.07, 19.55, 22.1 and 25.5 px. The steps differ slightly from the percentages, because the text token adds a viewport term and clamps.
- **The phone at 150%.** The sample was the contents page, the glossary and the three chapters with the most `<pre>`, `<figure>` and `<table>` elements in the built HTML: the-model-gateway (18, 24 and 3), tools-at-scale (18, 21 and 1) and approvals-guardrails-and-injection (16, 19 and 1). No sampled page scrolls sideways in any pairing. With `--all`, all 24 built pages pass in every pairing. The header measures 52 px, the wordmark shows whole, and every button sits in the row.
- **Accessibility.** axe-core 4.14.1 finds no violation on the chapter in each pairing at 150% on the phone, or in Book at 100% on a desktop.

`check:header`, `check:offline` and the manual's 742 Vitest tests also pass.

## The offline shell leaves the optional fonts out, and part 2 saves them

The offline shell would have grown, so the build now keeps the optional fonts out of it. The worker's install-time shell holds every font a linked stylesheet names, and `reading.css` names all four new families. That took the shell from 58 files and 1,622 KiB to 67 files and 1,981 KiB, 359,320 bytes (351 KiB) of it fonts that only readers who pick Readable, Sans or Slab ever use. `scripts/offline-build.mjs` now derives those files from `font.reading` in `book-tokens.json` (every pairing's files but the default pairing's and the code font's) and exports them as `OPTIONAL_FONTS`. The shell leaves them out and the list keeps them, byte-checked, for a later save. The shell is now 59 files and 1,632 KiB, against 58 files and 1,622 KiB before this change. It holds Book's and Manual Code's fonts only. The extra file is the early script, `reading-settings.js` (5,251 bytes), and most of the other 4 KiB or so is the bundled stylesheet, which `BaseLayout` imports `reading.css` into and which grew from 50,449 to 54,965 bytes. A first visit therefore costs 1,632 KiB of shell, and a reader who picks a pairing fetches its fonts (Readable 59 KiB, Slab 77 KiB, Sans 215 KiB; 351 KiB for all eight files) once, from the network, when the page first needs them. Saving them for offline use is part 2's job.

WebKit was not run. It is not installed in the cloud sessions, so Safari's engine and a real iPhone's toolbar and zoom are unchecked. Part 2 adds the settings button, the popover and the phone sheet, which write the two keys through `window.manualReadingSettings`.

## Screenshots

Screenshots are in [`reading-screenshots/`](reading-screenshots/), each under 300 KB. The desktop shots are at 1280 × 900; the phone shot uses the iPhone 14 profile at 2× scale.

- `after-book-desktop.png`, `after-readable-desktop.png`, `after-sans-desktop.png`, `after-slab-desktop.png`: the model gateway chapter in each pairing at 100%. Book's shot also stands for the chapter before this change, which looks the same.
- `after-readable-150-phone.png`: Readable at 150% on the phone, with the header still one row.

The fonts, the early script and the CSS are in place. Part 2 can build the panel on `window.manualReadingSettings` and the two attributes without touching the fonts or the CSS again.
