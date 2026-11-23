# Reading settings: four pairings, five sizes and a header panel

The owner approved design S1 on 2026-11-23: a reader of the manual chooses one of four typeface pairings and one of five text sizes, saved on the device. Part 1 gave the book what a settings panel needs: the pairings' fonts, a way to apply a stored choice before the first paint, and CSS that changes the type without loading fonts the reader did not choose. This report covers part 1, [T69](../../todos/done/T69-manual-reading-fonts-and-early-script.md): what changed, what each pairing costs in bytes, which px sizes became rem, and what the browser checks measured. It then covers part 2, [T70](../../todos/done/T70-manual-reading-settings-ui.md): the header's panel that writes the choice, and how a chosen pairing's fonts reach the offline copy. **In every pairing a page requests only the chosen pairing's fonts and the code face. The choice is on `<html>` in the first animation frame. At 150% on a 390 px phone, no checked page scrolls sideways and the header stays one 52 px row, with the panel open too. A chosen pairing's fonts work offline after one visit with a worker in control.**

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

WebKit was not run. It is not installed in the cloud sessions, so Safari's engine and a real iPhone's toolbar and zoom are unchecked.

## Part 2: the panel writes the choice, and the worker saves the chosen fonts

The header's "Aa" button opens a panel with the four pairings and the five size steps; a choice applies at once, survives a reload with no flash, and its fonts are saved for offline reading when a worker controls the page. The panel builds on part 1 without changing the fonts or the early script's start-up.

### The panel follows the notes sheet's shape on a phone and the popover's on a desktop

The button carries icon I1, a big A and a small a drawn as strokes on one baseline, centred in the header's 36 px button (44 px on a phone). It opens a native `popover="auto"` through `popovertarget`, so the browser closes the panel on Escape and on a click outside, and closes a notes popover when the panel opens. The Notes panel is a modal dialog, so opening it closes the settings panel and the page behind it is inert. On a desktop the panel hangs 6 px under the button, right-aligned with it. On the phone header's windows it is a bottom sheet inside the safe areas, never taller than the window below the header, scrolling inside itself past that. The sheet is modal, with `aria-modal="true"` and Tab kept inside it. The notes sheet is neither, so the panel departs from it there: a sheet that dims the page with a backdrop should say so to a screen reader.

Both groups are native radio buttons, which gives each choice a name and the arrow keys for free. The size steps are named Small (90%), Default (100%), Large (115%), Larger (130%) and Largest (150%), and the label under them reads "115% · Large". Their arrow keys stop at the ends instead of wrapping, so the largest size is never one key press from the smallest. A pairing whose heading and body faces are the same shows one name ("Bitter"), where the owner's mock showed it twice.

The panel keeps its size at every text size, as the header does: its font size is 1rem divided by `--reading-scale`, and its lengths are in em. The phone header now holds four buttons, so two header rules changed with it. The row's side padding divides the rem parts of `--gutter`, and the phone's buttons sit 4 px apart instead of 8 px. Without the change, `check:reading` found the wordmark cut to an ellipsis at 150% in Readable, Sans and Slab: Sans's wordmark needs 155 px and had 152 px even at 100%.

`save(storage, settings)` joins the early script's API. It checks each value through `readFont` and `readSize`, writes a non-default value, and deletes the key of a default, so `read` of an empty storage and `apply` of the defaults agree. A storage that is missing or throws returns false. The start-up still only reads.

### SAVE_FILES saves a pairing's fonts after one visit

Part 1 left the optional fonts out of the install shell, so a reader who picked Sans saw a fallback face offline unless they had saved the whole book. The panel now sends `SAVE_FILES` with the chosen pairing's files whenever a worker controls the page: on a page load with a stored pairing, and 600 ms after the last pick (or when the panel closes), because the native radios fire a change on every arrow press and each pairing passed would otherwise be saved. A pairing of more than 16 files is sent in chunks of 16, and the status waits for all of them. The worker accepts only plain paths under `/fonts/` on its build's list, at most 16, checks each by size and SHA-256, and never downloads a file twice, even while `SAVE_ALL` runs ([ADR 0059](../../decisions/0059-offline-manual-service-worker.md#saving-a-reading-pairings-fonts-addendum-2026-11-23)).

| Pairing | Files saved on first use | Bytes |
| --- | --- | --- |
| Book | none: the shell holds them | 0 |
| Readable | Atkinson Hyperlegible regular, italic and bold | 60,228 |
| Sans | Space Grotesk roman, Inter roman and italic | 219,948 |
| Slab | Bitter roman and italic | 79,144 |

The panel's status line then says, for example, "Sans's fonts are saved for offline reading (about 220 KB)." Saving the whole book needs nothing new: `SAVE_ALL` saves the build's whole list, and the list always held every pairing's fonts. A test build measured that list at 114 files and 5,639,802 bytes on 2026-11-23, and the footer's control shows it as "about 5.6 MB". The control already read that total from the manifest, so its copy did not change. The install-time shell grew from 59 files to 61, and to 1,669 KiB: the panel's script and the module it imports, which the layout links with `modulepreload` so that the shell holds it and the panel works offline from the first install.

Opening the panel costs one download: each pairing's "Aa" sample loads its upright heading file, 89,920 bytes for Atkinson Hyperlegible Bold, Space Grotesk and Bitter's roman together. A page whose panel stays closed requests only its own pairing's fonts, as part 1 measured.

### The checks pass on a desktop, a phone and offline

`check:settings` ran in Chromium 157.0.8103.78 (Playwright 1.63.0) on 2026-11-23 against a production build, then against a test build whose worker registers on loopback, and passed 115 checks:

- **The panel.** The button's size and centred icon, opening by click and keyboard, focus on the checked pairing, Escape, a click outside and the notes popover closing.
- **The choices.** Every pairing's title and body fonts, every size's root font size and label, the arrow keys, a reload with the attributes in the first frame, and Reset leaving nothing stored.
- **The phone.** On the iPhone 14 profile, the sheet's place, its Tab loop and its scroll on a 480 px tall screen, and the header staying shown while the panel is open. At 150% with the sheet open, the three most crowded chapters scroll sideways in no pairing, the header is one 52 px row, and the Notes button and the save control fit.
- **Accessibility.** axe-core 4.14.1 finds no violation with the panel open on the desktop, in the dark theme, on the phone and at 150% in Readable.
- **Offline.** The check picks Sans, finds its three files in Cache Storage and no other pairing's files but the samples' faces, and reloads with the network off: Inter and Space Grotesk load and no font fails. It then saves the whole book and switches through all four pairings offline, each rendering in its own faces.
- **The other checks.** `check:reading`, `check:header`, `check:offline`, `check:save-offline`, `check:note-sheet` and `check:touch-fields` still pass.
- **Not checked.** WebKit is still not installed, so Safari's popover, its sheet under the toolbar and a real iPhone are unchecked.

### The note under the choices says when storage fails

When storage is missing or refuses a write, the note under the choices reads "Not saved: this browser blocked storage". Missing storage shows the note from the start. Otherwise the panel probes storage once, the first time it opens, by writing and removing the key `manual-reading-probe`, so a page view that never opens the panel writes nothing. The note is set before the panel shows, so a screen reader meets it on arrival and the note needs no `aria-live` region.

A pick whose save fails shows the note too, and the pick still applies to the page. Reset and two default picks only remove keys, so they never turn the note back to "Saved". The next non-default pick whose write works does.

The panel's `storage` listener ignores an event from any storage area other than the one the panel uses ([`reading-panel.js`](../../apps/manual/public/scripts/reading-panel.js)), so `sessionStorage` writes never change the note.

## Screenshots

Screenshots are in [`reading-screenshots/`](reading-screenshots/), each under 300 KB. The desktop shots are at 1280 × 900; the phone shot uses the iPhone 14 profile at 2× scale.

- `after-book-desktop.png`, `after-readable-desktop.png`, `after-sans-desktop.png`, `after-slab-desktop.png`: the model gateway chapter in each pairing at 100%. Book's shot also stands for the chapter before this change, which looks the same.
- `after-readable-150-phone.png`: Readable at 150% on the phone, with the header still one row.
- `settings-desktop-popover.png` and `settings-desktop-dark.png`: the panel open on the model gateway chapter, in the light theme and in the dark theme with Sans chosen.
- `settings-phone-sheet.png` and `settings-phone-sheet-150-readable.png`: the phone sheet at 100% in Book and at 150% in Readable, at 2× scale.

A reader can now pick a pairing and a size from any page, see it at once, keep it across visits and read it offline. The fonts, the early script and the CSS from part 1 carry the choice; the panel and `SAVE_FILES` only write it and save its files.
