# @buildanagent/docs

The docs for `@buildanagent/gateway` and `@buildanagent/sdk`, built with Astro and Starlight for docs.buildanagent.fyi. The site is private and static: `pnpm --filter @buildanagent/docs build` writes it to `dist/`, and a broken internal link fails the build.

## Write a page that passes the tests

Pages live in `src/content/docs/`, and the explicit sidebar in `src/topics.ts` names each one, in the order start, concepts, guides, testing, reference. `pnpm --filter @buildanagent/docs test` checks every page against [docs-writing.md](../../docs/guidelines/docs-writing.md):

- The first paragraph has 50 words or fewer, a sentence has 40 or fewer, and a paragraph has 100 or fewer.
- No todo, decision or round id, repository path or banned word appears, and headings are in sentence case.
- Each code block follows a sentence that introduces it, and every TypeScript block comes from a tested example file (see the next section).
- Every page except the home page is in exactly one sidebar topic and ends with a link to the next page.

## Show an example file

A fence with a `file` attribute takes its code from a file under a package's `examples/` folder, so the docs never show code that no longer runs. A terminal session takes a transcript instead, as [the next section](#show-a-terminal-session-from-a-transcript) explains. `region` picks a `// #region` of the file:

````md
```ts file="packages/sdk/examples/order-agent.ts" region="run"
```
````

The build replaces the fence's body with the region and titles the block with the file's name. A path outside an `examples/` or `transcripts/` folder, or a region that is missing, fails the build. Every `ts` block on a page needs this fence, even a one-line import. `test/fences.test.ts` fails on a block without it, unless `test/exceptions.ts` names the block with its reason (empty today). A `<Code lang="ts">` component is no fence, so a second test fails on one. Add an example file under a package's `examples/` folder, with a test in that package, when no file holds the code.

## Show a terminal session from a transcript

A terminal session is never typed into a page. A `console` fence takes its text from a transcript, a file under a package's `transcripts/` folder, and shows it with no title:

````md
```console file="packages/cli/transcripts/help.txt"
```
````

A transcript is the command after a `$ ` prompt, then what the command printed. The CLI's `packages/cli/test/transcripts.test.ts` runs each command, compares the output with its file and fails when the output changes. To accept a change, rerun it with `REWRITE_TRANSCRIPTS=1 pnpm --filter @buildanagent/cli exec vitest run test/transcripts.test.ts`.

The docs' own `test/transcripts.test.ts` fails on a terminal-session fence that names no transcript: a `console` fence, or a shell fence with a line that starts with a `$ ` prompt. It also fails on a committed transcript that no page shows. An install line has no prompt, so it is no session, and `test/install-lines.test.ts` checks it instead.

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

The directive works in `.md` and `.mdx` pages alike: `concepts/the-gateway.mdx` places one, and `test/figure-build.test.ts` requires that an MDX page carries a figure. A caption holds no apostrophe, because Starlight's typographic quotes change it and the test compares the text as written.

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

Eleven tests read the built site: the figure build test, the favicon test, the API reference test, the twins test, the version test, the install-line test, the home test, the topics test, the chrome test, the reference-links test and the content security policy test. They share one build, made once per run by `test/built-site.ts`, a Vitest global setup. The build goes into a temporary folder. Separate builds at the same time can fail, because TypeDoc rewrites `src/content/docs/reference/` while each one runs. The setup runs before any test, so even a run of one test file waits for the build. When the build fails, the setup removes its folder and hands the tests the error, so only the tests that read built pages fail, with the build's output in their message.

## Sidebar topics keep each page small

A page embeds only its topic's sidebar, not the whole site's. `starlight-sidebar-topics` 0.9.0 shows the topics as tabs above the sidebar and gives the current page the sidebar of its own topic. The topics are in `src/topics.ts`: "SDK & gateway", "Harness", "Agent safety", "Protocol" and "CLI" hold the written pages, and each package whose reference TypeDoc generates gets a topic of its own (`API_PACKAGES` in `src/api/packages.ts`), so the generated links of one package never reach a page of another. The plugin overrides Starlight's `Sidebar`, so the table of overrides below does not list it.

To add a topic, add an entry to `topics()`. For a new package's reference, add the package to `API_PACKAGES` and nothing else: the config derives its topic, its TypeDoc plugin and the glob that puts its generated pages in the topic. A page that no topic names fails the build, because the plugin refuses it, and `test/content.test.ts` requires every page of `src/content/docs/` in exactly one topic.

The plugin must come before every TypeDoc plugin in `plugins`. `starlight-sidebar-topics` writes the sidebar, and each TypeDoc plugin then replaces its placeholder group in it. A TypeDoc plugin that runs first finds no sidebar and generates an empty group. `starlight-sidebar-topics` also refuses a `sidebar` option in the Starlight config.

`src/route-data.ts`, a Starlight route middleware, adds `aria-current="page"` to the current tab. The plugin gives every page the same attributes for a tab, so the middleware replaces the current tab's `attrs` object for that page, and `test/topics.test.ts` requires the attribute on exactly the current tab of every page.

Previous and next links stop at a topic's first and last page: the first page of "SDK & gateway" has no Previous link, and `reference/packages` has no Next link.

`test/topics.test.ts` reads the built pages. It fails on a page over the budget, a page whose tabs are wrong or that has no current tab, a sidebar that links into another topic and a reference page outside its package's topic.

The budget is 200 KiB of HTML per page (204,800 bytes; 1 KiB is 1,024 bytes). A collapsed group still holds every link in the HTML, so collapsing does not shrink a page. Split an API topic that nears the budget into more topics, or drop modules from its sidebar. Raise the budget only with a new measurement, and record it in the L12 todo's L12c measurements.

## The API reference is generated

Each time Astro builds, TypeDoc writes a page for every export of all six published packages (`gateway`, `sdk`, `agent-safety`, `protocol`, `harness` and `cli`) under `src/content/docs/reference/<folder>/`. The pages are not committed, and the tests skip them. The entry points come from each package's own `exports` map, so the reference matches what users import (`src/api/packages.ts`).

Packages with many entry points can set `sidebar: "modules"` in `API_PACKAGES` (`@buildanagent/harness` does, across 20 entry points). That mode lists one link per entry-point module in the sidebar instead of every leaf export, keeping every page inside the 200 KiB HTML budget. TypeDoc still generates every export page, its Pagefind entry and its Markdown twin.

`pnpm check:api-docs` fails when an exported function, class, interface, type alias, variable or enum has no TSDoc, or a `{@link}` doesn't resolve. `pnpm test` runs the same check, so CI enforces it, and a test builds the site and requires a page for every export.

TypeDoc 0.28 reads TypeScript only up to 6.0, so this app pins TypeScript 6.0.3 for it, while the rest of the repo builds with TypeScript 7. Only TypeDoc should use the pin: any tool that resolves `typescript` from this app sees 6.0.3, so the `typecheck` script and the test that type-checks inline blocks resolve the repo root's TypeScript instead.

TypeDoc stays on a minimatch version that has a known advisory, and `pnpm audit` accepts the advisory. As of November 2026, `typedoc@0.28.20`, the latest release, asks for minimatch `^10.2.5`, so it gets 10.2.6. That version carries GHSA-g3hv-75wg-m249, a denial of service through crafted glob patterns, and no 10.x release has the fix. Overriding it to 11 crashes TypeDoc, which calls `Minimatch#matchOne`, a method that 11 made private. We judge the risk small: TypeDoc runs only at build time, on the entry points this app's config gives it. To clear the advisory, remove its `auditConfig.ignoreGhsas` entry in `pnpm-workspace.yaml` once TypeDoc depends on minimatch 11.0.1 or later.

Each entry file names its module for its import path with an `@module` tag, so the reference shows `@buildanagent/gateway/anthropic`, not the path of a source file.

## Every page has a Markdown twin

Each page is also served as plain Markdown, so an agent or a reader can take its text without the HTML around it. The twin of `/start/install/` is `/start/install.md`, and the home page's is `/index.md`. The build also writes `/llms.txt`, a list of every twin that follows [llmstxt.org](https://llmstxt.org), and `/llms-full.txt`, every twin joined in reading order, each after a `Source:` line with its address. Both use absolute addresses taken from `site` in `astro.config.mjs`.

One function decides which pages have a twin: `hasTwin()` in `src/twins/rule.ts`. The post-build step, `llms.txt`, `llms-full.txt`, the `<link rel="alternate" type="text/markdown">` that `Head.astro` adds and the button that `PageTitle.astro` adds all read it, so they cannot disagree. A page that `hasTwin()` rejects gets none of them.

`rule.ts` imports nothing, because the two components render inside a bundle with no content folder beside it. It rejects one page, `404`. Starlight adds that page with no source file, so there is nothing to flatten and no twin to link.

`src/twins/pages.ts` reads two facts that only the content folder shows. A page marked `draft: true` is left out, because Starlight leaves drafts out of a production build. A page's `slug` front matter replaces the slug its path would give. Front matter is read with LF or CRLF line ends, and the closing `---` must be a line of its own.

`llms.txt` takes each page's description on one line and escapes brackets in its title. The sidebar places a page by its `slug` (`index` is the home page) or by an internal `link`. To exclude another page, add its path prefix and the reason to `EXCLUDED` in `rule.ts`, and record it in this section.

### How a twin is made

`markdownTwins()` in `src/twins/integration.ts` is a Starlight plugin listed last in `astro.config.mjs`. It adds an Astro integration whose `astro:build:done` hook reads each source file, flattens it and writes the twin into `dist/` as a file of its own. No page's HTML grows, so the page-size budget is untouched. The plugin takes the reading order from the sidebar, so the order has one copy.

`src/twins/flatten.ts` parses a page to an mdast tree with `unified`, `remark-parse`, `remark-directive` and, for an `.mdx` page, `remark-mdx`. It keeps the page's own characters by position and replaces only what the rendered site needs:

- A `file=` fence becomes the code it names, through `src/plugins/example-code.ts`, titled with the file's name.
- A `::figure` becomes one line, `**Figure: caption.** alt text`. The drawing is not included.
- Tabs become a bold label and the code. Asides, written as `<Aside>` or `:::note`, become blockquotes that open with their label. Link cards and buttons become list items.
- Imports, exports, MDX comments and HTML comments disappear. An MDX expression that is a string literal, such as `{'{'}`, becomes the string's text with Markdown's special characters backslash-escaped, so `{'*'}` shows `*` in the twin as it does on the page. Any other expression, such as `{props.name}`, fails the build and names the file and line. Only the rendered page knows its value.
- A root-relative link, image or reference definition changes only its address, in place, so the rest of the link keeps its own line breaks and indent. A link to a page with a twin gets the absolute address of that twin. Any other root-relative address, such as `/favicon.svg` or `/llms.txt`, gets the site's origin and nothing else. The build decides which addresses are pages by checking them against the pages `twinPages()` lists.

A component the module does not know fails the build and names the file and line, so a new component cannot reach a twin as a raw tag. The file is its path under `src/content/docs/`, such as `start/install.mdx`, and the line is the line in that file, front matter included. Adding a component means adding its Markdown form to `Flattener.component`.

The step fails the build, in the same hook, when a page `hasTwin()` names has no twin file or an empty one. It also fails when no built page sits at the slug the step computed, or the built head has no alternate link. `checkTwins()` in `src/twins/build.ts` runs the check, and `test/twins-pages.test.ts` runs it against fake built sites.

### The API reference has twins too

TypeDoc writes Markdown already, so its pages go through the same pipeline. Measured on 2026-11-23: 282 twins (13 written by hand and 269 generated), 515 KiB in all, written in about 0.5 s of a 14 s build. `llms-full.txt` is 558 KB, of which the generated pages are 492 KB. `llms.txt` lists the generated pages under `## Optional`, the section llmstxt.org marks as skippable, so an agent that wants a short list can stop before it. If the full file proves too large for agents, exclude the generated folders in `EXCLUDED` and the step, the tests and the links follow.

### The "Copy as Markdown" button

Under each page title, `PageTitle.astro` shows a "Copy as Markdown" button, a "View as Markdown" link and a status line that screen readers announce. The link works without JavaScript. The button is hidden until its script runs. The home page uses Starlight's splash template, which has a hero and no page title, so it has the head link and no button.

Safari lets a page write to the clipboard only inside the click that asked for it. `src/components/copy-markdown.ts` therefore starts `navigator.clipboard.write()` inside the click handler, with a `ClipboardItem` that holds the unfinished fetch of the twin. The blob's type should equal its key, `text/plain`; no documentation says what a mismatch does. The handler therefore rebuilds the text as a new blob and does not pass on the `text/markdown` one the server sends.

If the browser lacks `ClipboardItem`, or the write is refused, the handler calls `writeText` with the text that a hover or focus fetched ahead. A clipboard with no `writeText` counts as a failed copy. `test/copy-markdown.test.ts` drives the handler with fakes and reads the source to check that nothing waits before the write.

The script is static: it splices no value from the build, and the twin's address comes from the button's `data-twin` attribute. Astro inlines it as one `<script type="module">` whose text is the same on every page, so the [content security policy](#the-content-security-policy-allows-the-docs-own-files-hashed-inline-scripts-and-style-attributes) allows it by one hash. The button's styles use tokens only, take a larger touch target on coarse pointers, set `ButtonText` borders in forced-colours mode and hide in print.

### Adding context7.json later

The owner chose not to publish a `context7.json` (2026-11-23), so nothing writes one. `src/twins/integration.ts` says where to add it.

## The content security policy allows the docs' own files, hashed inline scripts and style attributes

A content security policy (CSP) is a response header that tells the browser what a page may load and run. It is defence in depth, a second layer behind correct escaping: it limits what injected markup can do once it is on a page, but it does not fix the bug that let the markup in.

**What the policy does not stop.** The policy works only in a browser that enforces it, and even there it leaves these open:

- **Styles.** Injected markup can add `style=` attributes, so it could restyle or cover part of a page. Safari before 26.2, a recent release, also lets it add `<style>` elements, so many Safari and iOS readers are in that group today, as are Chrome before 75 and Firefox before 108.
- **Navigation.** An injected link, a `<meta http-equiv="refresh">` or a redirect can still send a reader to another site, because `form-action` covers forms only.
- **Page content.** Injected markup can spoof page text, and it can add elements whose `id` or `name` replaces a global that a hashed script reads.
- **Allowed scripts.** `script-src 'self'` still runs every same-origin script and every hashed inline script.
- **Content types.** The docs do not send `X-Content-Type-Options: nosniff`, which would stop a browser running a same-origin file of another type as a script. Adding it is a follow-up.

**What the policy stops.** Cross-site scripting is an attack that injects markup into a page so that the attacker's script runs there. In a current browser, the docs' policy blocks the four ways such markup would run a script of its own or load anything from another origin:

- an injected inline script;
- an event-handler attribute such as `onclick=`;
- a `javascript:` link;
- a script, stylesheet, font, image, worker or connection from another origin.

It also forbids any other site to show the docs in a frame.

**Where the header comes from.** `_headers` is a Cloudflare file of response headers, one rule per path pattern. `public/_headers` holds the site-wide policy in one `/*` rule, then a rule for the favicon, [described below](#the-favicon-has-a-policy-of-its-own). Cloudflare's asset server reads that file, adds each rule's headers to the matching responses and never serves the file itself. Each line of the file may hold at most 2,000 characters, so the build fails when the CSP line passes 1,900. The deploy serves main's copy of the file, as [How `next.` stays out of search engines](#versions-the-banner-and-the-install-line-rule) describes.

**Inline scripts are allowed by hash.** A hash source such as `'sha256-…'` names the SHA-256 digest of one inline script's exact text, and the browser runs an inline script only when its digest is listed. As of November 2026, the 1,133 built pages carry 13 different inline scripts. They come from seven sources: Starlight's theme, search, sidebar, mobile-menu and tabs components, and the docs' banner and "Copy as Markdown" scripts. The policy has no `'unsafe-inline'` for scripts, so any other inline script is blocked.

**A build step derives the policy from the built site.** `src/csp/integration.ts` runs after every page is written. It reads each page, hashes every inline script and writes `dist/_headers`, which no deploy serves: the test below compares it with the committed file. It also reads every served SVG and XML file, because a browser can open one as a document. `src/csp/policy.ts` holds the directives and the reason for each one.

The build fails on any of these:

- an event-handler attribute, a `javascript:` URL in an attribute that holds a URL, or an SVG `<set>` or `<animate>` that changes an `href`;
- a `<style>` or `<noscript>` element in a page, or a script in an SVG or XML file, prefixed names such as `<s:script>` included;
- a script inside `<svg>` or `<math>`, or one whose text holds `<!--`, where a browser could read different text than the build hashes;
- a policy source outside the allowlist: `'self'` and `'none'`, hashes only in `script-src` and `style-src`, `data:` in `img-src`, `'wasm-unsafe-eval'` in `script-src` and `'unsafe-inline'` in `style-src`;
- a CSP line over 1,900 characters, any line over 2,000 or more than 100 rules.

The checks read HTML with a small tokenizer, `src/csp/html.ts`, that splits a page into tags as a browser does. Markup inside an attribute value, a comment or a script's text is therefore never read as a tag. That matters because Expressive Code keeps raw code, such as `Promise<RenderedOutcome>`, in the `data-code` attribute of each block's copy button.

**After a change to an inline script, regenerate the file.** A Starlight upgrade or an edited component can change an inline script's text, and with it the script's hash. Run `pnpm --filter @buildanagent/docs headers`, which builds the docs and rewrites `public/_headers` from the built pages. Then commit the file. `test/csp.test.ts` fails while the committed file differs from a fresh build's, or while a built inline script's hash is missing from it.

### Style attributes are the policy's one exception

The header sends `style-src 'self' 'unsafe-inline'` with `style-src-elem 'self'`. In a browser that knows `style-src-elem` (Chrome 75 or later, Firefox 108 or later and Safari 26.2 or later, as of November 2026), the second directive limits `<style>` elements and stylesheets to the docs' own files. The `'unsafe-inline'` then covers `style=` attributes only. An older browser falls back to `style-src` and allows inline `<style>` elements too.

The attributes stay because Starlight and Expressive Code write them on every page. A build on 2026-11-26 counted 86,351 `style=` attributes across the 1,133 pages:

- Starlight's sidebar sets `--depth` and its icons set `--sl-icon-size`.
- Its theme select sets `--sl-select-width`, and its search button and dialog set `display` and `padding`.
- Expressive Code sets each code colour as a custom property, such as `style="--0:#F2E8DC;--1:#2A1E16"`.

Moving them to classes would mean rewriting Starlight's components or its HTML after each build. We judged that change larger than the risk it removes, since the attributes cannot run a script.

Allowing them by hash is possible but fragile. `'unsafe-hashes'` is the source that lets a hash allow an attribute, not only a `<style>` element, and it would replace `'unsafe-inline'`, which has the same length. The build has 15 distinct `style=` values, whose hashes take 54 characters each, about 810 in all, so the CSP line would grow from 1,000 to about 1,810 characters. Each new colour set would add one more hash, and two more would pass 1,900.

The build already writes every stylesheet as a file (`build.inlineStylesheets: "never"` in `astro.config.mjs`), so no page needs a `<style>` element.

### The favicon has a policy of its own

`/favicon.svg` colours its strokes from a `<style>` element, with a dark-mode rule, and it must stay a byte-for-byte copy of the site's icon. Under the site-wide policy, `style-src-elem 'self'` would block that style when a reader opens the file, and the strokes would not draw.

The build therefore gives each served SVG that holds a `<style>` a rule of its own. Cloudflare applies rules in file order, so the rule first removes the site-wide header with `! Content-Security-Policy`, then sets the file's own:

```text
/favicon.svg
  ! Content-Security-Policy
  Content-Security-Policy: default-src 'none'; style-src 'sha256-…'; frame-ancestors 'none'
```

The hash allows exactly the favicon's style and nothing else. The build refuses a style whose text holds `&`, `<` or CDATA, because an XML parser would change the text the browser hashes.

### Each directive allows only what the docs load

`DIRECTIVES` in `src/csp/policy.ts` lists the site-wide directives with the reason for each. `default-src` is `'none'`, so anything the list does not name, such as frames and media, is blocked. `'wasm-unsafe-eval'` lets Pagefind compile its WebAssembly search index and allows no `eval()` of script text. No source names a host, so the same header works on docs.buildanagent.fyi, next.docs.buildanagent.fyi, a `workers.dev` preview and `localhost`.

### Previews carry main's policy

A pull request's preview gets main's `_headers`, not one from its own build, because the deploy never trusts a pull request's files. A pull request that changes an inline script therefore shows that script blocked on its preview until it merges. The test still fails in that pull request until it commits the regenerated file. A stable release has the same gap: its deploy builds the release's commit but serves main's `_headers`, so an inline script that changed on main after the release would be blocked on the release's pages.

### What the tests check, and what they leave to a browser

`test/csp.test.ts` checks the policy against a fresh build:

- The committed `public/_headers` equals the file the build writes.
- Every inline script on every page has its hash in the policy, and every hash is used.
- The CSP line stays within 1,900 characters.
- No page or served document carries markup the policy blocks, and a code sample that holds `<script>` and `<style>` text changes nothing the checks read.
- The favicon's rule allows exactly its style.
- The file keeps the one `/*` rule and no `X-Robots-Tag`, which the preview deploy needs.

No test loads a page in a browser, because the docs' CI runs no browser. A manual check on 2026-11-26 served the build through `wrangler dev`, which applied the header, and opened it in Chrome 158. Five pages reported no violation, and neither did `/favicon.svg`. On those pages, code kept its colours, search returned results, and tabs and the theme select worked. An injected inline script was blocked.

## Versions, the banner and the install-line rule

The docs show which release they describe and warn when they describe unreleased code. They also keep every install line on the tag that exists. `docs-deploy.yml` builds `main` once and deploys that one build to docs.buildanagent.fyi or to next.docs.buildanagent.fyi, so the build cannot know its host. The banner is therefore decided in the browser, and nothing in the build is a flag.

**The version tag.** The header shows the SDK's version, such as `0.1.0-alpha.34`, beside the wordmark. `src/version/version.ts` reads it from `packages/sdk/package.json` when Astro builds. The six packages version as one fixed group, so one number names the release. The tag sits beside the home link, not inside it, so the link keeps its name. A screen reader hears "Version 0.1.0-alpha.34". Below 30rem the tag, like the wordmark, is hidden to the eye and kept for screen readers.

**The banner.** `src/components/Banner.astro` overrides Starlight's `Banner` slot. It renders what Starlight rendered (a page's `banner` front matter), then a `<div role="note" aria-label="Unreleased docs" hidden>` that says the pages follow `main` and links to the stable docs. A script that calls `revealUnreleasedBanner` un-hides it when `showsUnreleasedBanner(location.hostname)` is true. That function in `src/version/banner.ts` is the only place the rule lives. Astro bundles it into the script, so the tests and the page run the same code. The rule is that the hostname, lower-cased and without one trailing dot, begins with `next.`:

| Host | Banner |
| --- | --- |
| `docs.buildanagent.fyi` (production today) | hidden |
| `next.docs.buildanagent.fyi` | shown |
| `localhost`, `127.0.0.1` | hidden |
| a `workers.dev` preview such as `docs-pr-12.account.workers.dev` | hidden |
| `next.localhost` | shown, so a developer can see the banner locally |
| `nextdocs.example`, `docs.next.example.com`, an empty host | hidden |

*What a reader can see.* The banner is hidden in the HTML, so no reader of docs.buildanagent.fyi sees it appear, and the page does not move. Its text is static markup in every page on every host, production included, because the build cannot know its host and one script is all the page carries. `hidden` keeps it from readers, and `data-pagefind-ignore` keeps it out of search. A crawler that ignores `hidden`, or a reader who disables styles, can still read "Unreleased docs for main" on docs.buildanagent.fyi. The plan accepts that exposure over writing the text from the script.

*Without JavaScript.* A reader with JavaScript off sees no banner on `next.` either. The plan accepts that, because a header keeps search engines out, not the banner.

*Styling.* Starlight scopes its banner rules to its own `Banner` component, so the `sl-banner` class alone would give our element no colours. `Banner.astro` therefore styles `.unreleased-banner` itself from the `--sl-*` variables:

- **Background:** the accent.
- **Text and link:** the page background, the pair "a banner on the accent" in `src/design/pairs.ts`, which `test/contrast.test.ts` measures at 4.5:1.
- **Focus ring:** the same colour, measured at 3:1 as "the focus ring on a banner".

The element keeps the `sl-banner` class for Starlight's print rule, hides in print and draws an edge in forced-colours mode. The script is static text, the same on every page, with nothing from the build in it. The [content security policy](#the-content-security-policy-allows-the-docs-own-files-hashed-inline-scripts-and-style-attributes) therefore allows it by one hash.

*Tests.* `test/version-built.test.ts` reads every built page and checks four things:

- It carries the hidden banner.
- The HTML never un-hides it.
- The script's text is identical on all pages.
- The built CSS styles the banner and its link.

`test/banner.test.ts` drives the function and the reveal step with fakes, for the hosts in the table.

*Known limitation: the banner can shift the layout on `next.`.* The page paints with the banner hidden, and the module script un-hides it afterwards. On a `next.` host the content therefore moves down by the banner's height. We accept that.

A synchronous script in the head would show the banner before the first paint, but it would add a second script to every page. That breaks the one-static-script design, which lets the CSP allow the banner by a single hash. `next.` is not live until the stable switch anyway.

If the shift matters once `next.` is live, the fix is a synchronous head script that sets a flag on `<html>`, with a CSS rule that reserves the banner's space.

**The "Docs for main" link.** Once the SDK is stable, the footer of every page links to `https://next.docs.buildanagent.fyi/` as "Docs for main", in place of a version switcher. The footer says that those pages follow the main branch and can describe changes no release has yet. Until then the footer has no such line. docs.buildanagent.fyi serves `main` itself and `next.` has no deploy, so the link would be dead ([the plan](../../docs/plans/publish-and-docs.md#the-versioning-design)).

`mainDocsLinkFor(SDK_VERSION)` in `src/chrome.ts` decides. It uses the install rule's own switch (`installRuleFor(version) === "stable"`), so one version check governs both. `Footer.astro` renders the line only when it returns a link.

`test/chrome.test.ts` checks both states, and `test/version-built.test.ts` checks the built pages against the current version. The address sits in `src/chrome.ts` beside `siteLinks`, which reads the shared `@buildanagent/manual/site-chrome` export. The link is one static link on every host, so on `next.` it points at the page's own site. The banner's link to the stable docs is the way back. The owner decided on 2026-11-22 that the switch waits until the harness work is finished.

**How `next.` stays out of search engines.** The build adds no `<meta name="robots">` tag, which would also reach production, and a test fails if one appears. The deploy sends a header instead. For `next.docs.buildanagent.fyi`, `docs-deploy.yml` runs `scripts/ci/site-stage-dist.mjs docs … --noindex` and then `site-guard-deploy.mjs docs --noindex`.

The stage script never writes the artifact's own `_headers`. It writes main's `public/_headers` with `X-Robots-Tag: noindex` added to its one `/*` rule. When the app has no such file, it writes the two lines `/*` and `  X-Robots-Tag: noindex` (`NOINDEX_HEADERS`, `headersFor()`). The guard fails the deploy when the deployed `_headers` differs.

Cloudflare adds the same header to a `workers.dev` preview by itself, and a pull request's preview gets the staged file as well. A custom domain gets nothing from Cloudflare, which is why the file exists. This README describes those scripts and changes none of them.

**The install-line rule.** `test/install-lines.test.ts` finds every install command that names a `@buildanagent/*` package. The commands are:

- `pnpm add`, `pnpm i`, `pnpm install` and `pnpm dlx`
- `npm install`, `npm i`, `npm add` and `npx`
- `yarn add` and `yarn dlx`
- `bun add` and `bunx`

It reads each docs source page, tabs and inline code included, and the text of each built page, the generated reference included. A line ending in a backslash continues on the next. In built HTML, where Expressive Code ends each line with two block ends, the join takes any run of line breaks after the backslash.

*What counts as an argument.* Only the command's own arguments count: the words after the command, up to a shell separator (`&&`, `||`, `;`, `|`), the end of a code span or table cell, or the end of the line. A package named elsewhere in the line is prose. A subpath such as `@buildanagent/gateway/testing` is an import specifier, not an install target, so the rule skips it.

*The alpha rule.* While the SDK's version has an `-alpha.` part, a package on such a line must end in exactly `@alpha`. These forms fail:

- a range: `@^0.1.0`, `@~1`, `@>=0.1` or `@*`
- `@latest`
- a bare name
- a pinned `-alpha.N` version, which names one release that the next alpha supersedes, so the line would go stale

The failure names the file, the package and the rule.

*The stable rule.* Once the SDK's version has no prerelease part, the rule flips: no line may name `@alpha`. The first stable release therefore fails the test until every line is updated. Under the stable rule a range or an exact version passes.

*Parsing and throws.* The built-page text is read with a quote-aware tag pattern, because Expressive Code leaves `>` unescaped inside the copy button's `data-code` attribute. Any other prerelease (`-beta.1`, `-rc.1`) has no rule, because only the `alpha` tag exists. `installRuleFor` throws and tells the maintainer to extend it. `src/version/install-lines.ts` holds the rule as pure functions, which the test checks with fixtures for both states. The packages' own READMEs are checked by their own packages' tests, not here.

## The theme is the book's

The docs look like the book because they read the book's design data instead of copying its CSS. Each piece has one home:

| Piece | Where it lives |
| --- | --- |
| Colours, fonts and sizes | `docs/design/book-tokens.json`, shared with the book; the docs replace its body font with IBM Plex Sans |
| The tokens file | `src/styles/tokens.css`, generated by `scripts/generate-tokens.ts` through the book's `tokensCss()` (`@buildanagent/manual/design/tokens`) |
| The mapping onto Starlight | `src/styles/starlight.css`, which sets Starlight's `--sl-*` variables to `var()` references to the tokens |
| Code block themes and frame colours | `src/design/theme.ts`, which builds two Expressive Code themes from the book's `panelDark` and `panelLight` colours |
| Fonts | `public/fonts/`, a copy of two folders of the book's `apps/manual/public/fonts/` (Instrument Serif, Manual Code) and the docs' own `ibm-plex-sans/`, pinned in `fonts/ibm-plex-sans.json` |
| Preloads for the two fonts every page uses | `src/components/Head.astro` |
| Colour pairs Starlight creates | `src/design/pairs.ts` |

Run `pnpm --filter @buildanagent/docs tokens` after changing `book-tokens.json`. It rewrites `tokens.css` and replaces the book's two font folders in `public/fonts/` with fresh copies, so a font the book drops leaves the docs too; the docs' own `ibm-plex-sans/` folder is left as it is. Starlight loads `tokens.css` before `starlight.css`, and `astro.config.mjs` lists them in that order.

The page chrome differs from Starlight's defaults in two ways. The four components in the next section are replaced. Two rules in `starlight.css` restyle Starlight's own parts without replacing them. The Previous and Next links at the foot of a page are one compact row each: a rule border, no shadow, a 12px label, a title at the note size and a 44px minimum height. The theme select is a compact box with a rule border and a small radius, its text at the label size in the soft text colour, a pair `pairs.ts` already measures, so the select adds no pair.

### Components the docs override

The docs override six Starlight components and leave the rest as Starlight ships them. A seventh override needs a row here: `test/overrides.test.ts` fails when this table and `astro.config.mjs` list different components or files.

| Component | File | Why |
| --- | --- | --- |
| `Banner` | `src/components/Banner.astro` | Shows Starlight's `banner` front matter as before, then the hidden "Unreleased docs for main" banner and the script that shows it on a `next.` host ([Versions and the banner](#versions-the-banner-and-the-install-line-rule)). |
| `Footer` | `src/components/Footer.astro` | Adds the "Docs for main" line once the SDK is stable and the CC BY 4.0 licence line that every page carries, under Starlight's own footer. |
| `Head` | `src/components/Head.astro` | Adds the preloads for the two fonts every page uses, so the first paint does not wait for them, and the link to the page's Markdown twin. |
| `PageTitle` | `src/components/PageTitle.astro` | Shows Starlight's title, then the "Copy as Markdown" button and the plain link to the twin. |
| `SiteTitle` | `src/components/SiteTitle.astro` | Renders the inline mark and wordmark "Build An Agent docs" from `@buildanagent/manual/site-chrome` (through `src/chrome.ts`) in place of Starlight's text title, with the SDK's version beside the link. Below 30rem only the mark shows, and the wordmark stays in the page for screen readers. |
| `SocialIcons` | `src/components/SocialIcons.astro` | Puts Docs, Manual and Site before the GitHub icon in the order of `@buildanagent/manual/site-chrome`. Docs carries `aria-current="true"`, not `"page"`, because the link goes to the docs home, which is not always the page the reader is on. `astro.config.mjs` reads the GitHub URL from `src/chrome.ts` too. |

`test/logo.test.ts` guards the mark. It requires the favicon's strokes to be at least 2px wide at 16px and the favicon to set colours for both schemes, and it requires `SiteTitle` to draw logo 3 in token colours. In headless Chromium it also draws the favicon at 16px in light and dark, and fails when the drawing is blank, when the space inside the frame fills in or when the caret loses its own colour. Playwright is not a dependency of the repo, so this render test skips where Playwright or a browser is missing, as it does in CI today. `test/favicon.test.ts` builds the site and requires the title, the wordmark, the licence line and the favicon link on every page.

### Tabs and MDX

A page that needs Starlight's `<Tabs>` is an `.mdx` file that imports `Tabs` and `TabItem` from `@astrojs/starlight/components`. Give every group of tabs a `syncKey`, so a reader's choice of package manager carries to the next page, as the Install page does with pnpm, npm and yarn.

The content tests read an `.mdx` page as they read Markdown, with these exceptions. A line holding only an import or one component tag counts as blank, so the paragraph, sentence and heading rules count the same words. Imports, exports and `{/* */}` comments outside a code block are blank too, and a code block's own lines never change. A component tag that carries words on its own line stays in the body and is counted, and so do the `title`, `label` and `description` values of a one-line tag. Fences in sibling tabs take the sentence before the first tab as their introduction. `test/mdx.test.ts` pins these rules.

Six more test files guard the theme, the fonts and the header:

- `test/tokens.test.ts` fails when `tokens.css` differs from what the generator writes, or when `customCss` stops loading the tokens first. It also fails when the docs tokens differ from the book's output anywhere between the header comment and the print block, except the IBM Plex Sans `@font-face` rules (and the stand-in face's) and the `--font-body` line, which differ on purpose.
- `test/fonts.test.ts` fails on any of four things. The book's two font folders in `public/fonts/` have a file the book lacks, lack one it has or differ from the book's copy by a byte. A Plex file or the licence differs from the SHA-256 in `fonts/ibm-plex-sans.json`, or `SOURCE.md` lacks a hash of the pin. `Head.astro` preloads anything but Plex's regular file and Instrument Serif's regular file. The body font is not IBM Plex Sans, the display font is not Instrument Serif, a Plex face lacks its weight, style or unicode range, or an Inter or Literata file or rule remains.
- `test/plex-release.test.ts` feeds `scripts/plex-release.ts` crafted tarballs and registry replies and fails when a check accepts one it should refuse.
- `test/contrast.test.ts` measures every pair in `pairs.ts` in light and dark, from the colours `tokens.css` ships: 4.5:1 for text and 3:1 for focus rings and the edges that mark an aside, a code marker or an inline marker. It also checks that each Expressive Code theme takes its panel's colours, that every syntax colour reaches 4.5:1 on the panel, that the code markers take the measured panel colours, and that printed pairs reach the same ratios on the light colours and on bare paper. A further test lists the eight pairs that draw text in a background colour (`PRINTED_FILLS`) and requires, for each, a print rule that hides it or repaints it, then measures the printed colour on paper.
- `test/chrome.test.ts` checks `src/chrome.ts` and the built header against `@buildanagent/manual/site-chrome`, failing when the links, the mark and wordmark, or the current-site flag diverge.
- `test/styles.test.ts` fails when a docs stylesheet or component writes a hex colour or loads from another origin, when a `--sl-color-*` variable is set to anything but a colour token, when a decorative token (rules, highlights, panel border and grid) colours text, or when inline code in a link stops inheriting the link's colour. It checks headings too: the third-level to sixth-level heading sizes must stay off Starlight's shared `--sl-text-h*` variables, the title and second-level headings must keep the display face at weight 400, and the third-level headings and smaller must keep the body face at weight 600. To judge a decorative token, the test follows a variable through every custom property that names it, to the declarations that finally paint it, in Starlight's files, Pagefind's `css/ui.css` (which paints the `--pagefind-ui-*` variables) and the docs' own. A chain that ends in anything but a border, a background or a box shadow, a cycle, and a variable nothing reads all count as not decorative. It also fails when the Previous and Next links gain a shadow or lose their rule border, their label and note sizes or their 44px minimum height.

The file `pairs.ts` holds 52 pairs: 38 text pairs and 14 non-text pairs. To add a colour pair, append an entry to `STARLIGHT_PAIRS` in `src/design/pairs.ts` with its role, the two tokens as `page.<key>` or `panel.<key>`, and `text` or `nonText`. The test reads both tokens in each mode, so a failure names the role, the mode and the ratio. The book's own pairs stay in `book-tokens.json`, whose test counts them, so the docs keep theirs apart.

### The home page

`src/content/docs/index.mdx` is the owner's chosen "package cards" design. It uses Starlight's `splash` template and has four parts: a hero with a title and tagline but no buttons, the alpha install command in the Install page's pnpm, npm and yarn tabs, a `CardGrid` with one `LinkCard` for each of the six packages, and a "Learn the ideas" block with two `LinkButton`s. The gateway and SDK cards open the Install and first-agent pages. The other four open the package's README on GitHub, because the docs have no page for them yet; move a card to its quick start when one exists. Keep each `LinkCard` on one line and separate the cards with blank lines, so the content tests count each card's words as their own paragraph.

`starlight.css` styles the page through `[data-has-hero]:has(.card-grid)`, because Starlight's fallback 404 also sets `data-has-hero` and only the home page holds a card grid: a 60rem content width, a centred hero, and cards in three columns from 64rem, two from 40rem and one below, each card a flat panel whose whole area is the link. The card's colours are tokens, and the five pairs they create are in `pairs.ts`. `test/home.test.ts` reads the page source and requires six cards in the design's order, a target for each (a docs page, or a package README in the repository), install commands equal to the Install page's, and links to the manual and a guide. It also requires three guards: no home rule applies without the card grid, the global link rules skip a button, and the built 404 page has no card grid.

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
- the topic tabs' `ul.starlight-sidebar-topics` and `a.starlight-sidebar-topics-current`, which one rule restyles;
- the aside classes `.starlight-aside--note`, `--tip`, `--caution` and `--danger`, with `--sl-color-asides-border` and `--sl-color-asides-text-accent`.

Expressive Code takes `themes` from `codeThemes()` and `styleOverrides` from `CODE_STYLE_OVERRIDES`, whose values name `var(--panel-*)` and `var(--font-code)` so a code block follows the page's theme. It also takes `minSyntaxHighlightingColorContrast: 0`. Expressive Code's default of 5.5 makes it shift any syntax colour that falls short, but the book's panel colours are already measured at 4.5:1 or more, so the shift would only replace measured colours with unmeasured ones. One setting controls the plain panel and the markers, so zero also turns off correction on markers. The theme replaces that correction with the measured colours above, and the contrast test checks them. A test requires the setting.

### The fonts come from two places

The docs set their text in three faces. Instrument Serif at weight 400 draws the page title and the second-level headings, and the home page's card titles. IBM Plex Sans, at weight 400 for body text and 600 for third-level headings and smaller, draws everything else, including the sidebar, the table-of-contents links and the tables. The "On this page" heading is an `h2`, so it is Instrument Serif. Manual Code draws code. The owner chose Inter over Literata for body text on 2026-11-24 and, the same day, IBM Plex Sans over Inter; the book keeps Literata.

The docs own the Plex files. `public/fonts/ibm-plex-sans/` holds IBM's own WOFF2 files from `@ibm/plex-sans` 1.1.0 (published 2024-11-11) with the package's `LICENSE.txt`, unchanged: the Latin1 subset of Regular (400), Italic (400 italic) and SemiBold (600), 66,168 bytes in all. IBM publishes the split, so the docs subset nothing, and that is why the family keeps the name "IBM Plex Sans" although its licence reserves "Plex" ([THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) gives the reasoning). Version 2.0.0 was six days old on 2026-11-24, so the pin stays at 1.1.0 until a later release is a week old. `fonts/ibm-plex-sans.json` records the version, its publish date, the day it was pinned, the tarball's integrity, the commit and every file's SHA-256, and `public/fonts/ibm-plex-sans/SOURCE.md` repeats them for a reader of the folder. A test checks the files against both, and checks that the pin's date is at least a week after the publish date; offline, it can compare only those recorded dates.

To refresh the files, run `pnpm --filter @buildanagent/docs fonts:plex <version>`. The script accepts only a plain version such as `1.2.0` and refuses a release published less than a week ago. It runs `npm view` and `npm pack` with scripts off in an empty temporary folder, so no project `.npmrc` reaches them, and checks the tarball's integrity. It reads the tarball in memory and never unpacks it onto disk. It refuses the tarball when any entry is a link or anything but a regular file, or has an absolute name or one with `..`, and when a font lacks the WOFF2 signature or the licence is not short plain text. The new pin takes the source commit and tarball address from the registry, and the unicode range and copyright from the tarball's CSS and licence, so nothing in it describes the old release. Only then does it replace the Plex folder whole, keeping `SOURCE.md`, and then the pin, so a failed write leaves the old release in both (`scripts/plex-release.ts` holds the checks). Then read the new licence, update `SOURCE.md` and the notices, and rebuild. Without a version, the script restores the pinned files and fails if the tarball's integrity is not the pin's.

The other two families are copies of the book's. `docsTokens()` in `src/design/theme.ts` replaces the body font of the book's tokens with Plex from the pin. The book's generator writes an `@font-face` rule without a unicode range or size metrics, so `docsTokensCss()` hands it the body font with no files and writes the Plex rules itself: each with `font-display: swap` and the pin's `unicode-range`. That range is the one IBM's per-face CSS beside the split files (`fonts/split/woff2/IBMPlexSans-<Face>.css`) gives the Latin1 subset, the same for all three faces. The package's combined `css/ibm-plex-sans-default.css` differs: it adds U+2074, which none of the three files maps, and splits U+00A0-00FF in two. The docs' body text lies inside the range, as a crawl of every page showed. Text outside it, such as Cyrillic or Latin Extended, falls back first to the Arial stand-in described below, which has no unicode range, and then to the system faces. A request for weight 700, which only the hidden `next.` banner makes, takes the 600 face, and 500 takes 400, without synthesized bold. The book's token file and CSS do not change. Body text sets at a 1.65 line height in `starlight.css`, not the book's 1.7, to match the owner's mock.

While Plex loads, the browser draws the text in "IBM Plex Sans Fallback": `local()` Arial, Liberation Sans or Helvetica, with `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` set so that a line takes Plex's width and height. `size-adjust` is Plex's average advance over the characters of the docs' prose divided by Arial's: 100% for regular, 98.4% for italic and 96.4% for semibold. Plex's ascent and descent (1.025 and 0.275 em) divided by it give the overrides, and the line gap is 0. With the fonts blocked, a prose paragraph keeps its height and its longest line is under 2% narrower than with Plex loaded. `--font-body` ends in `system-ui, -apple-system, "Segoe UI", sans-serif` for a browser without `local()` Arial.

Headings in a page's content take four plain sizes: 1.375rem (third level), 1.125rem (fourth), 1.0625rem (fifth) and 1rem (sixth). At Starlight's own sizes, a third-level heading in a sans face at weight 600 looked as heavy as the second-level heading in Instrument Serif. Each size is set on the heading and on its `.sl-heading-wrapper.level-hN`, because Starlight puts the size for the line box, the anchor icon and the em margins on the wrapper. The rules are scoped to `.sl-markdown-content`, skip `.not-content` and leave Starlight's variables alone, because Starlight's `--sl-text-h4` and `--sl-text-h5` variables also size its card titles, the "On this page" heading and the aside titles. These sizes and the 1.65 line height are plain numbers in `starlight.css`: the "tokens only" rule covers colours, and the book's `--line-height-body` (1.7) goes unused in the docs.

The docs serve their own copy of the book's four WOFF2 subsets, two each of Instrument Serif and Manual Code, beside the three Plex files. Each folder holds its licence, and Manual Code's also holds its `TRADEMARKS.md`. The two sites deploy separately, so the docs cannot link to the book's files. `fonts.test.ts` keeps the copies identical. Do not edit a book-copied file in `public/fonts/`: change the book's and run the `tokens` script. Every page preloads Plex's regular file and Instrument Serif's regular file; the semibold face loads on first use, which every page makes in the sidebar. [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) covers all three families.

### Upgrading Starlight

Pin Starlight to one exact version and move it one minor release in each pull request, so a visual change has one cause. Read the changelog for renamed or removed `--sl-*` variables, changed component props and Expressive Code changes, and update the version named in `starlight.css` and in this README. Then run `pnpm --filter @buildanagent/docs build` and `test`. The build fails on a broken link or an override whose import has moved, and the tests catch a wrong colour but not a renamed variable, so the look is the check for that. Open the built site in light and dark, and look at a page with an aside, a code block, a table, a set of tabs and the search dialog, and at each override in the table above.

## Licence

The docs are CC BY 4.0 ([LICENSE-DOCS](../../LICENSE-DOCS)), and every page's footer says so.
