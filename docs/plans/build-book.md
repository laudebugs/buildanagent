# Plan: write a two-part textbook on building an agent, published from `apps/manual` to manual.buildanagent.fyi

- **Status:** Approved (2026-11-19). The owner answered the design, licence, vendoring and Cloudflare questions, then asked for a review, including a check that the outline covers every part of building an agent. Asked to approve the reviewed plan, the owner said "If green merge" and then "Then continue work", so its todos now start once their **Depends on** are done (§7). On 2026-11-19 the owner also approved the twelve plan changes of the retrieval and memory research (U18), which added two example todos, T43 and T44, for 48 in all (BK20). The same day the owner approved every change that the A2A (U19), voice (U20) and fine-tuning (U21) research proposed. Those changes added four example todos, T45–T48, for 52 in all, and T48 is held until an SDK we pin ships A2A 1.0 (BK20).
- **Date:** 2026-11-19
- **Asked for by:** the project owner (2026-11-19): "A textbook on how to build an agent, with images that explain how agents work and example code from this repository."
- **Builds on:** the three [build guides](../guides/), the [main research report][main], the eight [SDK references](../reference/), the [comparison docs](../comparison/), the plans and ADRs, the [publish-and-docs plan](publish-and-docs.md) for the docs and website beside the book, the verified examples in `verify/*/examples/`, and the owner's garment engineering textbook repository, read at commit `bca44b0` (BK16)
- **Decision records:** [ADR 0052](../decisions/0052-book-in-apps-on-cloudflare.md) (accepted, owner), [ADR 0053](../decisions/0053-book-stack-and-deploy.md) (proposed), [ADR 0054](../decisions/0054-reuse-garment-textbook-code.md) (accepted for the permission, the exclusions and the Apache-2.0 licence; proposed for the list)
- **Todos:** Round T ("textbook") on the [todo board](../todos/README.md); §5 lists them.

This repository already holds most of what a book on building agents needs. It has three guides, a research report with a fact-check log, eight SDK references, and 70 example programs that type-check and run offline against mock models. But these sources are written for the engineers who will build our stack, and they assume the reader knows how an agent works. The owner wants a textbook for two readers: developers new to agents, and experienced builders who want the design reasons. The owner's garment engineering textbook shows what goes wrong when a book like this grows by hand: chapters numbered by hand needed about fifty redirects after renumbering, and figure numbers were typed into captions. **This plan builds the book as a static Astro site in `apps/manual` whose chapter, figure and listing numbers, citations, glossary links and code listings are all computed and checked at build time. It deploys the site as an assets-only Worker on manual.buildanagent.fyi. After eleven tooling todos, sixteen new examples and four research rounds, it writes eighteen chapters in the owner's "call, then workflow, then loop" order, each fact-checked section by section.**

## 1. Goal and non-goals

**Goal.** At the end of Round T, manual.buildanagent.fyi serves a public textbook in two parts with eighteen chapters. Part I takes a developer from one model call, through a fixed workflow, to a tested agent loop of their own; Part II explains each layer of an agent stack in depth. Every code listing comes from a file that CI type-checks and runs, and every API name in the prose resolves to a listing, a transcript or a pinned `.d.ts`. Every figure is generated from a committed script and checked for staleness. Every citation resolves to a source that one of our fact-check logs verified. The build fails if any of these checks fails.

**Non-goals.** Each has a reason:

- **Sign-in, analytics or cookies.** The owner made the book public with no sign-in (BK2), so the site needs no Worker code and collects nothing about its readers.
- **PDF and EPUB in Round T.** The web book comes first; export follows once the chapter model settles (BK13).
- **Offline reading.** The garment book's hand-written service worker needed its own build script and offline end-to-end test (`scripts/offline-build.mjs`, `test:offline` in its `package.json`). A later PDF or EPUB covers offline reading more simply.
- **Live code that calls a real model, in a browser or in CI.** No provider key ever reaches a browser, and CI never holds one. Tier 4 of the interactive listings, a later option, runs only against a scripted model (BK9). The one live path is a workflow the owner starts by hand (BK18).
- **Research inside a chapter.** Chapters draw on sources already in this repo. The four topics the repo lacks get research todos first (BK19), and a chapter that finds another gap records it as a follow-up research todo instead of filling it from memory. No topic of the coverage review is a non-goal.

## 2. Decisions

| ID | Decision | Status | ADR |
| --- | --- | --- | --- |
| BK1 | A textbook in two parts, with explanatory figures and code from this repository; Part I runs "call, then workflow, then loop" | Accepted (owner, 2026-11-19) | [0052](../decisions/0052-book-in-apps-on-cloudflare.md) |
| BK2 | The book lives at `apps/manual`, public on Cloudflare at manual.buildanagent.fyi, with prose under CC BY 4.0 and code under Apache-2.0 OR MIT | Accepted (owner, 2026-11-19) | [0052](../decisions/0052-book-in-apps-on-cloudflare.md) |
| BK3 | A static Astro 7.4.11 site with no adapter, Markdown through a unified pipeline, Pagefind 1.6.0 search and Wrangler 4.160.1 | Proposed | [0053](../decisions/0053-book-stack-and-deploy.md) |
| BK4 | `apps/*` joins the pnpm workspace, and the book is the private package `@buildanagent/manual` | Proposed | [0053](../decisions/0053-book-stack-and-deploy.md) |
| BK5 | The outline lives in code, slugs carry no numbers, and the build numbers chapters, figures, listings and tables | Proposed | none |
| BK6 | A source register whose every entry points at the fact-check that verified it, with citations that fail the build when unknown | Proposed | none |
| BK7 | A glossary kept as data, with the first use of each term linked in every chapter | Proposed | none |
| BK8 | Code comes from the verified `verify/` examples now, and moves to our own packages as their todos land | Accepted (owner, 2026-11-19) | none |
| BK9 | Listings are included from real files by named region, show their path, lines and pinned version, and become interactive in three tiers | Accepted (owner, 2026-11-19) for the three tiers and live editing later; the mechanism is Proposed | none |
| BK10 | Figures mix flat SVG diagrams with a few interactive isometric centerpieces | Accepted (owner, 2026-11-19) | none |
| BK11 | Every figure is generated from a committed script, checked for staleness, inlined, readable without JavaScript and drawn for both themes | Proposed | none |
| BK12 | Direction C's layout, C4's page colours, code and figure panels that follow the theme, and Instrument Serif, Literata and Google Sans Code | Accepted (owner, 2026-11-19) | none |
| BK13 | PDF and EPUB export come after Round T | Proposed | none |
| BK14 | One build workflow, `book-build.yml`, builds the book with no secrets and runs every book check on each pull request | Proposed | none |
| BK15 | Deploy as an assets-only Worker with a custom domain through DS3's build and deploy split, with a guard script, a deploy switch and a preview per pull request | Proposed | [0053](../decisions/0053-book-stack-and-deploy.md) |
| BK16 | Reuse the garment textbook's code where it fits, under Apache-2.0 and credited, and copy none of its personal data or agent rules | Accepted (owner, 2026-11-19) for the permission, the exclusions and the licence; the list is Proposed | [0054](../decisions/0054-reuse-garment-textbook-code.md) |
| BK17 | Inline code in a chapter must resolve to a listing, a recorded transcript or the pinned `.d.ts`, or cite a hand-checked fact-check row | Accepted (owner, 2026-11-19) | none |
| BK18 | An occasional live run, started by hand with the owner's Anthropic and OpenAI keys and capped at $1.00, compares real flows with the mock transcripts; CI never calls a provider | Accepted (owner, 2026-11-19) | none |
| BK19 | Every topic group in the coverage review gets a home; four topics get research todos first | Accepted (owner, 2026-11-19) | none |
| BK20 | New `verify/` examples fill the example gaps the coverage review found | Accepted (owner, 2026-11-19) | none |
| BK21 | Every section is fact-checked before the next is drafted, then the whole chapter is reviewed and fixed | Accepted (owner, 2026-11-19) | none |
| BK22 | The writing is not dry: varied openings, distinct analogies with their limits, used where they make a concept clearer, and illustrated analogies | Accepted (owner, 2026-11-19); analogies made optional (owner, 2026-11-19) | none |

### BK1. A textbook in two parts, with figures and code from this repository (accepted)

**The owner's decisions (2026-11-19):** "A textbook on how to build an agent, with images that explain how agents work and example code from this repository." And: "Two parts: Part I foundations for developers new to agents; Part II in depth for experienced builders."

**The owner's decision (2026-11-19):** the Part I arc is "Call, then workflow, then loop". Its first chapter opens with "use the least autonomy that works" ([agent guide §2][g-agent]; [Anthropic, Building effective agents][bea]): it shows a single call and a fixed workflow before the loop, and a box explains how every example runs without a key.

Part I assumes a developer who has called a model API but never built an agent. Each of its chapters ends with a working program the reader can run offline. Part II assumes a reader who has shipped an agent on some SDK and wants to know why ours makes the choices it does; its chapters follow the layers of the [reference architecture][main-arch] and the [SDK][g-sdk] and [harness][g-harness] guides. §4 gives the outline.

### BK2. `apps/manual`, public on Cloudflare at manual.buildanagent.fyi (accepted, ADR 0052)

**The owner's decisions (2026-11-19):** "It lives at `apps/book` in this monorepo and is published on Cloudflare at the domain manual.buildanagent.fyi." And: "Public, no sign-in; book prose CC BY 4.0 like our docs (see LICENSE-DOCS), code Apache-2.0 OR MIT."

**Renamed by the owner (2026-11-19):** "Let's make it @buildanagent/manual and apps/manual". The app is `apps/manual` and the private package `@buildanagent/manual`; the site, its domain and every decision below are unchanged ([ADR 0055](../decisions/0055-name-the-book-app-manual.md)).

`apps/` holds the deployable sites, beside `packages/` for libraries and `verify/` for harnesses. The book is one of three sites on the buildanagent.fyi zone, and each links to the other two in its header and footer:

| Site | App | What it is | Plan |
| --- | --- | --- | --- |
| buildanagent.fyi | `apps/site` | The project website: what buildanagent is, the packages, links | [DS2](publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted) |
| docs.buildanagent.fyi | `apps/docs` | The library docs on Starlight, with the API reference | [DS1](publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted) |
| manual.buildanagent.fyi | `apps/manual` | This textbook on building an agent | this plan |

The book teaches how agents work and why ours are built as they are; the docs say how to use our packages; the website points at both. T1 lists the book's prose and figures under the documentation terms in [LICENSE](../../LICENSE), and the book's code and figure generators under the code terms.

The zone buildanagent.fyi already uses Cloudflare's name servers, and manual.buildanagent.fyi has no DNS record yet, as of 2026-11-19 (fact-check rows 34–35). Cloudflare refuses to create a custom domain on a hostname that already has a CNAME record ([Cloudflare, custom domains][cf-cd]), so T9 checks for one first. The owner puts the zone in the deploy account and sets up the GitHub environments and tokens (BK15).

### BK3. A static Astro site with no adapter, a unified Markdown pipeline and Pagefind (proposed)

| Package | Pin | Released | Latest (2026-11-19) |
| --- | --- | --- | --- |
| `astro` | 7.4.11 | 2026-11-11 | 7.4.13 |
| `@astrojs/markdown-remark` | 7.3.8 | 2026-11-11 | 7.3.10 |
| `wrangler` | 4.160.1 | 2026-11-11 | 4.165.0 |
| `pagefind` | 1.6.0 | 2026-11-01 | 1.6.0 |
| `remark-directive` | 4.0.0 | 2025-02-27 | 4.0.0 |
| `unist-util-visit` | 5.2.0 | 2026-10-24 | 5.2.0 |

Each pin is the newest release at least a week old on 2026-11-19, from `npm view <package> time` (fact-check rows 1–7). Wrangler 4.161.0 came out on 2026-11-12 at 13:40 UTC, a few hours short of a week, so the plan takes 4.160.1. T1 re-checks every pin under the [version rule](../../AGENTS.md#coding-standards) before installing.

**T1's re-check (2026-11-19, 11:25 UTC).** No pin moved (fact-check rows 175–177). Wrangler 4.161.0 was still about two hours short of a week old, so 4.160.1 stays. T1 installs only the three packages the scaffold uses: `astro`, `@astrojs/markdown-remark` and `pagefind`. `remark-directive` and `unist-util-visit` arrive with T3's plugins, and `wrangler` with T9's deploy, and each is re-checked then. None of the three needs a build script, so `onlyBuiltDependencies` is unchanged.

**Choice.** The book is a fully static site: Astro's default static output, with no `@astrojs/cloudflare` adapter and no server code. The garment book needs the adapter only because a Worker checks sign-in in front of its pages (its `wrangler.jsonc` and `scripts/guard-deploy.mjs`), and our book is public. Cloudflare's Astro guide deploys a static Astro build with an `assets.directory` and no `main` ([Cloudflare, Astro][cf-astro]). If the book ever needs a Worker, the adapter's pin would be 14.4.7 (2026-11-10).

Chapters are plain `.md` files. Our citation, glossary and figure plugins are remark and rehype plugins, but Astro 7's default processor is Sätteri (fact-check row 9). Chapters therefore go through the `unified()` processor that `@astrojs/markdown-remark` 7.3.8 exports, the route the garment book takes. `remark-directive` adds the block syntax for listings, tabs and asides. Pagefind indexes the built site after `astro build`, and only chapter bodies carry `data-pagefind-body`, as in the garment book.

**Evidence.** Astro 7.4.11 requires Node 22.23.4 or later (`engines`), and our `.nvmrc` names only the major version, `22`, so T1 confirms that CI and local installs resolve to 22.23.4 or later. `@astrojs/check` 0.9.12 accepts TypeScript 5 or 6 as a peer, while the root pins TypeScript 7.0.2 (fact-check row 10). T1 therefore type-checks the book's `.ts` files with the root `tsc` and records whether `astro check` can run at all.

**T1's result (2026-11-19).** `astro check` cannot run: Astro 7.4.11 stops before loading `@astrojs/check` when TypeScript's major version is 7 or more, and tells the user to install TypeScript 6 (fact-check row 179). The book's `typecheck` therefore runs the root `tsc` 7.0.2 over its `.ts` files, and `check:book` runs `astro sync` until T3's checks replace it, so a chapter whose frontmatter breaks the strict schema still fails the check. Both CI's cached Node and a fresh Node 22 install meet Astro's `engines` floor of 22.23.4 (fact-check row 178), so `.nvmrc` stays `22`, and the book's own `engines` names that floor.

**T3's re-check (2026-11-19).** `remark-directive` 4.0.0 and `unist-util-visit` 5.2.0 are still the latest releases, and T3 installs both with `unified` 11.0.5 and `remark-parse` 11.0.0, which its book index uses to parse chapters. Its type-only dependencies take `mdast-util-to-hast` 13.2.1, because 13.2.2 came out on 2026-11-13, under a week before. None of the new packages has an install script (fact-check rows 233–236). `check:book` now runs T3's checks instead of `astro sync`.

### BK4. `apps/*` joins the workspace as `@buildanagent/manual` (proposed)

Whichever of [L5](../todos/ready/L5-docs-app.md), [L7](../todos/ready/L7-website-app.md) or T1 lands first adds `apps/*` to `pnpm-workspace.yaml` ([DS2](publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted)), so T1 adds it only if it is missing. T1 creates `apps/manual/package.json` as a private package named `@buildanagent/manual`, the naming `apps/docs` and `apps/site` use, with exact pins, Astro 7.4.11 shared with `apps/docs`, and these scripts:

- `build`: `astro build && pagefind --site dist`;
- `check:book`: the content checks of BK5–BK9;
- `typecheck`: `tsc -p tsconfig.json`;
- `test`: Vitest over the remark and rehype plugins, the checks and the figure staleness test.

The root's `pnpm typecheck` and `pnpm test` then cover the book with no change to CI's existing steps. The book declares the runtime packages it imports and takes TypeScript, Vitest and Biome from the root, as the [workspace rule](../../AGENTS.md#coding-standards) requires.

**Why not Starlight, like the docs.** Starlight suits reference docs: a sidebar of pages, search and a fixed page layout ([DS1](publish-and-docs.md#ds1-starlight-docs-with-a-generated-api-reference-accepted)). The book needs what Starlight does not give: numbered chapters, figures and listings computed from an outline, citations and glossary links checked at build time, interactive listings, and the owner's chapter layout with side notes and a figure stepper (BK12). Plain Astro with the unified pipeline (BK3) keeps that layout free, as the publish-and-docs plan keeps `apps/site` free of Starlight's layout. Three things could be shared later, once all three apps exist: the font files and their notices, a small set of colour tokens if the website adopts the book's palette, and the Pagefind search, which Starlight also uses.

### BK5. The outline lives in code, and the build computes every number (proposed)

**Choice.** `apps/manual/src/outline.ts` lists the parts and, for each, the chapter slugs in order. A chapter file lives at `src/content/chapters/<slug>.md`, and its URL is `/<slug>/`. The build derives the chapter number from the slug's position in the outline, and a rehype plugin numbers figures, listings and tables in the order they appear (Figure 3.2, Listing 3.4). Authors refer to them by id, `[[fig:tool-call-round-trip]]`, and the build replaces each reference with a numbered link; an unknown id fails the build. A chapter in the outline whose file is missing shows as plain text in the contents, as in the garment book.

**Why.** Slugs without numbers let a chapter move without breaking a link. The garment book's numbered slugs needed about fifty redirect entries after four renumbering todos (`astro.config.mjs` at commit `bca44b0`; fact-check row 21).

**The chapter contract.** A strict zod schema checks the front matter: `title`, `summary`, `opening` (BK22), `sources`, `glossary` and `switchTo` (BK8). A `check:book` script applies the same rules before the build, so passing the check means passing the build. The contract is lighter than the garment book's nine fixed sections, which its `scripts/check.py` enforces. Each chapter opens with its planned opening type (BK22), says within its first section what the reader will build or learn, and ends with exercises and its sources.

**T3's result (2026-11-19).** A chapter marks a numbered block with a container directive, `:::figure[Caption]{#id}`, `:::table[…]{#id}` or `:::listing[…]{#id}`, and the build numbers it from the outline and its order in the chapter. Every block needs a caption, a table must hold a table and a listing a code block, and ids are unique across the book for each kind. The build reads every chapter's blocks before it renders any page, so a reference into another chapter gets that chapter's number, and `astro.config.mjs` clears the content cache when any chapter's blocks or its body's line offset change. A reference to a planned chapter shows its number without a link. The contract checks three things by machine: the strict schema, the opening type that the outline plans, and a last `##` section named "Exercises" that holds a list; the layout adds the source list after it. Each written chapter must also have its fact-check log, `apps/manual/fact-checks/<slug>.md` (BK21), whose README gives the row format. Whether the first section says what the reader will learn stays a reviewer's call. `check:book` loads the book and renders every chapter through the build's own plugins, so the check and the build cannot disagree.

### BK6. A source register tied to our fact-checks, with citations that fail the build (proposed)

**Choice.** `apps/manual/src/data/sources.json` holds one entry per source:

- `id`, a stable kebab-case name such as `claw-swe-bench`;
- `title`, `url` and `kind` (docs, repo, paper, spec or post);
- the version, tag or access date, written "as of <month year>";
- `verifiedIn`, the repository path of the fact-check log or reference that checked the source;
- `secondary: true` when that check rests on a search summary or a secondary write-up.

Chapters cite with `[@claw-swe-bench]`, which the build turns into a link to `/sources/#claw-swe-bench`. An unknown id fails the build, as in the garment book's `remark-citations.mjs`. A second check fails when a `verifiedIn` path is missing or does not contain the entry's URL. The register can therefore hold only sources that one of our [fact-check logs](../research/fact-check-2026-11-18.md) or reference fact-checks verified. A chapter that needs a new source adds a fact-check row first, in the chapter's own fact-check file.

**Why.** The repo's documents cite inline and keep their evidence in fact-check logs; only the [harness teardown](../research/harness-architectures.md) has a sources section. Pointing the register at those logs keeps the book's claims as checked as the documents it draws on.

**T3's result (2026-11-19).** Each entry also names its `publisher`, and `asOf` holds the month and year, such as "November 2026", with an optional `version`. Several sources share one bracket as `[@a; @b]`. A citation's id must also be in the chapter's `sources`, and the page shows it as the source's position there, `[1]`, which matches the chapter's numbered source list. The `verifiedIn` check reads every URL in the log, whether in an inline link, a bare URL or a reference-style definition, and compares whole URLs, so a log that cites `…/sandbox/pricing.md` does not verify `…/sandbox`. `verifiedIn` must also name a fact-check log: a `fact-check*.md` under `docs/research/` or `docs/plans/reviews/`, a `docs/reference/<sdk>/fact-check.md`, or a chapter's log in `apps/manual/fact-checks/`. The register starts with the eight sources the seed glossary cites.

### BK7. A glossary kept as data, with first uses linked (proposed)

`apps/manual/src/data/glossary.json` holds each term's definition, its aliases and its source ids. A remark plugin, adapted from the garment book's `remark-terms.mjs`, links the first use of each term in a chapter to `/glossary/#<term>`, with a hover card and `aria-describedby` text. The check fails when a chapter tags a term that has no entry, or when a definition cites an unknown source. The glossary reuses the repo's own terms (loop, harness, gateway, session log, interceptor, approval, sandbox), so one term means one thing across the book and the guides.

**T3's result (2026-11-19).** A chapter tags a term by listing its id in its `glossary` front matter, and only tagged terms link, so an everyday word such as "loop" links only where a chapter asks for it. A tagged term that the chapter's text never uses fails the check, as does a tag that names no glossary entry. The seed glossary holds twelve terms: agent, agent loop, workflow, harness, session log, model gateway, approval, guardrail, sandbox, prompt injection, the lethal trifecta and MCP, each citing a register source (fact-check rows 245–256). "Interceptor" waits for the events-and-hooks chapter, because no fact-check log yet cites a web page that defines it; the logs check LangChain's and Copilot's hooks against their mirrored files instead (row 257).

### BK8. Code from `verify/` now, our own SDK as its todos land (accepted)

**The owner's decision (2026-11-19):** "Code: the verified SDK examples in verify/ now (they are type-checked and run offline against mock models); switch chapters to our own SDK (packages/) as its todos land."

Every harness's `test` script runs `tsc -p tsconfig.json` over `examples/**/*.ts` and then runs each example ([`verify/vercel-ai-sdk/tsconfig.json`](../../verify/vercel-ai-sdk/tsconfig.json); fact-check row 11). CI's `pnpm typecheck` and `pnpm test` run both on every push. Each chapter's front matter lists in `switchTo` the todos whose code will replace its listings, for example B11 for the loop chapter. A `book:switch-report` script lists the chapters whose `switchTo` todos have reached `docs/todos/done/`. When the last of a chapter's `switchTo` todos is done, that todo's pull request opens a follow-up todo to move the chapter's listings. As T4 built it, a listing must come from a harness in `apps/manual/src/data/harnesses.json`, so that follow-up todo first widens the rule to name `packages/` (BK9's T4 result).

### BK9. Listings come from real regions and become interactive in three tiers (accepted; the mechanism is proposed)

**The owner's addition (2026-11-19):** code blocks should be interactive, in tiers built "from the same real file regions so they stay checked in CI". The three tiers below, and live editing as a later fourth, are the owner's decision; how each is built is our proposal.

**The static listing.** A chapter includes code with a directive:

```md
::listing[The loop runs until the model answers]{#tool-loop file="verify/vercel-ai-sdk/examples/02-tool-loop.ts" region="loop"}
```

The example file marks the region with `// #region loop` and `// #endregion` comments, which change no behaviour. The build reads the file, cuts the region, strips the markers and highlights it with Shiki, which ships with Astro. It shows the listing number, the path, the line range and the pinned version of the SDK, read from that harness's `package.json` (for example `ai@7.0.162`). The check fails when the file, the region or the package is missing, or when the file lies outside a `tsconfig.json` that `pnpm typecheck` runs.

**T4's result (2026-11-19).** The directive takes a caption, like every numbered block: `::listing[Caption]{#id file="…" region="…"}`, and without `region` it shows the whole file. The book index resolves every listing when the book loads, so `check:book` and the build each report a broken one as a single problem with the chapter's file and line. The coverage check reads the file's nearest `package.json`, which must match a `pnpm-workspace.yaml` glob that no `!` glob cancels, and asks TypeScript, through `tsc -p <config> --listFilesOnly`, whether a config in that package's `typecheck` script holds the file. A table in `apps/manual/src/data/harnesses.json` names each harness's main package. Five rules are our choices, beyond what this section states: the pin must be exact, the file must be TypeScript, `file` must be a plain path from the repository root that no symbolic link leads out of, the file must sit in a harness the table lists, and the directive takes no attribute but `id`, `file` and `region`. The harness rule means a listing from `packages/` fails as "in no harness", so the todo that switches a chapter to our own packages (BK8) must widen it first. Shiki tokenises the lines with its CSS-variables theme, and the page renders them in the `ListingBlock` markup, so each line keeps its number in the file and the panel keeps the design tokens' colours. The regions §4.1 names for Part I are marked in all eight harnesses; the capstones are listed whole. `book:switch-report` prints each written chapter's `switchTo` todos and which are done, and the manual's `test` runs it as a report that never fails.

**Tier 1, annotated lines.** The example file marks a line with a `// book:note <id>` comment, and the chapter supplies the note for each id. On the page, a numbered marker highlights the line and shows its note. Without JavaScript the notes appear as a numbered list under the code. An unknown or unused id fails the check. Because the marker sits on the line itself instead of a counted line number, a note stays in place when the file changes.

**Tier 2, SDK tabs.** A `:::tabs` block holds several listings of the same concept from different harnesses, such as a tool approval in the AI SDK, the OpenAI Agents SDK and LangChain. Each tab shows its own path and pin. Without JavaScript the tabs render one after another under their own headings.

**Tier 3, a recorded run.** A transcript recorder in each harness's mock model layer saves, for each example, the messages it sent and received and the results of its own `check()` calls. It writes them to `verify/<sdk>/results/transcripts/<example>.json`, with ids and timings normalised. `pnpm test` regenerates the files, and CI's results-drift check fails when a committed transcript differs from the regenerated one. The page steps through the transcript beside the listing, with no network and no key. Because CI regenerates the transcript from the same file, the replay cannot drift from the code. The harnesses mock at different layers, from `MockLanguageModelV4` for the AI SDK to a mock Messages API for the Claude Agent SDK, so T5 builds the recorder per harness, starting with the ones Part I uses most.

**Tier 4, live editing (later, not in Round T).** A reader could edit a listing and run it in the browser against our SDK's `ScriptedModel`, which lives in `@buildanagent/sdk/testing` and implements the gateway's adapter type (fact-check row 12). Another route is a WebContainer or StackBlitz embed. Each has costs: the first needs a browser build of our SDK and a sandboxed worker for user code; the second loads a third-party runtime and sends the page's code to another origin, which the content security policy must then allow. Both stay safe for the same reason: the scripted model never calls a provider, so no provider key has to reach the browser. A later todo weighs them once our SDK ships.

### BK10. Flat diagrams and a few isometric centerpieces (accepted)

**The owner's decision (2026-11-19):** "Figures: a mix of flat SVG diagrams and a few interactive isometric centerpieces (our repo has the 'anatomy' skill for isometric SVG figures)."

Three chapters get a centerpiece: the agent loop (T10), the session log as a tree (T20) and the permission pipeline in front of the sandbox (T22). **The owner's decision (2026-11-19): keep them separate.** Each centerpiece stays an exact technical diagram with real labels: context, model call, `tool_result` and append in T10; the session-log tree in T20; the permission pipeline, sandbox and egress allowlist in T22. The analogies get their own flat illustrations, placed just before the centerpiece: T10's kitchen ticket rail and T22's lab glovebox (BK22). Every other figure is a flat diagram.

The anatomy skill is installed for the owner's agents but not committed under [`.agents/skills/`](../../.agents/skills/README.md) on `main` as of 2026-11-19. It is MIT-licensed, from `wheresryan22/anatomy` (fact-check row 13). **The owner approved vendoring it (2026-11-19): "yes".** T7 copies it at commit `1482e84` into `.agents/skills/anatomy/`, keeps its LICENSE and NOTICE, and adds a THIRD-PARTY-NOTICES.md entry.

### BK11. Generated, checked, inlined figures that work without JavaScript (proposed)

**Flat figures.** Each lives in `apps/manual/figures/<chapter>/<figure>.ts`, a script that writes an SVG with a small helper module adapted from the garment book's `svgkit.py`. Fonts are embedded as a subset data URI, and drawing a glyph outside the subset throws, which prevents silent missing glyphs. A Vitest staleness test redraws every figure and fails when a committed SVG differs byte for byte, as the garment book's `figure_staleness.py` does. The build inlines each SVG instead of loading it in an `<img>`, so the figure's colours come from the page's CSS custom properties and follow the light and dark themes.

**Isometric figures.** Each is built with the vendored anatomy skill. Before a chapter embeds one, `node build.mjs --audit` must print `audit passed`, and `scripts/lines.mjs` must print `line ends: 0` on the light and dark pages ([anatomy, verify][anatomy]). These checks need headless Chrome, so they run in CI's book job (BK14).

**Interactive figures, and rules for every figure.** An interactive figure is an HTML fragment inlined in the chapter, with no iframe and with its ids prefixed. Its first paint is a complete static figure, and scripts only add motion and controls. Every figure needs alt text and a caption, or the build fails, and a figure's facts cite the register like the prose does. No figure is AI-generated, and a source image is copied only when its licence allows; otherwise we redraw it.

### BK12. The owner picked direction C's layout, C4's page colours and panels that follow the theme (accepted)

**The owner's decision (2026-11-19):** three directions were on a canvas: "A Field Manual: IBM Plex, sidebar + numbered margin notes; B Lab Notebook: serif column, Try-it boxes; C Blueprint: dark, grid-paper isometric." The owner then liked C's layout with warmer colours and other fonts, and four warm variations of C joined the canvas: C1 Ember, C2 Terracotta, C3 Desert Dusk, and C4 Clay and Cream.

**The pick (owner, 2026-11-19).** The reference page is the board "Reference design" on the owner's design canvas, a private page. It sets the layout, the type, the page colours for both modes and the panel colours.

- **Layout:** direction C's header, wide title, a figure panel with the isometric stepper, an article column with side notes, and previous and next links.
- **Type:** headings in Instrument Serif, body text in Literata and code in Google Sans Code. All three are on Google Fonts under the SIL Open Font License 1.1 (fact-check rows 63–65).
- **Page colours:** C4 Clay and Cream in light mode, and C4's brown page in dark mode.
- **Code and figure panels follow the theme (owner, 2026-11-19: "approved those colors"; canvas board "Panels that follow the theme: light and dark").** In light mode a panel is one shade darker than the cream page, framed by the light rule as a border, with deeper syntax colours. In dark mode it is C1 Ember.

| Token | Light page (C4) | Dark page (C4) | Light panel | Dark panel (C1 Ember) |
| --- | --- | --- | --- | --- |
| Background | `#FAF3E8` | `#2A1E16` | `#F3EADB`, bordered by `#E4D6C2` | `#17110D` |
| Text | `#2A1E16` | `#F4EADC` | `#2A1E16` | `#F2E8DC` |
| Soft text | `#4A3B2F` | `#D9C9B6` | none | none |
| Muted text | `#5E4E40` | `#B8A794` | comment, labels and line numbers `#6B5B4D` | comment `#A8968A` |
| Rule or grid | `#E4D6C2` | `#45352A` | grid `#EADFCC` | grid `#251B14` |
| Accent | `#B04E29` | `#E8A27C` | keyword amber `#8A4F00`, string olive `#4B5E1F`, highlight terracotta `#A3401C` | amber `#F2A541`, olive `#C9D68E`, terracotta `#E2704B` |
| Link | `#8A3519` | `#F2C2A4` (owner, 2026-11-19) | none | none |

Every text colour in the table meets WCAG AA (4.5:1) on its background. The lowest are the light accent, 4.80:1, and the light panel's terracotta highlight, 5.32:1 (fact-check rows 67 and 123). The two rule colours reach only 1.30:1 and 1.39:1, and the two grid colours 1.11:1, so they stay decorative: dividers, panel borders and grid lines, never text, focus rings or figure lines that carry meaning. The light panel sits 1.08:1 from the page, so its border, not its fill, marks its edge. The owner chose `#F2C2A4` for dark-mode links (2026-11-19): 10.05:1 on the dark page, and a paler shade than the accent, so links and accent labels differ as they do in light mode. Neither link colour is 3:1 apart from body text, so links keep an underline in both modes.

The table lives as data in [`docs/design/book-tokens.json`](../design/book-tokens.json), with each contrast ratio recorded beside its pair; the JSON file is the source of truth, and this table restates it. T2 generates the CSS custom properties from that file and builds the components: the page layout, contents and sidebar, listing block, tabs, annotation markers, replay controls, figure frame and stepper, side notes, glossary card, citation and search box. Google Fonts is where the font files come from, not where the page loads them. The book serves the files itself, so a reader's browser makes no third-party request.

**T2's additions, accepted by the owner (2026-11-19).** T2 could not open the reference board, so it proposed five kinds of token the table above did not carry and added them to `book-tokens.json`. The owner accepted all five the same day ("Keep all"; fact-check rows 211–218 and 224):

- **The dark panel's border** is `#45352A`, the dark rule, as the light panel's border is the light rule. Ember sits only 1.15:1 from the dark page, so without a border its edge would blur.
- **Focus rings** use the accent, which reaches 3:1 on every surface it can sit on: 4.80:1 on the light page, 4.44:1 on the light panel, 7.63:1 on the dark page and 8.81:1 on Ember.
- **Phone sizes** at 360 px: title 44, section 30, chapter link 22, lede 19, body 17, note 14, listing 13 and label 12 px. Each size scales linearly to its desktop value at 1280 px.
- **Layout widths:** a 1152 px page, a 608 px article column, a 240 px side-note margin and a gutter from 16 to 40 px.
- **The font files.** The code face is served as Manual Code, the neutral name its subsets need under Google Sans Code's `TRADEMARKS.md`.

The owner also kept Literata's name for its subsets (2026-11-19: "Keep 'Literata'"). Its OFL names no Reserved Font Name, and its folder in google/fonts has no `TRADEMARKS.md`, so only Google Sans Code needs a neutral name. Literata's trademark notice stays in its name table (fact-check rows 225–226).

`apps/manual/scripts/generate-tokens.ts` generates the CSS custom properties from the JSON file, and the app's tests recompute every recorded ratio from the colours the CSS ships ([`apps/manual/README.md`](../../apps/manual/README.md)).

### BK13. PDF and EPUB come later (proposed)

Round T ships the web book only. Because numbering, citations and listings are computed from data, a later export can reuse them: Astro can render one long page for a print stylesheet, or a script can build an EPUB from the same content collection. A later todo picks the tool once the chapters exist.

### BK14. One CI job builds the book and runs every check (proposed)

T8 adds `book-build.yml`, the build half of BK15's DS3 split, on GitHub-hosted runners, beside [`ci.yml`](../../.github/workflows/ci.yml). It runs on every pull request and push to `main` with no secrets, installs with `--frozen-lockfile` and runs `check:book`, the source and glossary checks, the listing checks and `book:switch-report`. It then builds the site, which fails on any unknown citation, reference, glossary term or missing caption, and runs the anatomy audits and line check in headless Chrome. The existing `checks` job already runs the book's typecheck and tests through the root scripts, and its results-drift step covers the transcripts. Any action the job adds goes into [`actions.lock`](../../.github/workflows/actions.lock) ([CI plan §3d](ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)). No step needs a secret or the network beyond the install, and the workflow uploads only `apps/manual/dist/` for the deploy workflow.

### BK15. An assets-only Worker on a custom domain, behind a guard and a switch (proposed)

**Configuration.** `apps/manual/wrangler.jsonc` names an assets-only Worker with no `main`, `assets.directory` set to `./dist`, and `routes: [{ "pattern": "manual.buildanagent.fyi", "custom_domain": true }]`. A custom domain makes the Worker the origin, and Cloudflare creates the DNS record and certificate ([Cloudflare, custom domains][cf-cd]). The config sets `not_found_handling: "404-page"`, as DS3's sites do, so a missing page serves the book's 404 page. It sets `workers_dev: false`, so the site has one production address. It also sets `preview_urls: true`. Previews are served on `workers.dev`, and a new Worker's preview setting starts from its `workers_dev` value, so without this line the previews would be off ([DS3](publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted)). The file is JSONC, where the docs and website use TOML, because "Cloudflare recommends using `wrangler.jsonc` for new projects, and some newer Wrangler features will only be available to projects using a JSON config file" ([Cloudflare, Wrangler configuration][cf-wcfg]). The guard reused from the garment book also parses JSONC with no dependency. Security headers, including a content security policy that allows only the site's own scripts, come from a `_headers` file in the assets directory, which Workers static assets support ([Cloudflare, headers][cf-headers]).

**Guard.** `apps/manual/scripts/guard-deploy.mjs`, adapted from the garment book's guard, refuses to deploy unless the config has exactly that route, no `main`, `assets.directory: "./dist"`, `not_found_handling: "404-page"`, `workers_dev: false`, `preview_urls: true` and a `_headers` file.

**Workflows: the build and deploy split of DS3 (owner, 2026-11-19: "We'll set up gh actions with cloudflare").** The book deploys from GitHub Actions with Wrangler, not through Cloudflare's Workers Builds. It follows the pattern the [publish-and-docs plan's DS3](publish-and-docs.md#ds3-workers-static-assets-and-a-preview-per-pull-request-accepted) sets for the docs and the website, so no pull request can edit the job that holds a Cloudflare token:

- **Build, `book-build.yml`,** on `pull_request` and pushes to `main`. It builds the book with no secrets, runs every book check, and uploads only `apps/manual/dist/` as an artifact. Nothing else in the artifact is trusted.
- **Deploy, `book-deploy.yml`,** on `workflow_run` after the build. GitHub always runs this workflow's definition from `main`. It downloads the artifact, takes `wrangler.jsonc`, `_headers` and the guard script from `main`, and never checks out or runs the pull request's code.
  - **Production:** only when the triggering run was a `push` to `main` from this repository (`github.event.workflow_run.event == 'push'` and `github.event.workflow_run.head_repository.full_name == github.repository`), and only while the repository variable `BOOK_DEPLOY_ENABLED` is `true`. The job runs in the `book-production` environment, in a concurrency group that never cancels a running deploy, and runs the guard before `wrangler deploy`.
  - **Every other run gets a preview:** `wrangler preview --name pr-<number>` in the `book-preview` environment. The job finds the pull request through `GET /repos/{repo}/commits/{head_sha}/pulls`, never from the artifact, and a closed pull request's preview is deleted with `wrangler preview delete`.

Because the secrets live only in the deploy workflow, a fork's pull request gets a preview too, and a fork's branch named `main` still gets a preview, never production. The guard and the deploy switch stay, as an extra check on the config read from `main` and a way to pause production without editing a workflow. Like every workflow, both have their actions locked in `actions.lock`.

**How the book's deploy differs from L8's.** [L8](../todos/ready/L8-cloudflare-deploys.md) deploys the docs and the website with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets that its plan scopes to no environment, and grants the token "Workers Scripts edit and Zone Workers Routes edit", wording that "L8 confirms" against Cloudflare's docs ([publish-and-docs §3](publish-and-docs.md#3-what-the-owner-sets-up)). The book keeps its tokens in the `book-preview` and `book-production` environments, which the owner created, and its tokens use Cloudflare's current role names: Account › Workers › Editor, plus Zone › Workers Routes › Write for production only (the table below). If L8 adopts the same names when it confirms its permissions, the three sites can share one token policy. This plan leaves the files of #35, the publish-and-docs pull request, unchanged.

**Previews.** Worker Previews need Wrangler 4.135.0 or later, Preview URLs are public by default, and `workers.dev` Preview URLs carry `X-Robots-Tag: noindex` while custom-domain ones do not ([Cloudflare, Previews][cf-previews]). Previews therefore stay on `workers.dev`, which `preview_urls: true` turns on independently of `workers_dev` ([Cloudflare, preview custom domains][cf-pcd]).

**What the owner sets up (owner, 2026-11-19: "we'll set this up").** The owner prepares both the Cloudflare side and the GitHub side before T9 deploys anything; T9 builds against these names and documents them, and does not create them.

| Where | Name | What it holds or allows |
| --- | --- | --- |
| Cloudflare | the buildanagent.fyi zone | In the account the tokens belong to |
| GitHub environment | `book-production` | Protected branches only (`main`); secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| GitHub environment | `book-preview` | Used by the deploy workflow's preview job, which runs from `main` on `workflow_run`; its own `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` |
| Production token (`book-production`) | An account-owned token with Account › Workers › Editor, plus Zone › Workers Routes › Write scoped to the buildanagent.fyi zone | Custom domains need the zone permission and do not yet support per-Worker roles. Once the domain is attached, deploys need only Editor, so the zone permission can be removed until the domain changes |
| Preview token (`book-preview`) | An account-owned token with Account › Workers › Editor, scoped to the book's Worker, and no zone permission | `wrangler preview` serves previews on `workers.dev` |
| The book's Worker | Created once by the owner, by hand, or by a first deploy with a short-lived Admin token | Editor cannot create a Worker, so the stored tokens never need Admin |
| GitHub variable | `BOOK_DEPLOY_ENABLED` | `true` turns production deploys on |

Both tokens are account-owned, the kind Wrangler needs for granular Workers permissions ([Cloudflare, authorization][cf-authz-root]). Editor "can read, update, deploy, and rename existing Workers" but "cannot create or delete Workers", and "creating a new Worker requires Workers Admin because per-Worker permissions can only apply to Workers that already exist" ([Cloudflare, Workers authorization][cf-authz]). Adding or changing a custom domain needs "*Zone* > *Workers Routes* > *Write*, scoped to each affected zone", and "Custom Domains do not currently support per-Worker roles". After the domain is configured, a deploy that leaves it unchanged needs only Editor (same page). Cloudflare's GitHub Actions guide uses the same two secret names, and advises scoping each token "as much as possible" ([Cloudflare, GitHub Actions][cf-gha]).

**Owner setup so far (2026-11-19).** The book's three GitHub environments exist: `book-preview`, `book-production` and `live-run`, the last for BK18's live run. `book-preview` and `book-production` each hold `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `book-production` and `live-run` allow only protected branches, which here means `main`, and `live-run` has the owner as required reviewer and holds `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (fact-check rows 113 and 124).

Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment ([Cloudflare, system environment variables][cf-env]). Each job's first step checks that its environment's secrets are set and fails with a message that names the missing secret and points to `apps/manual/README.md`, so a half-finished setup never deploys.

### BK16. Reuse the garment textbook's code, credited, without its personal data or rules (accepted, ADR 0054)

**The owner's decision (2026-11-19):** the owner owns `tajistudios/garment-engineering-textbook`, a private repository our credentials can read, and said its code may be reused, credited in [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md). Its committed personal data (reader emails, Access IDs) and its `CLAUDE.md` rules are never copied.

The repository has no licence file, so its code is reusable only under this permission (fact-check row 20). We read it at commit `bca44b0` on 2026-11-19. The list below is Proposed; ADR 0054 records the permission, the licence and the exclusions, not the list:

| Reuse (adapt and credit) | Book todo |
| --- | --- |
| `src/lib/markdown/remark-citations.mjs` with `src/lib/citations.mjs` and `split-text.mjs` | T3 |
| `src/lib/markdown/remark-terms.mjs` with `src/lib/terms.mjs` | T3 |
| `src/lib/markdown/rehype-figures.mjs`, extended with automatic numbering and inline SVG | T6 |
| The strict content schema in `src/content.config.ts`, and its rule that the check and the build agree | T3 |
| The render-input hash in `astro.config.mjs` that clears Astro's content cache when a plugin or its data changes | T1 |
| `scripts/figures/svgkit.py`'s font subset and glyph check, ported to TypeScript | T6 |
| `scripts/guard-deploy.mjs`'s JSONC parser and its problem list, rewritten for a public assets-only Worker | T9 |
| The deploy workflow's never-cancel concurrency, deploy switch, uncached install and fresh `$HOME` | T9 |

| Avoid | Why |
| --- | --- |
| Hand-numbered chapters and figures | Renumbering cost four todos and about fifty redirects (BK5) |
| The nine fixed chapter sections | Its own rewrite plan (`docs/plans/chapter-rewrite-plan.md`) found that the fixed names break its writing rules |
| `CLAUDE.md` rules | The owner excluded them; our rules live in [AGENTS.md](../../AGENTS.md) and in tooling |
| Committed reader emails, Access application IDs and AUD tags | Personal and account data; the owner excluded them, and our book has no sign-in |
| The Access-checking Worker and `jose` | The book is public (BK2) |
| Deploy secrets on self-hosted runners shared with pull-request code | The garment repo flags this risk itself; we deploy from GitHub-hosted runners in environments |
| The offline service worker | Out of scope (§1) |
| Python scripts | Our tooling is Node and pnpm, so the checks are ported to `.mjs` or `.ts` |

**Licence (owner, 2026-11-19):** code copied or adapted from the garment repository is published here under "Apache 2.0", not under our usual Apache-2.0 OR MIT. T1 adds that exception to [LICENSE](../../LICENSE). T1, T3, T6 and T9 add each file they copy to a garment-repository section of THIRD-PARTY-NOTICES.md. Each derived file opens with a header comment that names its origin, the source path and commit, and its Apache-2.0 licence. No book todo reads the garment repository's `docs/todos/` or deploy config, where its personal data lives.

### BK17. Code in the prose is checked like code in a listing (accepted)

**The owner's decision (2026-11-19):** code in prose is checked. An API identifier in inline code in a chapter must resolve to one of three things:

- a symbol or string in a listing the chapter includes;
- a value in that example's recorded transcript (BK9, tier 3);
- an export in the pinned SDK's `.d.ts`.

Otherwise it must carry an explicit hand-checked marker that cites a row of the chapter's fact-check log. The build fails on an unresolved identifier. Prose claims about behaviour, such as what a call returns or when a loop stops, go through the chapter's fact-check log like any other claim.

**How (proposed).** T26 adds a remark plugin that collects each inline-code span that looks like an identifier, such as `generateText`, `stopWhen` or `maxTurns`. It resolves the span against the chapter's listings, their transcripts and the `.d.ts` files of the packages those listings import, read from the harness's `node_modules`. The marker is a suffix, `` `maxBudgetUsd`{checked=row-12} ``, which the build checks against the chapter's fact-check file. File paths, shell commands and plain values skip the check through a short, tested list of patterns, so the rule stays strict for API names.

### BK18. An occasional live run compares real flows with the mock transcripts (accepted)

**The owner's decision (2026-11-19):** CI never calls providers or holds keys. A manually triggered workflow runs selected examples against the real APIs and records live transcripts beside the mock ones. A script then reports differences in flow, meaning the tool calls made, the stop reason and the `check()` results, rather than differences in text. A difference in flow opens an issue; it never fails CI. Every page with a listing states that its listings are verified against mock models, and gives the date of the last live comparison.

**Keys and cost (owner, 2026-11-19).** The run uses two providers. The owner first chose both keys, then Anthropic only ("actually, we'll only be using the ANTHROPIC_API_KEY"), and then added the OpenAI key as well: "I'll add the OPENAI key too - added". The protected `live-run` environment now holds two environment secrets, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, which the owner added; no key passes through chat, a file or a log. The GitHub environments `book-preview`, `book-production` and `live-run` already exist, so T9 and T27 rely on those names (fact-check row 113).

On cost, the owner said: "A run may cost at most $1, but should aim to be less than $.50". T27 enforces a hard cap of $1.00 per run before each model call, from the projected cost (price catalog plus token estimate, as D9 and E5 do), and aborts the run with a report when the next call would cross it. Examples, models and `maxTokens` are chosen to keep a run under $0.50, and the run's report shows the amount spent against the cap.

**Which harnesses can run live, and on which provider.** Read from each `verify/*/package.json` and the reference guides (fact-check row 112):

| Harness | Anthropic path | OpenAI path | Live run |
| --- | --- | --- | --- |
| `claude-agent-sdk` | Native: the bundled CLI calls the Messages API | None | Anthropic |
| `openai-agents-sdk` | None pinned: `@openai/agents-extensions` adapts AI SDK models, but no Anthropic provider is pinned | Native, `@openai/agents-openai` 0.21.0 | OpenAI |
| `copilot-sdk` | BYOK `provider: { type: "anthropic" }`, the route the harness's mock already uses | BYOK `provider: { type: "openai" }` | Either; BYOK needs no GitHub sign-in, and the live job runs without the harness's no-network namespace |
| `vercel-ai-sdk` | `@ai-sdk/anthropic` 4.0.96 | `@ai-sdk/openai` 4.0.108 | Either |
| `cloudflare-agents` | `@ai-sdk/anthropic` 4.0.96 | `@ai-sdk/openai` 4.0.108 | Either, from its workerd test setup |
| `langchain` | `@langchain/anthropic` 1.6.0 | `@langchain/openai` 1.8.0 | Either |
| `pi` | `@earendil-works/pi-ai` 1.5.2's Anthropic Messages API | the same package's OpenAI Responses and Completions APIs | Either |
| `google-adk` | None | None: TypeScript 2.5.0 has only the built-in Gemini model and lacks the LiteLLM connector | Mock only; a run would need a Gemini key or a new dependency |

A listing from `google-adk`, or any example left out of the live list, says "verified against mock models only". Adding a provider package or a credential to make one runnable live is a separate change the owner approves, not part of T27.

**How (proposed).** T27 adds `live-run.yml`, triggered only by `workflow_dispatch` and never by `pull_request`. Its one job references the protected `live-run` environment that holds those keys. The environment requires the owner's approval and allows only `main`. GitHub releases an environment's secrets to a job only after a required reviewer approves it ([GitHub, environments][gh-env]). Each harness gains a live mode that points the example at the real API with that key, writes `results/live/<example>.json` in the transcript format, and still runs the example's own `check()` calls. `scripts/ci/live-diff.mjs` compares each live transcript's flow with its mock transcript. On a difference, the workflow opens an issue instead of failing. Either way, it opens a pull request with the live transcripts and the run date, as `sdk-updates.yml` does for SDK releases. The listing component reads that date. Until the first live run, it says that no live comparison has run yet.

### BK19. Every topic group gets a home, and four topics get research first (accepted)

**The owner's decision (2026-11-19):** cover all four topic groups of the coverage review, with nothing made a non-goal. The review read our repo against eleven outside sources, including Anthropic's engineering posts, OpenAI's practical guide, 12-factor agents, the OWASP lists and the MCP and A2A specifications. It found topics missing from the outline or thin in it.

- **New chapter.** "Agents people can watch: UIs, browsers and taking over" (T35) follows the permissions chapter, because the browser research makes the network and the credential the boundary. It draws on the [browser-use report](../research/browser-use/browser-use.md), including its watch-and-take-over section, and the [agent UI research](../research/agent-ui/agent-ui-research.md).
- **Added to existing chapters:**
  - planning patterns and subagents go to T17;
  - guardrails and prompt injection go to T14, and the lethal trifecta to T22, with [agent guide §5][g-agent] and `verify/openai-agents-sdk/examples/04-guardrails.ts`;
  - model choice and the system prompt go to T11;
  - rollout stages and the kill switch ([agent guide §7][g-agent]) go to T25;
  - triggers and ingress go to T24;
  - prompt caching goes to T18;
  - reasoning and thinking blocks go to T11 and T18, with the [harness plan's HD3](build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional) prefix check;
  - skills go to T21, and LLM-as-judge to T25.
- **Research first.** Retrieval and long-term memory (U18), A2A (U19), voice and realtime (U20), and fine-tuning versus prompting (U21) each get a research todo. These IDs are the next free U numbers: U17, the source-update research, is the highest, merged to `main` through #36 (`ea70a57`). §4.3 gives each topic's placement and the reason for it.
- **Reordering and rebalancing.** Memory now comes before approvals, so a safe resume rests on saved state. Connector OAuth moves from T21 to T22, after the credential boundary. Mock models get a box in T10. Cost moves from T25 to T18, identity from T23 to T12, and T16 shows one capstone in full with the rest as tabs.
- **Contradictions resolved.** T24 says "the seven seams of ADR 0033 plus `EffectStore` from ADR 0043". T23 says four failure outcomes plus `applied`, reconciling the [server rollback report](../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body) with [SG3](close-sdk-gaps.md#sg3-a-write-reports-one-of-five-outcomes-and-unknown-is-never-retried-with-a-fresh-key-accepted). T21 cites the [MCP 2026-07-28 changelog][mcp-cl] for multi round-trip requests (`input_required`) and the deprecation of Roots, Sampling, Logging and dynamic client registration.

### BK20. New `verify/` examples fill the gaps the coverage review found (accepted)

**The owner's decision (2026-11-19):** "New verify/ examples". The review read the named examples' headers and found seven chapters whose listings did not show their subject, and the code review of the plan found three more. Sixteen todos, T28–T34 and T40–T48, each write a type-checked, mock-run example in an existing harness, and each chapter waits for its example:

- streaming with usage for T11;
- retries, caching and a budget for T18;
- deferred tools and skills for T21;
- an SDK-enforced sandbox or permission behaviour for T22;
- failing writes, idempotency and a crash for T23;
- durability across a restart for T24;
- tracing and an LLM judge for T25;
- a subagent with its own context for T17;
- a computer-use tool against a fake computer for T35;
- retrieval over a small fixture for T36, after the retrieval research (U18);
- storing, recalling and expiring a fact across runs on LangChain's store, for T36 (T43);
- context-block memory that survives eviction on Cloudflare, for T36 (T44);
- delegation to a remote agent over A2A on ADK, both ends offline, for T37 (T45);
- an OpenAI realtime session on the SDK's scripted transport, for T38 (T46);
- a chained voice pipeline with a tool and barge-in on Cloudflare, for T38 (T47);
- an A2A 1.0 example, held until an SDK we pin ships 1.0 support, for T37 (T48).

**Amended by the owner on 2026-11-19.** U18's report proposed twelve plan changes, and the owner approved all twelve on 2026-11-19 ([retrieval and memory report][u18-changes]). Four of them change this plan. T41 now writes BM25 by hand over a fixture of about ten documents and asserts four behaviours, with a hybrid variant optional and labelled as a stand-in. T43 and T44 are new, and T36 waits for both. T36's second section adds retrieval measurement, and its third adds the rule that the agent checks a recalled record against its source before acting on it. Its exercise now shows the expired fact still in the session log.

**Amended again by the owner on 2026-11-19 (owner decision 2026-11-19).** The A2A report (U19) proposed seven changes, the voice report (U20) eight and the fine-tuning report (U21) six, and the owner approved all 21 that day ([A2A][u19-changes]; [voice][u20-changes]; [fine-tuning][u21-changes]). Nine of them change this plan, three from each report:
- **New examples.** T45 runs both ends of A2A on ADK in one process, and adds `@a2a-js/sdk` 0.3.14 as a direct dependency of `verify/google-adk`. T46 runs a realtime session on OpenAI's scripted transport, with a runner change so our own realtime example runs. T47 runs a voice pipeline on Cloudflare.
- **A held example.** T48 shows A2A 1.0 once ADK merges its pull request #1365 or OpenAI releases `@openai/agents/a2a`.
- **T28's scope.** T28 also prices a tuned model against a cached prompt, giving T39 its listing, instead of a new todo.
- **The three sections.** T37, T38 and T39 each stay one section, with the scope their reports recommend, and wait for their examples: T37 for T45, T38 for T46 and T47, and T39 for T28. T37 and T39 each gain a second break note. T38's break note is replaced: "the agent must stop speaking at once, decide for each tool in flight whether it finishes or is undone, and forget the words the caller never heard". The analogies themselves are unchanged, so BK22's count stays 61.
- **A correction.** MAP's 70% describes 14 of 20 interviewed teams, not a survey. Rows 105 and 174 of the [fact-check log](reviews/fact-check-build-book.md) stay as written, and new rows at its end record the correction.

Where no SDK can show a behaviour offline, the example todo records the limit instead of faking one. That is the case for AWS and Vercel durability, which `verify/` cannot run. It is also why T40 drives a scripted fake computer through the pinned SDK's own computer-use tool: no harness runs a real browser, and adding one is a new dependency and a host-touching tool, a separate change the owner approves.

### BK21. Every section is fact-checked before the next is drafted (accepted)

**The owner's rule (2026-11-19):** "We'll always write copy with /writing and review with /writing-review and fix any issues from that review. As well, we should always run a fact check after each chapter/section is written."

Every chapter, section todo and research report follows these steps in order:

1. Draft one section with `/anthropic-skills:writing`.
2. Fact-check every claim in that section against its primary source into the chapter's log, `apps/manual/fact-checks/<slug>.md`, as ✅, ✏️ or ⚠️, and commit the section with its rows before drafting the next section.
3. When every section is drafted, review the whole chapter with `/anthropic-skills:writing-review`, with BK22's voice check.
4. Fix every finding with `/anthropic-skills:writing`.
5. Re-check every claim a fix touched, and log the re-checks.

[AGENTS.md](../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges) carries the per-section rule for every long document in the repo.

### BK22. Lively writing: varied openings, distinct analogies and illustrated analogies (accepted)

**The analogies are approved (owner, 2026-11-19):** "analogies are okay". The owner reviewed the 61 analogies proposed for the 18 chapters and three sections (§4 and each chapter todo) and kept them, with three replacements the owner gave the same day after the plan's code review found near-duplicates. Compaction becomes "a TV show's 'previously on' recap", so the desk stays with the context window alone. The unknown outcome becomes "a dropped phone order: the line cuts out mid-order and you can't tell whether the restaurant got it, so you check before ordering again", so the parcel's tracking history stays with tracing alone. A third answer the same day, after the code review's second round, replaced the hotel key card for identity from trusted context with passport control: "a border officer who reads your passport, not what you claim at the desk"; the valet key stays with the credential boundary. The count is still 61, and every analogy is still distinct. If a later vetting finds an analogy misleading, the builder drops it or proposes a replacement to the owner, rather than changing it.

**The owner's rules (2026-11-19):** "We'll also need to make the writing not dry, and whenever we can use an analogy to explain a concept, let's lean on that. And also add illustrations for our analogies as needed." And: "don't repeat openings often, or analogies." For the book these rules take precedence over the writing skill's limit of one metaphor per passage.

**Analogies are optional (owner, 2026-11-19):** "For analogies, we don't have to use one for every chapter/concept". A chapter uses an analogy only where it makes a concept clearer, and a chapter may have none. So the 61 approved analogies form a pool: a chapter may drop a planned analogy when plain explanation works better, but adding a new analogy or swapping one in still needs the owner. The rules below still hold for every analogy a chapter uses, and the openings still rotate.

- **Analogy, then mechanism.** A concept that uses an analogy opens with one concrete, everyday image, followed at once by the precise mechanism. The analogy introduces; the technical text carries every fact, and facts still need sources. An analogy needs no source, but it must not mislead.
- **Where the analogy breaks.** Each analogy gets a short note saying where it stops being true.
- **One analogy per concept, never reused.** A concept keeps its analogy through the chapter, with no mixed metaphors, and an analogy explains one concept only, across the whole book. A later chapter may refer back to a concept's analogy by name but may not invent a near-duplicate. A register, `apps/manual/src/content/analogies.json`, lists concept, analogy, chapter, illustration and where it breaks. T3's check fails on a duplicate analogy or on an analogy reused for a second concept.

  **T3's result (2026-11-19):** a chapter marks each use of an analogy with `:analogy[label]{#id}`. The check also fails when the id is missing from the register, when a chapter names an analogy that a later chapter introduces, and when a concept gets a second analogy. It compares analogies and concepts without case, punctuation or a leading article. The concept check comes from this decision's own rule, "One analogy per concept", not from a new owner decision. No check can see near-duplicates, two phrasings of nearly the same image, so reviewers catch those when they vet a chapter's analogies. The register starts empty, because each chapter registers the analogies it uses.
- **Analogy illustrations.** These are a figure kind beside the technical figures, drawn in the book's design (tokens from [`docs/design/book-tokens.json`](../design/book-tokens.json)), flat or isometric under BK10 and BK11, with alt text, a caption and both themes. T6 and T7 add the kind. Analogy illustrations never double as technical figures: by the owner's decision of 2026-11-19, T10's kitchen ticket rail and T22's lab glovebox are separate flat illustrations placed just before those chapters' isometric centerpieces (BK10).
- **Openings vary.** A chapter opens with one of six types: a scenario, an incident, a question, a surprising fact, a piece of code or transcript, or an analogy. No two consecutive chapters share a type, and no type opens more than a quarter of the chapters; §4 assigns each type three times across the eighteen chapters. Sections vary their openings too.
- **A voice check in every writing review.** Beside the 5Cs, the review of each chapter scores the voice:
  - a vivid opening of the planned type, different from the previous chapter's;
  - a concrete example or scenario in every section;
  - varied cadence, and second person where it helps;
  - no stock phrasing repeated across chapters, such as the same sentence frames or the same transitions opening paragraphs.

  The pull request records the voice scores beside the 5C scores, before and after.

Each chapter todo lists its planned analogies with where each breaks and whether it gets an illustration, all distinct across the book. The owner approved the lists, and each chapter draws from its own.

## 3. Every chapter is written section by section, each fact-checked before the next

A chapter is a document, so it goes through the [five steps](../../AGENTS.md#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), with the owner's per-section rule (BK21): each section is fact-checked as soon as it is drafted, before the next one starts. Each chapter todo also starts with a research question, answered from the sources the todo names, so a chapter does not repeat a guide's structure for a reader the guide did not address. The writing review of a whole chapter adds the voice check of BK22 to the 5Cs.

## 4. Eighteen chapters, three research-fed sections, and a home for every topic

The owner's arc for Part I is "Call, then workflow, then loop" (BK1). Chapters appear below in reading order, which differs from todo order in two places: memory (T15) comes before approvals (T14), because a safe resume needs saved session state, and the two Part II chapters added on 2026-11-19, T35 and T36, sit where their subjects belong. Each row names the chapter's opening type, what it covers, the `verify/` examples it uses (new ones come from §5's example todos), and the todos whose code later replaces them. The chapter todos add the sources and a pool of planned analogies, distinct across the book, that a chapter uses where an analogy makes a concept clearer (BK22).

### 4.1 Part I: foundations, for developers new to agents

| # | Todo | Chapter (slug) | Opening | Covers | Examples | Switches to |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | T10 | Use the least autonomy that works: a call, a workflow, then a loop (`call-workflow-loop`) | scenario | One model call, then a fixed workflow in code, then the loop, in that order (agent guide §2; Anthropic's workflow patterns); The loop: a model calls tools until a stop condition holds; A box, "How these examples run without a key": every listing in the book runs against a mock model, explained in full in the testing chapter | `verify/vercel-ai-sdk/examples/01-generate-text.ts` (one call), `verify/google-adk/examples/02-workflow-agents.ts` (a fixed workflow), `verify/vercel-ai-sdk/examples/02-tool-loop.ts`, `verify/pi/examples/01-hello-session.ts` | B11 |
| 2 | T11 | Talking to a model: messages, streams, tokens, instructions and model choice (`talking-to-a-model`) | code | Messages, roles and a stateless call; Streams of deltas that fold into one authoritative message; Usage, the four token classes and cost; The system prompt: short and frozen (agent guide §4); Choosing a model: start with the most capable, then try smaller ones against evals (OpenAI guide); Reasoning and thinking blocks, and why they go back unchanged (SDK guide §2; harness plan HD3) | `verify/vercel-ai-sdk/examples/01-generate-text.ts`, `verify/vercel-ai-sdk/examples/06-streaming.ts`, `verify/langchain/examples/08-streaming.ts`, `verify/copilot-sdk/examples/05-streaming.ts`, the streaming-and-usage example from [T28](../todos/ready/T28-example-streaming-usage.md) | B4, B5 |
| 3 | T12 | Tools: schemas, validation, errors the model can read, and identity it cannot fake (`tools`) | incident | Schemas, validation and errors returned as data; Few, workflow-shaped tools with clear names and token-efficient results (Anthropic, writing tools); Identity from trusted context, not from the model (agent guide §3; moved here from the side-effects chapter) | `verify/openai-agents-sdk/examples/02-function-tool.ts`, `verify/google-adk/examples/01-function-tool.ts`, `verify/pi/examples/02-custom-tool.ts`, `verify/claude-agent-sdk/examples/02-custom-tool.ts` | B10 |
| 4 | T13 | Stopping: caps, stop conditions and structured output (`stopping-and-structured-output`) | question | Step and turn caps, and their defaults across the SDKs; Stop conditions and stop reasons; Structured output and what a schema does not guarantee | `verify/vercel-ai-sdk/examples/07-agent-stop-conditions.ts`, `verify/claude-agent-sdk/examples/04-max-turns.ts`, `verify/langchain/examples/06-recursion-limit.ts`, `verify/vercel-ai-sdk/examples/05-structured-output.ts` | B11, B14 |
| 5 | T15 | Memory within a task: sessions, threads and resuming (`memory-and-sessions`) | analogy | Sessions and threads; Saving and resuming a run, which the next chapter's approvals depend on; Where state lives in each SDK; long-term memory is a later chapter | `verify/openai-agents-sdk/examples/06-session.ts`, `verify/claude-agent-sdk/examples/06-resume-session.ts`, `verify/langchain/examples/05-thread-memory.ts`, `verify/google-adk/examples/04-sessions-state.ts`, `verify/cloudflare-agents/examples/01-state.ts` | N3, N6 |
| 6 | T14 | Asking before acting: approvals, guardrails and prompt injection (`approvals-guardrails-and-injection`) | fact | Approvals as a pause in a saved session (after the memory chapter); Approvals are one gate of several: guardrails on input and output (the OpenAI guide's guardrail types); Prompt injection basics: it cannot be prevented, only contained (OWASP LLM01 and LLM06; agent guide §5) | `verify/vercel-ai-sdk/examples/03-tool-approval.ts`, `verify/openai-agents-sdk/examples/05-approval-resume.ts`, `verify/langchain/examples/03-human-in-the-loop.ts`, `verify/openai-agents-sdk/examples/04-guardrails.ts`, the injection guardrail in `verify/openai-agents-sdk/examples/09-triage-agent.ts` | B15, E3 |
| 7 | T16 | Testing offline, and a first complete agent (`testing-offline-and-a-first-agent`) | scenario | Mock models in depth (the box in the first chapter introduced them); `check()` assertions and what they can and cannot show; One capstone in full, with the other seven as SDK tabs | `verify/vercel-ai-sdk/examples/09-triage-agent.ts` in full, the other seven `verify/*/examples/*triage-agent.ts` capstones as tabs, `verify/vercel-ai-sdk/examples/lib/check.ts` | B18, B19 |

### 4.2 Part II: in depth, for experienced builders

| # | Todo | Chapter (slug) | Opening | Covers | Examples | Switches to |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | T17 | Choosing the shape: buy, adopt or build, how to plan, and when subagents pay (`choosing-the-shape`) | fact | Buy, adopt or build (the main report's three tiers and build-vs-buy table); Planning patterns: ReAct first, then plan-and-execute and reflection when they earn it (main report); Workflows, routing and handoffs; Subagents for context isolation, and their cost: about 4× the tokens of chat for one agent and 15× for a multi-agent system (Anthropic) | `verify/openai-agents-sdk/examples/03-handoff.ts`, `verify/google-adk/examples/02-workflow-agents.ts`, `verify/google-adk/examples/03-graph-workflow.ts`, the subagent example from [T42](../todos/ready/T42-example-subagent.md) | B19b |
| 9 | T18 | The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost (`the-model-gateway`) | code | One streaming method over two wire protocols; Retries and their limits; Prompt caching: a stable prefix, and MCP's request for a deterministic `tools/list` order; Replaying reasoning across providers: drop foreign signatures (SDK guide §2); Cost accounting and the pre-call budget (the evals chapter no longer carries cost) | `verify/vercel-ai-sdk/examples/04-prepare-step.ts`, `verify/vercel-ai-sdk/examples/06-streaming.ts`, the retries, caching and budget example from [T29](../todos/ready/T29-example-retries-caching-budget.md) | B4, B5, B8, B9 |
| 10 | T19 | Events and hooks: one event union, interceptors and observers (`events-and-hooks`) | question | One closed event union, with end events that carry the authoritative item; Six interceptors at model and tool moments; Observers that only watch | `verify/copilot-sdk/examples/08-hooks.ts`, `verify/langchain/examples/07-middleware.ts`, `verify/google-adk/examples/05-callbacks.ts`, `verify/pi/examples/04-steering.ts` | B13, B16, B17 |
| 11 | T20 | The session log and context policy (`the-session-log-and-context`) | analogy | One append-only tree of typed entries, with HEAD, forks and a writer lock; Five context layers, cheapest first, with visible and reversible compaction; Progress files and feature lists for long-running work (Anthropic's long-running harness; main report) | `verify/pi/examples/05-session-tree.ts`, `verify/pi/examples/06-compaction.ts`, `verify/cloudflare-agents/examples/08-hibernation.ts` | N2–N10 |
| 12 | T36 | Retrieval and long-term memory (`retrieval-and-long-term-memory`) | scenario | Just-in-time retrieval through tools versus pre-loaded context; Vector and keyword search, their failure modes (OWASP LLM08), and measuring retrieval: recall@k on 20 to 50 labelled queries, some of which should return nothing; Long-term memory across runs: what to store, when to recall, when to forget, and checking a recalled record against its source before acting on it; When to buy a memory service (main report) and when a file is enough | `verify/langchain/examples/09-long-term-store.ts`, `verify/cloudflare-agents/examples/02-sql.ts`, the retrieval example from [T41](../todos/ready/T41-example-retrieval.md), the store, recall and expiry example from [T43](../todos/ready/T43-example-store-recall-expire.md), the context-memory example from [T44](../todos/ready/T44-example-context-memory.md) | N23 |
| 13 | T21 | Tools at scale: the registry, deferred tools, MCP and skills (`tools-at-scale`) | fact | One registry that names, defers and gates every tool; Deferred tools: load a tool's definition only when needed; MCP after 2026-07-28: stateless requests, `server/discover`, multi round-trip requests (`input_required`), and the deprecation of Roots, Sampling, Logging and dynamic client registration; Skills: procedures loaded on demand; Connector OAuth and token custody moved to the permissions chapter, after the credential boundary | `verify/vercel-ai-sdk/examples/08-mcp-tools.ts`, `verify/cloudflare-agents/examples/07-mcp.ts`, `verify/copilot-sdk/examples/07-mcp-server.ts`, `verify/pi/examples/03-tool-selection.ts`, the deferred-tools and skills examples from [T30](../todos/ready/T30-example-deferred-tools-and-skills.md) | N11, N21–N25 |
| 14 | T22 | Permissions, sandboxes and credentials, and the lethal trifecta (`permissions-sandboxes-and-credentials`) | incident | A deny-first permission pipeline; Sandboxes and egress; The credential boundary, then connector OAuth and token custody (moved from the tools chapter); Prompt injection contained: the lethal trifecta and cutting the outbound leg (agent guide §5) | `verify/claude-agent-sdk/examples/03-permission-order.ts`, `verify/copilot-sdk/examples/03-permission-deny.ts`, `verify/copilot-sdk/examples/04-restrict-builtins.ts`, `verify/pi/examples/07-extension-gate.ts`, `verify/copilot-sdk/examples/00-sandbox.ts` (labelled as our harness's network self-check, not an SDK feature), the sandbox example from [T31](../todos/ready/T31-example-sandbox-behaviour.md) | N12–N20 |
| 15 | T35 | Agents people can watch: UIs, browsers and taking over (`agents-people-can-watch`) | question | Agent UIs render an event log, not a chat (agent UI research); Undo for agent edits; Browser use: accessibility snapshots, hosted browsers and vendor computer-use tools; Watching and taking over the browser (U16); Why the network and the credential are the browser's boundary | `verify/vercel-ai-sdk/examples/06-streaming.ts` read as a UI event stream, `verify/cloudflare-agents/examples/04-chat-agent.ts`, the computer-use example from [T40](../todos/ready/T40-example-computer-use.md) | N44 |
| 16 | T23 | Side effects that can fail: outcomes, idempotency and plan approvals (`side-effects-that-can-fail`) | incident | Four failure outcomes after a rollback (`not_applied`, `compensated`, `partial`, `unknown`) plus `applied` on success: the five of SG3; Idempotency keys and persisting before executing; The crash between persist and execute; Sagas and one approval for a whole plan | `verify/cloudflare-agents/examples/06-tool-approval.ts`, the failing-writes, idempotency and crash example from [T32](../todos/ready/T32-example-failing-writes-and-idempotency.md) | E1, E2, E3, E4a, E4b |
| 17 | T24 | Durable and portable agents, and how work reaches them (`durable-and-portable-agents`) | code | Durability: state, wake and resume on Cloudflare (the only target `verify/` runs); The seven seams of ADR 0033 plus `EffectStore` from ADR 0043, and what AWS and Vercel need; Ingress and triggers: one design, deduplicated by id (12-factor agents, factor 11; coding agent plan CA7) | `verify/cloudflare-agents/examples/02-sql.ts`, `verify/cloudflare-agents/examples/03-scheduling.ts`, `verify/cloudflare-agents/examples/08-hibernation.ts`, the durability example from [T33](../todos/ready/T33-example-durability.md) | N41–N48 |
| 18 | T25 | Evals, observability and release (`evals-observability-and-release`) | analogy | pass@k and pass^k, and why the capstones' scripted failures are synthetic; LLM-as-judge: a rubric, a 0.0–1.0 score and a starting set of about 20 queries (Anthropic); Tracing: spans projected from the session log; Release: four stages behind a graded kill switch, and handing off to people (agent guide §7) | the triage capstones' `check()` assertions, read as eval-shaped tests, the tracing and LLM-judge example from [T34](../todos/ready/T34-example-tracing-and-llm-judge.md) | N31, N36, N38 |

### 4.3 Four topics need research before they are written

The owner chose to cover every topic group the coverage review named (2026-11-19), so none becomes a non-goal. Four have too little in the repo to teach from, so each gets a research todo first (BK19). Retrieval and long-term memory become a chapter, because they span design, storage, failure modes and evaluation, and two existing examples already touch them. The other three become sections of chapters that already hold their neighbours, so those chapters need not wait for the research:

| Topic | Research todo | Lands in | Why there |
| --- | --- | --- | --- |
| Retrieval and long-term memory | [U18](../todos/done/U18-research-retrieval-and-long-term-memory.md); report: [retrieval-and-memory.md](../research/memory/retrieval-and-memory.md) | T36, a chapter | A chapter of its own, after the session log and context chapter, because it spans retrieval design, stores, failure modes and evaluation |
| Agent-to-agent protocols (A2A) | [U19](../todos/done/U19-research-a2a.md); report: [agent-to-agent-protocols.md](../research/a2a/agent-to-agent-protocols.md) | T37, a section of T21 | A2A is an interoperability protocol beside MCP, so it belongs in the chapter that already explains MCP; one section keeps Chapter T21 from waiting on research |
| Voice and realtime agents | [U20](../todos/done/U20-research-voice-and-realtime.md); report: [voice-and-realtime.md](../research/voice/voice-and-realtime.md) | T38, a section of T35 | Voice and realtime change how a person interacts with a running agent, which is Chapter T35's subject |
| Fine-tuning versus prompting | [U21](../todos/done/U21-research-fine-tuning-vs-prompting.md); report: [fine-tuning-vs-prompting.md](../research/fine-tuning/fine-tuning-vs-prompting.md) | T39, a section of T11 | The question arises the moment a reader chooses a model, which Chapter T11 teaches |

The three research rounds behind the sections each confirmed its placement, and the owner approved their proposed changes on 2026-11-19 (owner decision 2026-11-19, BK20). Each section stays a section and waits for the example that gives it a listing. T37 follows the MCP section of T21 and uses T45's ADK example. T38 uses T46's scripted OpenAI session and T47's Cloudflare pipeline. T39 uses the tuned-versus-cached pricing example that T28 now also writes.

### 4.4 Where each topic of the coverage review lands

| Topic | Chapter or section |
| --- | --- |
| The loop; workflows versus agents; least autonomy | T10 (opens Part I), T17 |
| Tools and tool design; identity from trusted context | T12 |
| Structured output and stopping | T13 |
| System prompt, model choice, reasoning blocks, streaming | T11; reasoning replay also T18 |
| Sessions; long-term memory; retrieval | T15; T36 after U18 |
| Approvals, guardrails, prompt injection basics | T14 |
| Testing offline and mock models | T10's box, then T16 |
| Planning patterns, multi-agent and subagents | T17 |
| Retries, prompt caching, cost | T18 |
| Events, hooks and observers | T19 |
| Session log, context policy, progress files | T20 |
| Tool registry, deferred tools, MCP 2026-07-28, skills; A2A | T21; T37 after U19 |
| Permissions, sandboxes, credentials, connector OAuth, the lethal trifecta | T22 |
| Agent UIs, undo, browser and computer use, takeover; voice and realtime | T35; T38 after U20 |
| Side effects, outcomes, idempotency, sagas | T23 |
| Durability, portability, ingress and triggers | T24 |
| Evals, LLM-as-judge, tracing, rollout stages and the kill switch | T25 |
| Fine-tuning versus prompting | T39 after U21 |
| Responsible use: red-teaming and the kill switch | T14 and T22 (OWASP), T25 (release and kill switch) |


## 5. Round T and its todos

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [T1](../todos/done/T1-book-scaffold.md) | Scaffold `apps/manual`: workspace wiring, pins, a static build and Pagefind | None | M |
| [T2](../todos/done/T2-book-design.md) | The owner's design as tokens and components: C's layout, C4 pages, theme-following panels and three fonts | T1 | M |
| [T3](../todos/done/T3-book-content-model.md) | Content model: outline, numbering, source register, glossary, analogy register and chapter checks | T1 | L |
| [T4](../todos/done/T4-book-listings.md) | Code listings from real file regions, with path, lines and pin | T3 | M |
| [T5](../todos/ready/T5-book-interactive-listings.md) | Interactive listings: annotations, SDK tabs, recorded-run replay and the transcript recorder | T4 | L |
| [T6](../todos/ready/T6-book-flat-figures.md) | Flat figure pipeline: generated SVGs, analogy illustrations, numbering, themes and the staleness test | T2, T3 | M |
| [T7](../todos/ready/T7-book-isometric-figures.md) | Isometric and interactive figures: the vendored anatomy skill, its audits and inline fragments | T6, T8 | M |
| [T8](../todos/ready/T8-book-ci.md) | The book's build workflow: every check, no secrets, `dist/` as an artifact | T4, T6 | S |
| [T9](../todos/ready/T9-book-deploy.md) | Deploy to manual.buildanagent.fyi from GitHub Actions: guard, switch and branch previews | T2, T8 | M |
| [T26](../todos/ready/T26-book-checked-inline-code.md) | Checked inline code: identifiers resolve to listings, transcripts or the pinned `.d.ts` | T5 | M |
| [T27](../todos/ready/T27-book-live-run.md) | An occasional live run against real APIs, with flow diffs and the last-comparison date | T5 | M |
| [T28](../todos/ready/T28-example-streaming-usage.md) | Example: streaming with usage and the four token classes | T5 | M |
| [T29](../todos/ready/T29-example-retries-caching-budget.md) | Example: retries, prompt caching and a pre-call budget | T5 | M |
| [T30](../todos/ready/T30-example-deferred-tools-and-skills.md) | Example: deferred tools and skills | T5 | M |
| [T31](../todos/ready/T31-example-sandbox-behaviour.md) | Example: a sandbox or permission behaviour the SDK itself enforces | T5 | M |
| [T32](../todos/ready/T32-example-failing-writes-and-idempotency.md) | Example: failing writes, idempotency keys and a crash between persist and execute | T5 | M |
| [T33](../todos/ready/T33-example-durability.md) | Example: state that survives a restart and a scheduled wake | T5 | M |
| [T34](../todos/ready/T34-example-tracing-and-llm-judge.md) | Example: tracing spans and an LLM judge | T5 | M |
| [T40](../todos/ready/T40-example-computer-use.md) | Example: a computer-use tool against a fake computer | T5 | M |
| [T41](../todos/ready/T41-example-retrieval.md) | Example: retrieval over a small fixture, offline | T5, U18 | M |
| [T42](../todos/ready/T42-example-subagent.md) | Example: a subagent with its own context | T5 | M |
| [T43](../todos/ready/T43-example-store-recall-expire.md) | Example: store, recall and expire a fact across runs on LangChain's store | T5, U18 | M |
| [T44](../todos/ready/T44-example-context-memory.md) | Example: context-block memory that survives eviction and stays inside one agent | T5, U18 | M |
| [T45](../todos/ready/T45-example-a2a-delegation.md) | Example: delegation to a remote agent over A2A on ADK, both ends offline | T5, U19 | M |
| [T46](../todos/ready/T46-example-realtime-session.md) | Example: an OpenAI realtime session on the SDK's scripted transport | T5, U20 | M |
| [T47](../todos/ready/T47-example-voice-pipeline.md) | Example: a chained voice pipeline with a tool and barge-in on Cloudflare | T5, U20 | M |
| [T48](../todos/ready/T48-example-a2a-1-0.md) | Example: A2A 1.0 delegation, once a pinned SDK ships 1.0 support (on hold) | T45 | M |
| [U18](../todos/done/U18-research-retrieval-and-long-term-memory.md) | Research: retrieval and long-term memory, for the book | None | L |
| [U19](../todos/done/U19-research-a2a.md) | Research: agent-to-agent protocols (a2a), for the book | None | L |
| [U20](../todos/done/U20-research-voice-and-realtime.md) | Research: voice and realtime agents, for the book | None | L |
| [U21](../todos/done/U21-research-fine-tuning-vs-prompting.md) | Research: fine-tuning versus prompting, for the book | None | L |
| [T10](../todos/ready/T10-chapter-call-workflow-loop.md) | Chapter: Use the least autonomy that works: a call, a workflow, then a loop | T5, T7, T26 | M |
| [T11](../todos/ready/T11-chapter-talking-to-a-model.md) | Chapter: Talking to a model: messages, streams, tokens, instructions and model choice | T5, T6, T26, T28 | M |
| [T12](../todos/ready/T12-chapter-tools.md) | Chapter: Tools: schemas, validation, errors the model can read, and identity it cannot fake | T5, T6, T26 | M |
| [T13](../todos/ready/T13-chapter-stopping-and-structured-output.md) | Chapter: Stopping: caps, stop conditions and structured output | T5, T6, T26 | M |
| [T15](../todos/ready/T15-chapter-memory-and-sessions.md) | Chapter: Memory within a task: sessions, threads and resuming | T5, T6, T26 | M |
| [T14](../todos/ready/T14-chapter-approvals-guardrails-and-injection.md) | Chapter: Asking before acting: approvals, guardrails and prompt injection | T5, T6, T26 | M |
| [T16](../todos/ready/T16-chapter-testing-offline-and-a-first-agent.md) | Chapter: Testing offline, and a first complete agent | T5, T6, T26 | M |
| [T17](../todos/ready/T17-chapter-choosing-the-shape.md) | Chapter: Choosing the shape: buy, adopt or build, how to plan, and when subagents pay | T5, T6, T26, T42 | M |
| [T18](../todos/ready/T18-chapter-the-model-gateway.md) | Chapter: The model gateway: one streaming method, retries, prompt caching, reasoning replay and cost | T5, T6, T26, T29 | M |
| [T19](../todos/ready/T19-chapter-events-and-hooks.md) | Chapter: Events and hooks: one event union, interceptors and observers | T5, T6, T26 | M |
| [T20](../todos/ready/T20-chapter-the-session-log-and-context.md) | Chapter: The session log and context policy | T5, T7, T26 | M |
| [T36](../todos/ready/T36-chapter-retrieval-and-long-term-memory.md) | Chapter: Retrieval and long-term memory | U18, T5, T6, T26, T41, T43, T44 | M |
| [T21](../todos/ready/T21-chapter-tools-at-scale.md) | Chapter: Tools at scale: the registry, deferred tools, MCP and skills | T5, T6, T26, T30 | M |
| [T22](../todos/ready/T22-chapter-permissions-sandboxes-and-credentials.md) | Chapter: Permissions, sandboxes and credentials, and the lethal trifecta | T5, T7, T26, T31 | M |
| [T35](../todos/ready/T35-chapter-agents-people-can-watch.md) | Chapter: Agents people can watch: UIs, browsers and taking over | T5, T6, T26, T40 | M |
| [T23](../todos/ready/T23-chapter-side-effects-that-can-fail.md) | Chapter: Side effects that can fail: outcomes, idempotency and plan approvals | T5, T6, T26, T32 | M |
| [T24](../todos/ready/T24-chapter-durable-and-portable-agents.md) | Chapter: Durable and portable agents, and how work reaches them | T5, T6, T26, T33 | M |
| [T25](../todos/ready/T25-chapter-evals-observability-and-release.md) | Chapter: Evals, observability and release | T5, T6, T26, T34 | M |
| [T37](../todos/ready/T37-section-a2a.md) | Section: agent-to-agent protocols (A2A) in Chapter T21 | U19, T21, T45 | S |
| [T38](../todos/ready/T38-section-voice-and-realtime.md) | Section: voice and realtime agents in Chapter T35 | U20, T35, T46, T47 | S |
| [T39](../todos/ready/T39-section-fine-tuning-vs-prompting.md) | Section: fine-tuning versus prompting in Chapter T11 | U21, T11, T28 | S |

Chapters are listed in reading order. The longest chain runs T1 → T3 → T4 → T5 → T26 and then to any chapter; T6 → T8 → T7 runs beside it. Each chapter whose subject lacked code waits for its example todo (T28–T34, T40–T47), which needs T5, and T41, T43 and T44 also need U18. T45 also needs U19, and T46 and T47 need U20. T48 needs T45 and stays on hold until a pinned SDK ships A2A 1.0. The research todos U18–U21 need nothing from Round T and can run first; T36 waits for U18, and each research-fed section waits for its research, its chapter and its example: T37 for T45, T38 for T46 and T47, and T39 for T28. T27 can run any time after T5, and the owner starts each live run by hand. T9 can ship the site at any point after T8, with whatever chapters exist.


## 6. Ten risks, each with the todo that handles it

1. **The tool versions move fast.** Astro, Wrangler and the adapter each shipped several releases in the week before 2026-11-19 (BK3). T1 re-pins under the one-week rule, and the weekly SDK-update job could later cover `apps/manual`.
2. **TypeScript 7 may not check Astro files.** `@astrojs/check` 0.9.12 accepts TypeScript 5 or 6 only (BK3). If T1 finds `astro check` unusable, `.astro` components stay small and logic moves into `.ts` modules that the root `tsc` checks. T1 found it unusable: Astro 7.4.11 refuses `astro check` under TypeScript 7 (BK3), so that rule now applies. Astro's message points to an experimental checker, `@astrojs/ts-content-mapper`, for TypeScript 7.1 or later; a later todo can try it once the root moves to 7.1.
3. **Transcripts may not be deterministic.** Some harnesses mock at the HTTP layer and emit ids and timestamps. T5 normalises them, and a harness whose transcript still varies between runs gets no replay until it is fixed.
4. **Anatomy figures are slow to audit.** The skill's own notes report a 17-minute full audit for one 3D figure ([anatomy, verify][anatomy]). The book's centerpieces are flat isometric figures without turning groups, and T7 measures the job's time before T8's job adds the audits.
5. **Deploys wait on the owner's setup.** The zone, both GitHub environments, their secrets and the deploy switch are the owner's to create (BK15). T9 can merge before they exist, because each job stops with a named missing secret, but nothing deploys until they do.
6. **The live run costs money and handles keys.** T27 runs real model calls on the owner's Anthropic and OpenAI keys, in the seven harnesses with a pinned path to one of them; `google-adk` stays mock-only. The workflow runs only by hand, only from `main`, only after the owner approves the protected environment, and the pre-call cap stops any run at $1.00. Model output varies between runs, so it compares flows and opens an issue on a difference instead of failing CI (BK18).
7. **A deploy job must never run pull-request code.** DS3's split keeps the tokens in `book-deploy.yml`, which GitHub runs from `main` and which only downloads the built `dist/`, so a pull request, a fork's included, cannot reach a token. The preview token is also separate, holds Editor on the book's Worker only, and has no zone permission (BK15).
8. **An analogy can mislead.** A vivid analogy can teach a newcomer something false. Each chapter todo vets its analogies before drafting and writes where each breaks. Because analogies are optional (BK22), a chapter can drop one that misleads instead of forcing it in.
9. **Research may change the outline.** U18–U21 may find that a section needs a chapter, or that a chapter is too thin. The section todos propose such changes to the owner instead of overfilling.
10. **Displayed pins change weekly.** The SDK-update job moves the pins in `verify/`, and a listing's displayed pin changes with them. The book reads the pin at build time, so the page and the code agree, but prose that names a version needs its "as of" date, which each chapter todo's acceptance criteria require.

## 7. Round T can start: the owner approved the plan on 2026-11-19

Round T needs nothing from Rounds B, N or E to start: T1 needs only the workspace, and the chapters use `verify/` code. It runs beside them as milestone MT on the [roadmap](roadmap.md):

```
 T1 ─┬─► T2 ─────────────────────────────────┬─► T9 (deploy)
     └─► T3 ─► T4 ─► T5 ─┬─► T26 ─┐          │
              T2, T3 ─► T6 ─► T8 (with T4) ─► T7
                         ├─► T27  │
                         └─► T28–T34, T40–T47 (examples; T41, T43 and T44 also after U18,
                                  │                T45 after U19, T46 and T47 after U20)
                                  ├─► chapters, each after T26, T6 or T7, and its example todo
 U18 ─► T36   U19 ─► T37 (in T21, after T45)   U20 ─► T38 (in T35, after T46, T47)
 U21 ─► T39 (in T11, after T28)                T45 ─► T48 (held for A2A 1.0)
```

The owner approved this plan on 2026-11-19 ("If green merge", then "Then continue work"), so T1 can begin now, and T2 already has the owner's design. Once Rounds B, N and E land the todos each chapter names in `switchTo`, follow-up todos move those chapters' listings to our own packages. The book then documents the stack this repository builds, in code that CI checks on every push.

[main]: ../research/agent-sdks-and-harness-design.md
[u18-changes]: ../research/memory/retrieval-and-memory.md#twelve-proposed-changes-await-the-owners-decision
[u19-changes]: ../research/a2a/agent-to-agent-protocols.md#seven-proposed-changes-await-the-owners-decision
[u20-changes]: ../research/voice/voice-and-realtime.md#eight-proposed-changes-await-the-owners-decision
[u21-changes]: ../research/fine-tuning/fine-tuning-vs-prompting.md#six-proposed-changes-await-the-owners-decision
[main-arch]: ../research/agent-sdks-and-harness-design.md#a-reference-architecture-in-eight-swappable-layers
[g-sdk]: ../guides/agent-sdk.md
[g-harness]: ../guides/agent-harness.md
[g-agent]: ../guides/agent.md
[anatomy]: https://github.com/wheresryan22/anatomy/blob/main/references/verify.md
[gh-env]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[bea]: https://www.anthropic.com/engineering/building-effective-agents
[mcp-cl]: https://modelcontextprotocol.io/specification/2026-07-28/changelog
[cf-wcfg]: https://developers.cloudflare.com/workers/wrangler/configuration/
[cf-cd]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
[cf-authz]: https://developers.cloudflare.com/workers/authorization/workers/
[cf-authz-root]: https://developers.cloudflare.com/workers/authorization/
[cf-gha]: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
[cf-env]: https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
[cf-astro]: https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/
[cf-headers]: https://developers.cloudflare.com/workers/static-assets/headers/
[cf-previews]: https://developers.cloudflare.com/workers/previews/
[cf-pcd]: https://developers.cloudflare.com/workers/previews/custom-domains/
