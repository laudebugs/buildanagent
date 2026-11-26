# L12: Redesign apps/docs to match the book's theme, with diagrams, tested examples and the harness packages

| Field | Value |
| --- | --- |
| ID | `L12` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L5](../done/L5-docs-app.md), [L6](../done/L6-api-reference.md), [L8](../done/L8-cloudflare-deploys.md) |
| Size | L (the umbrella: it stays `ongoing` and closes when every sub-todo in the [split table](#tasks) is done, the proposed ones only if the owner accepts them) |

## Goal

Redesign the docs site at `docs.buildanagent.fyi` so it looks like the book at `manual.buildanagent.fyi` and works like a modern reference site: navigation, page anatomy, code tabs, callouts, an API reference layout, search, copy buttons and versioning. Add flat SVG diagrams drawn by scripts, tested code examples where they help, and pages for the protocol, harness and CLI packages. The owner asked for it on 2026-11-22.

The owner's part: Q1, Q3 and Q5 are answered (2026-11-22), the manager set the defaults for Q2, Q4, Q6 to Q8 and 9a that day, and only question 9b holds anything back (L12m).

Status of L12o (2026-11-23): the docs home page is rebuilt as design A, a centred welcome with the install line and a grid of six package cards (`index.mdx`, `starlight.css`, `test/home.test.ts`). The gateway and SDK cards lead to the Install and first-agent pages; the harness, agent-safety, protocol and CLI cards led to their READMEs on GitHub, because the docs had no quick start for them until L12g to L12j land, and then those four cards move to the new pages. Since L12f (2026-11-24), those four cards lead to their API reference pages in the docs instead, and `home.test.ts` checks that. L12o depends only on L12a and L12b: the owner chose a design with no illustration (manager's message, 2026-11-23), so it needs no figure from L12d.

Status of L12c (2026-11-23): done on `todo/L12c-sidebar-topics`. `starlight-sidebar-topics` 0.9.0 (released 2026-09-03; peers `@astrojs/starlight >=0.42.0` and `astro ^7.2.10`) splits the sidebar into "SDK & gateway" and one topic per package's generated reference, "Gateway API" and "SDK API". The plan names a single "API reference" topic, but a shared API topic still put all 253 reference links on every reference page, and the largest page stayed at 174,620 bytes. One topic per package is what keeps L12f's four packages inside the budget.

Measurements are bytes of HTML (1 KiB is 1,024 bytes), over the same 282 pages on `main` at `25cdbd41` and after the split: `start/install/` 114,268 to 43,915, `concepts/tools/` 107,491 to 39,462, `guides/add-a-tool/` 108,219 to 40,190, the home page 30,369 to 30,339 (it has no sidebar), the largest page (`reference/sdk/.../continueoptions/`) 175,279 to 141,164, the mean page 107,276 to 70,132, and `dist/` 34 MB to 24 MB. The Pagefind index stays 2.0 MB over the same 282 pages, and a warm build takes about 15 seconds. The before and after builds differ in cache state, so they say nothing about whether the split changes build time.

The current tab carries `aria-current="page"`, added by a route middleware (`apps/docs/src/route-data.ts`) because the plugin's tab attributes are the same on every page. Adding a topic is one entry in `apps/docs/src/topics.ts`, or one line in `API_PACKAGES` for a package's reference; `apps/docs/README.md` has the steps.

## Context

- The owner's request, relayed by the manager session on 2026-11-22: study the Lamina PDF docs site's features, match the book's theme from `docs/design/book-tokens.json` through a generated tokens file, include diagrams and tested examples, keep the docs checks passing, add harness-package pages, and leave a header slot for the logo files the manager will hand over (the owner has since chosen logo 3 and answered questions 1, 3 and 5; see Out of scope and Owner questions).
- The study (2026-11-22) was a read-only pass over this repository at `6a6a690c`; this todo and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) record its findings. Its measurements come from the worktree.
- A second study (2026-11-25) read the Lamina PDF repository itself at `db8e3b0`. It widened [the comparison](#the-lamina-pdf-comparison), amended five sub-todos and proposed seven more (L12t to L12z).
- [`apps/docs/README.md`](../../../apps/docs/README.md) and [ADR 0048](../../decisions/0048-docs-on-astro-starlight.md): the docs app today.
- [`apps/manual/README.md`](../../../apps/manual/README.md): how the book generates its tokens, self-hosts its fonts and draws its figures.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the rules the pages and examples follow.

## Scope

L12 is the umbrella for the redesign. It stays `ongoing`, no pull request closes it, and it moves to `done/` when every sub-todo in the split table under Tasks is done. A proposed sub-todo (L12t to L12z) counts only once the owner accepts it. Each sub-todo gets its own file, made from [TEMPLATE.md](../TEMPLATE.md) when someone starts it, so this change creates none.

**In scope** (the sub-todo table under Tasks says who delivers each part)

- **Theme.** The book's tokens, fonts and code colours, reused in `apps/docs` (L12a; the design is in DS5).
- **Chrome and navigation.** A header slot that holds the mark and the wordmark "Build An Agent docs", a favicon, a restyled theme select, footer and asides, MDX support for tabs, and a sidebar split into topics (L12b, L12c).
- **The docs home.** A redesigned home page that leads readers to the six packages' quick starts (L12o).
- **One shared header source.** One small source that the book, the docs and the site read for the links Docs, Manual, Site and GitHub and for each site's mark and wordmark (L12p).
- **Diagrams.** A figure pipeline on the book's `svgkit` and nine figures: `package-map`, `run-loop`, `stream-and-transcript`, `stop-reasons`, `approval-pause`, `gateway-adapters`, `session-log`, `sandbox-egress` and `protocol-clients` (L12d, then figures 3 to 9 inside L12g, L12h, L12i and L12k).
- **Versioning.** A version tag, an "Unreleased docs for `main`" banner on `next.docs.buildanagent.fyi`, an `@alpha` install-line test and a "Docs for main" link (L12e). [DS4](../../plans/publish-and-docs.md#ds4-the-docs-follow-main-until-010-then-releases-accepted) is unchanged.
- **Content.** A generated API reference and pages for the protocol, harness, CLI and agent-safety packages, `file=` fences on the existing pages, a gateway page and new tested examples (L12f to L12k).
- **Machine readers.** Markdown twins, `llms.txt`, `llms-full.txt`, "Copy as Markdown" and, if the owner answers yes to question 9a, a `context7.json` (L12l, which owns it), and a strict Content Security Policy (L12m).
- **Rules.** A diagrams, callouts and tabs section in [docs-writing.md](../../guidelines/docs-writing.md) (L12n).

**Out of scope**

- **The logo files.** The manager supplies the SVG files (`docs/design/landing/logo-mark.svg` and `favicon.svg` on the branch `claude/happy-albattani-p54jjp`), and L12b copies them. The owner chose logo 3, "the prompt": a rounded-square outline (50 by 50 in a 64-unit box, stroke 5, corner radius 11) that holds a chevron `>` in the text colour and a short caret in the accent. The accent is `#B04E29` on the light theme and `#E8A27C` on the dark one, and the text colour is `#2A1E16` and `#F4EADC`. L12b's `SiteTitle` takes the mark plus the wordmark "Build An Agent docs" (title case for "Build An Agent", "docs" in the lighter mono style; the mark alone on narrow widths), and the same mark is the favicon, which a test or a headless render checks at 16 px.
- **The `apps/site` landing page.** Another session builds it. L12o reuses its figure style and tone but changes none of its files.
- **A manual redesign.** The book stays the design reference. Only its header reads the shared source (L12p).
- **`.github/workflows/`.** Sessions never edit it. L12m's `_headers` file is not a workflow: `site-stage-dist.mjs` already deploys main's `apps/docs/public/_headers`.

## Tasks

The first two tasks are done: the study is the plan, and the table below is the split. Each sub-todo is one pull request, and the **Model** column follows the [subagent rule](../../../AGENTS.md#subagents-run-on-the-model-their-work-needs).

- [x] Study the current app, the book's design pipeline and the Lamina PDF practices, and record the plan in [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22).
- [x] Split this todo into the sub-todos below.
- [x] Get the owner's answers to questions 1, 3 and 5 (2026-11-22).
- [ ] Get the owner's answer to question 9b.

| Todo | Delivers | Depends on | Size | Model |
| --- | --- | --- | --- | --- |
| L12a | Manual `exports`, `tokensCss()`, the docs' tokens, fonts, `starlight.css`, code themes and their tests | This plan | M | Opus (design tooling) |
| L12b | `SiteTitle` (mark plus wordmark) and favicon, restyled theme select, footer and asides, MDX, install tabs | L12a | M | Sonnet, with an Opus high review |
| L12c | The sidebar topics plugin, the rewritten sidebar tests and the page-size measurement | L12a | S to M | Sonnet |
| L12d | The figure pipeline and figures 1 and 2, `package-map` and `run-loop` | L12a | M | Opus (tooling, untrusted-SVG sanitising) |
| L12e | The version tag, the `next.` banner, the `@alpha` install-line test, the "Docs for main" link | L12b | S | Sonnet |
| L12f | The API reference for the four packages and its measurements | L12c | S to M | Sonnet |
| L12g | The protocol and CLI pages, their examples and figure 9, plus a quick start for each package and CLI transcripts from real runs ([amended 2026-11-25](#amendments-to-the-sub-todos-that-have-not-started-2026-11-25)) | L12d, L12f | M | Sonnet |
| L12h | Harness pages, part 1 (overview, sessions, context, tools) and figure 7, plus the harness quick start and a "Problems and fixes" section ([amended 2026-11-25](#amendments-to-the-sub-todos-that-have-not-started-2026-11-25)) | L12g | M | Sonnet |
| L12i | Harness pages, part 2 (permissions, sandbox, server, extensions) and figure 8, plus a "Problems and fixes" section ([amended 2026-11-25](#amendments-to-the-sub-todos-that-have-not-started-2026-11-25)) | L12h | M | Sonnet (Opus for any run of the sandbox and credentials example) |
| L12j | The agent-safety pages and examples, plus a quick start and a "Problems and fixes" section ([amended 2026-11-25](#amendments-to-the-sub-todos-that-have-not-started-2026-11-25)) | L12f | M | Sonnet |
| L12k | `file=` fences on the existing pages, the gateway page and figures 3 to 6 | L12d | M | Sonnet |
| L12l | Markdown twins, `llms.txt`, `llms-full.txt`, "Copy as Markdown" and, if 9a is yes, `context7.json` | L12b | M | Sonnet |
| L12m | The CSP `_headers` file with script hashes, a stated `style-src` decision, a 1,900-character limit on the CSP line, and its test ([amended 2026-11-25](#amendments-to-the-sub-todos-that-have-not-started-2026-11-25)) | L12b, L12l | S to M | Opus (security) |
| L12n | The docs-writing.md rules for diagrams, callouts and tabs | None | S | Sonnet |
| L12o | The docs home page redesign: it leads readers to the quick starts of the gateway, SDK, agent-safety, protocol, harness and CLI, as design A: six package cards and no illustration | L12a, L12b | M | Sonnet |
| L12p | One shared header source for the book, the docs and the site: links Docs, Manual, Site and GitHub, plus each site's mark and wordmark ([DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22)) | L12b | S to M | Sonnet (Opus if it touches a shared package's build) |
| L12q | The new tested examples the docs pages need: protocol, a harness sandbox and compaction, and an agent-safety bring-your-own-key guard (added 2026-11-23; [done](../done/L12q-docs-examples.md)) | L12k | M | Sonnet |
| L12r | Body text in Inter, titles in Instrument Serif, after the owner's decision of 2026-11-24 | L12a | S | Sonnet |
| L12s | Body text in IBM Plex Sans in place of Inter, after the owner's decision of 2026-11-24 | L12r | S | Sonnet |
| L12t | **Proposed.** An error-code reference: one entry for each code in each package's error-code union, and a table page | L12f | M | Sonnet |
| L12u | **Proposed.** An Output view beside the code, from a committed file that the example's test rewrites and compares | L12k; L12g to L12j for the four packages' quick starts | M | Opus (design tooling: a fence attribute, the twin rule and the output files) |
| L12v | **Proposed.** Docs for coding agents: an `AGENTS.md` snippet per package, a "Use with a coding agent" page and the guides' Markdown inside each tarball | L12l; L12g to L12j for the four packages' content | M | Opus for the tarball change (it reaches npm); Sonnet for the page and the snippets |
| L12w | **Proposed.** Reader-facing checks on package READMEs and `package.json` metadata, and a check that every example is shown or listed as unused | None | M | Sonnet |
| L12x | **Proposed.** A changelog page, a versioning-policy page and a glossary | L12c | S | Sonnet |
| L12y | **Proposed.** Browser checks for the docs in headless Chrome; the owner commits the workflow change | L12b, L12l | M | Opus (the workflow hand-over and the browser tooling) |
| L12z | **Proposed.** `robots.txt`, a sitemap check, one share image, JSON-LD on the home page and a redirect guard | L12e | S to M | Sonnet |

**Order.** Start with L12n and L12a. L12b, L12c and L12d follow in parallel, then L12e, L12f and L12p. L12g, L12h and L12i run in sequence, with L12j, L12k and L12o beside them. L12l and L12m go last.

**Where the order stands (2026-11-25).** Every sub-todo from L12a to L12s is merged except L12g, L12h, L12i, L12j and L12m, and L12m still waits on question 9b. L12g starts the remaining sequence, and L12j can run beside it.

**Order of the proposed sub-todos, for those the owner accepts.** L12w comes first, because it depends on nothing and fixes pages readers already see. L12x and L12z can follow at any time. L12t lands before L12h to L12j write their "Problems and fixes" sections, so each entry can link its code. L12u and L12v wait for the package pages, and L12y waits for the owner to commit the workflow step. A dropped sub-todo changes nothing in this order.

**L12b, L12c and L12o are merged without a file in `done/`.** L12b merged as #377 (`b3a72c9b`), L12o as #382 (`25cdbd41`) and L12c as #387 (`44981c48`). Their outcomes are recorded here: the "Status of L12o" and "Status of L12c" paragraphs under Goal, and "L12b progress" below. Every other merged sub-todo has its own file in [`done/`](../done/).

L12o no longer depends on L12d: the owner chose package cards without an illustration for the docs home (2026-11-23).

**L12b progress (2026-11-23).** L12b has no todo file of its own, so this paragraph records its outcome. It shipped four changes in `apps/docs`: a `SiteTitle` override that draws logo 3 inline beside the wordmark "Build An Agent docs" (the mark alone below 30rem, with the wordmark kept for screen readers); a compact, rule-bordered theme select that adds no colour pair; MDX support in the content checks (`src/plugins/pages.ts`, `test/mdx.test.ts`) with package-manager tabs on the Install page; and the overrides table and the Starlight upgrade policy in `apps/docs/README.md`. The favicon is the one from the merged landing-page change. `test/logo.test.ts` checks its structure always and draws it at 16 px in headless Chromium where Playwright is installed, so the 16 px question under "Unverified items" is answered locally but not in CI, which has no Playwright. Screenshots at 1280 and 390 px in both modes showed that the footer and asides needed no change. Claims are in [the fact-check log](../../plans/reviews/fact-check-publish-and-docs.md), rows `L12b-1` to `L12b-15`.

**L12l progress (2026-11-23).** L12l is done in [its own todo](../done/L12l-docs-markdown-twins.md): every page, the generated API reference included, has a Markdown twin; `llms.txt` and `llms-full.txt` list and join them; each page's head links its twin, and the build fails when a page lacks the twin or the link; and a "Copy as Markdown" button sits under each title. The home page has the link and no button, because its splash template has no page title. `context7.json` stays unwritten, with its place documented in `apps/docs/README.md`.

**L12e progress (2026-11-23).** L12e is done in [its own todo](../done/L12e-docs-version-banner.md): the header shows the SDK's version, read from `packages/sdk/package.json` at build time; a `Banner` override holds a hidden "Unreleased docs for main" banner that one static script un-hides on a host that begins with `next.`, decided by `showsUnreleasedBanner()` in `apps/docs/src/version/banner.ts`; the footer links "Docs for main" once the SDK is stable; and a test fails on an install line without `@alpha` while only alphas exist, and requires none once the SDK is stable. Until the switch to `next.`, the footer shows no "Docs for main" line, because that host has no deploy. Claims are in [the fact-check log](../../plans/reviews/fact-check-publish-and-docs.md), rows `L12e-1` to `L12e-26`.

**L12f progress (2026-11-24).** L12f is done in [its own todo](../done/L12f-docs-api-reference-four-packages.md). `API_PACKAGES` in `apps/docs/src/api/packages.ts` now generates references for all six published packages, and the 30 entry points that lacked `@module` tags now carry them so TypeDoc names every module by its import path.

Setting `sidebar: "modules"` on `@buildanagent/harness` keeps all 965 built pages inside the 200 KiB budget. Full leaf links across its 20 entry points (446 pages) pushed 27 harness pages over 200 KiB (largest 233,112 bytes / 227.6 KiB) and grew `dist/` to 129 MB. Module-only sidebar links cut harness's largest page to 94,510 bytes (92.3 KiB) and `dist/` to 70 MB while still generating every export page and Markdown twin. Across the full six-package build, the largest page is `reference/sdk/buildanagent/sdk/interfaces/continueoptions/index.html` (146,947 bytes / 143.5 KiB), the mean page is 61,907 bytes, Pagefind is 4.9 MB, the 964 Markdown twins total 1,281,177 bytes, and a warm build takes ~23 s. [The fact-check log](../../plans/reviews/fact-check-publish-and-docs.md) records the verified claims in rows `L12f-1` to `L12f-7`.

**L12p progress (2026-11-24).** L12p is done in [its own todo](../done/L12p-shared-header-source.md). `apps/manual` exports `./site-chrome` from `src/design/site-chrome.json`, holding the brand, repository URL, cross-site links (Docs, Manual, Site, GitHub), site wordmarks and inline prompt mark. `apps/manual`, `apps/docs` and `apps/site` all render their headers from that single source and test the built header against it. Claims are in [the fact-check log](../../plans/reviews/fact-check-publish-and-docs.md), rows `L12p-1` to `L12p-4`.

### Amendments to the sub-todos that have not started (2026-11-25)

A direct read of the Lamina PDF repository ([the comparison](#the-lamina-pdf-comparison)) adds the requirements below to L12g, L12h, L12i, L12j and L12m. None of the five has a todo file yet, so whoever creates the file copies its amendments in.

**L12g (protocol and CLI pages) gains three requirements.**

- **A quick start for each package.** The protocol and the CLI each get a first-run page built from one runnable example. Their home cards lead to the API reference today, and L12g moves them to the new pages; `apps/docs/test/home.test.ts` checks the targets.
- **CLI transcripts from real runs.** Every terminal session a CLI page shows comes from a committed transcript, and a test in `packages/cli/test/` runs the command and compares its output. The requirement is met when a changed CLI output fails that test until the transcript is rewritten, and a docs test fails on a typed session: a `console` fence, or a shell block with a `$ ` prompt, that names no transcript. Install lines stay under `install-lines.test.ts`. Lamina PDF made this change after it found 16 hand-pasted transcripts that no check ran. The work adds about one sitting (size S); split it out if L12g grows past one review.
- **API friction is recorded.** When an example needs a workaround to read well, the todo's outcome names the workaround and opens a fix or a todo for the package. L12h, L12i and L12j carry the same requirement.

**L12h and L12i (harness pages) each gain a "Problems and fixes" section.** Each section holds at least three entries for its todo's areas. An entry starts from the symptom the reader sees, then gives the cause and the fix, and links its error code's entry once L12t exists. L12h also writes the harness quick start and moves the harness home card to it.

**L12j (agent-safety pages) gains the same two parts:** a quick start that the agent-safety home card leads to, and a "Problems and fixes" section under the same rule.

**L12m (CSP) gains three requirements, if the owner answers yes to question 9b.**

- **Decide `style-src` in writing.** Built pages carry `style=` attributes today. On `start/install/`, built from `c25b00db`, Expressive Code sets token colours (`style="--0:#F2E8DC;--1:#2A1E16"`) and Starlight sets `--sl-icon-size`, `--depth` and `--sl-select-width`. A `style-src 'self'` policy therefore needs each attribute moved to a class, which is how Lamina PDF dropped `'unsafe-inline'` for its code colours, or the policy states its exception.
- **Limit the CSP line.** The build fails when the CSP line passes 1,900 characters. Lamina PDF's docs README gives 2,000 characters as Cloudflare's limit for a `_headers` line; L12m confirms that number in Cloudflare's docs before it relies on it.
- **Check it in a browser.** Once L12y exists, one browser check loads a page and finds no CSP violation, coloured code and a working search.

**L12f is merged, so its two follow-ups sit here.**

- **Reference pages link to their guides.** Nothing links the generated reference to a written page today. Lamina PDF wrote usage pages for its two main types and linked them from its reference. L12g to L12j each link their package's reference index to its quick start. The gateway's and the SDK's links have no todo; L12x takes them if the owner accepts it.
- **`@since` stays deferred.** The todo that makes the first stable release adds `@since` to every export and a `check:api-docs` rule for a missing one. Lamina PDF did the same after its alphas: every item that existed took the first release after them.

### Seven sub-todos are proposed and await the owner (2026-11-25)

L12t to L12z come from the same direct read. The owner has seen the list and has neither accepted nor dropped any of them, so each is **Proposed (2026-11-25), awaiting the owner**, and none has a todo file. This change checked every gap below against `main` at `c25b00db`.

**L12t: an error-code reference. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** Each of the six published packages exports an error-code union: `GatewayErrorCode`, `SdkErrorCode`, `SafetyErrorCode`, `ProtocolErrorCode`, `HarnessErrorCode` and `CliErrorCode`. No page lists the codes or explains each one. Only `testing/offline.md` names one, `model_requests_disabled`, so a reader meets the rest only as a union in the generated reference.
- **Done when.** Every member of each union has an entry that says what happened, why and how to fix it. No entry names a code its union lacks. One table page lists the codes by package, and the entries' sources live beside each package.
- **Enforced by.** A test reads each union's members from the package's declaration files and compares them with the entries, in both directions. The Markdown twins cover the new pages.
- **Open.** The todo decides whether the two narrower unions, the gateway's `ModelErrorCode` and the SDK's `RecordingErrorCode`, get entries.

**L12u: output beside the code. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** No page shows what an example prints or streams. The earlier comparison deferred this practice as "Adapt later".
- **Done when.** Each quick start, and at least one guide for each package, shows its example's output from a committed file. A stale output file fails a test.
- **Enforced by.** The package's example test writes the output file and compares it. The twin flattener gets a rule for the new fence attribute or component, because it treats an unknown component as an error.

**L12v: docs for coding agents. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** Each tarball holds only `package.json`, the README, the changelog, `llms.txt`, the licences and `dist/`, so an agent that reads `node_modules` finds no guide. No package offers an `AGENTS.md` snippet, and the docs have no page for readers who work with a coding agent.
- **Done when.** `pnpm pack` lists a `docs/` folder of the package's guides as Markdown, stamped with the package's version. Each package has a short `AGENTS.md` snippet for a user's own repository. A "Use with a coding agent" page shows the snippet, and the snippet's points match the page.
- **Enforced by.** `scripts/ci/packages-pack.test.mjs` and the `llms.txt` check in `scripts/package-docs.mjs`, both extended. The change needs a changeset, because the tarball changes.

**L12w: reader-facing checks on READMEs, metadata and examples. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** [docs-writing.md](../../guidelines/docs-writing.md) covers each package's README, yet `scripts/package-docs.mjs` runs no prose rule on one, and `packages/harness/README.md` names internal ids today (`HD15`, `HD16` and `N54` at `c5772662`). Also, none of the seven `package.json` files has `keywords` or `bugs`, and the content test checks only that a page has a description. Last, no check finds an example file that no page shows, and the only line-limit check found is the capstone's (`packages/sdk/test/capstone.test.ts`).
- **Done when.** The READMEs pass the docs pages' rules for banned words and internal ids, with sentence and paragraph limits where a measurement shows they fit a README. No `package.json` description holds an internal id, every published package has `keywords` and `bugs`, and page descriptions stay within 160 characters. Every file in `packages/*/examples/` is shown on a page or listed with a reason, stays within 100 lines and imports only public entry points.
- **Enforced by.** `scripts/package-docs.mjs`, which each published package's `test` already runs, and one new docs test for unused examples. The todo first counts the violations and fixes them, then turns each rule strict, the order Lamina PDF followed. The metadata change needs a changeset.

**L12x: a changelog page, a versioning-policy page and a glossary. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** The docs site has none of the three. Each package has a `CHANGELOG.md`, and the 0.x rule is written only in `.changeset/README.md`.
- **Done when.** The changelog page renders the six packages' changelog entries by version, without commit hashes. The policy page states the 0.x rule. Each term the concept pages define has a glossary entry. If the owner accepts L12x, it also links the gateway's and the SDK's reference indexes to their guides.
- **Enforced by.** A unit test for the changelog transform; the existing content tests cover the pages.

**L12y: browser checks for the docs. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** `docs-build.yml` runs no browser. `test/logo.test.ts` draws the favicon only where Playwright is installed, which CI lacks, and `test/copy-markdown.test.ts` uses a fake clipboard. `book-build.yml` already installs a pinned Chrome for Testing build (157.0.8103.78).
- **Done when.** In headless Chrome, axe reports no violation on a home, a written and a reference page, in both themes at 390 and 1280 px. The banner shows on a `next.` hostname, the favicon reads at 16 px, and "Copy as Markdown" writes the twin's text to the real clipboard. Every figure label is at least 12 px at a 358 px width, Lamina PDF's narrowest check. These checks close "Browser checks" under Tests and the favicon item under "Unverified items".
- **Enforced by.** One browser suite and one step in `docs-build.yml`. Sessions never edit `.github/workflows/`, so the session hands the step to the owner, who commits it.

**L12z: discoverability basics and a redirect guard. Proposed (2026-11-25), awaiting the owner.**

- **Gap.** A build from `c25b00db` writes `sitemap-index.xml` and no `robots.txt`. Its pages carry no `og:image` and no JSON-LD, `astro.config.mjs` has no `redirects`, and no test guards a published path. The earlier comparison marked `redirects` "Adopt", but nothing implements them.
- **Done when.** `robots.txt` allows crawling and names the sitemap index. The `next.` host serves the same file and keeps its `X-Robots-Tag: noindex` header, because a crawler reads `noindex` only on a page it may fetch. A test fails when the sitemap and the built pages disagree. Every page names one share image in `og:image`, and the home page carries JSON-LD for the project and its repository. A committed list of published paths fails a test when a path disappears without an entry in `redirects`.
- **Enforced by.** Tests over the built site (`apps/docs/test/built-site.ts`). The redirect guard is our own design: Lamina PDF checked old addresses once in each todo. L12m's hash test must skip the JSON-LD block, which the browser never runs.

## Acceptance criteria

L12 is done when every accepted sub-todo in the split table is done and these hold on `main`. Today that means L12a to L12s. Each proposed row, L12t to L12z, counts only once the owner accepts it, and a dropped row leaves the table:

- [x] `pnpm --filter @buildanagent/docs test` and `pnpm check:api-docs` pass, with the tests covering all six packages.
- [ ] `apps/docs/src/styles/tokens.css` is generated from `docs/design/book-tokens.json`, and a test fails when it is stale.
- [ ] `apps/docs/src/styles/starlight.css` holds no hex colour, and a test fails on one.
- [ ] A contrast test recomputes every extra pair Starlight's roles create, from the shipped `tokens.css`, at 4.5:1 for text and 3:1 for other parts. These pairs stay out of `book-tokens.json`, whose manual test asserts exactly 38.
- [ ] The font files in `apps/docs/public/fonts/` are byte-identical with the book's, and a test fails when one differs.
- [x] After L12c, no built page exceeds 200 KiB (204,800 bytes) of HTML (`start/install/` was 114,268 bytes at `25cdbd41` and is 43,915 after L12c; the largest page is 141,164 bytes, 137.9 KiB). L12c keeps the 200 KiB budget, `apps/docs/test/topics.test.ts` enforces it, and L12f re-measures it.
- [x] Every page has a Markdown twin at `/<page>.md`, and a test fails on a page without one (L12l).
- [x] Every install line names `@alpha`, a test checks it, and the header shows the shared version (L12e).
- [ ] The header holds the mark and the wordmark "Build An Agent docs", and the favicon reads at 16 px.
- [ ] The docs home links to the quick start of each of the six packages, and the book, the docs and the site read their header links from one source, with a test in each app.
- [ ] Each of the four new packages has pages whose code blocks come from `file=` fences or type-check against the packages.
- [ ] Every one of the nine figures has an SVG that the stale test redraws byte for byte, and alt text that the build requires.

## Tests

- **Docs app.** New files under `apps/docs/test/`: tokens (stale file), fonts (byte identity), contrast (extra pairs), no-hex, figures (stale SVGs), version and install line, Markdown twins, home-page links, header links and, in L12m, hashes. The four existing files change for MDX, topics and the new packages.
- **Packages.** New examples carry their own tests, and a changed example commits its transcript.
- **Checks.** `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass in every sub-todo's pull request.
- **Browser checks.** A headless Chrome render checks the favicon at 16 px and the banner on a `next.` hostname; CI does not run one today.

## Docs to update

- The [plan's todo table and DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22), as sub-todos start and finish.
- `apps/docs/README.md`: the overrides table, the upgrade policy, the coupling to the book's tokens and the four new packages.
- `apps/manual/README.md`: the new `exports`, the shared header source and the coupling to the docs.
- AGENTS.md's `apps/` entry, and [docs-writing.md](../../guidelines/docs-writing.md) (L12n).
- `THIRD-PARTY-NOTICES.md` for the docs' copy of the fonts.

## Risks and open questions

**Risks**

- **Page weight is the main risk.** Each page embeds the whole sidebar, so L12c (topics) must land before L12f (the new reference). [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) gives the measurements.
- **Build and test time.** Today the build takes about 18 s and the tests 44 s (measured 2026-11-22). The study estimates 1 minute and 2 minutes with six packages.
- **Search.** The Pagefind index grows from 1.9 MB to an estimated 6 to 7 MB, loaded in chunks.
- **Starlight internals.** The component overrides and the `--sl-*` mapping depend on them. Pin exactly, move one minor version per pull request and keep the overrides table.
- **TypeScript 6.0.3** is pinned for TypeDoc, so every manual module the docs import must compile under TypeScript 6 and 7.
- **The docs checks.** They count paragraphs and next links. `pages.ts` already lists `.mdx` files, but its paragraph rules read only Markdown, so MDX, asides and figure directives need small changes to the content tests.
- **Coupling.** A change to a book token or a `fig-*` rule fails the docs' tests. That is intended, and both READMEs say so.
- **CSP hashes** change with each Starlight upgrade, and L12m's test catches it.
- **The first stable release waits for the harness work.** The owner decided on 2026-11-22 that the first stable release, and with it the docs' versioning switch to `next.docs.buildanagent.fyi`, waits until the harness work is finished. The harness work is paused and resumes later, so `main` keeps deploying docs.buildanagent.fyi until then. L12e builds the banner and the version tag now, and they take effect only at that switch.

**Unverified items from the study**

- Whether Astro 7 has its own CSP option; L12m checks it first.
- The page size, build time and search index with six packages: all are estimates until L12c and L12f measure them.
- Whether the favicon is legible at 16 px (the stroke is about 1.25 px there).

### The Lamina PDF comparison

The table rests on a direct read of the Lamina PDF repository, `laudebugs/laminapdf` at `db8e3b0` (2026-11-24), made on 2026-11-25. That read covered its plans, its todos, its guidelines and the sources of its docs app. The table replaces the one of 2026-11-22, which judged a ten-item digest from the manager session. This table keeps the digest's decisions and corrects two of them (`redirects` and the browser tests). The read did not fetch the live site at `docs.laminapdf.com`, and for most Lamina todos it covered the goal and the acceptance criteria only. It also leaves out two ideas that Lamina has not finished: question-style page titles and watching readers use the docs are both still in its `ready/` folder.

Each row gives a decision: **adopted** (it works here today), **partly adopted** (part works, and a named todo holds the rest), **deferred** (a named todo or event holds it all) or **rejected**. Lamina paths are relative to that repository, and its todos are in `docs/todos/done/` unless a row says otherwise.

| Practice | Lamina source | Decision | Where it lives here, or why not |
| --- | --- | --- | --- |
| Pages show code only from tested example files | `B7a-docs-site.md`; `apps/docs/src/components/Snippet.astro` | Adopted | `file=` fences and `apps/docs/test/fences.test.ts` (L12k) |
| An explicit sidebar that holds every page | `Q1h-docs-story.md`, `Q4f-every-page-in-the-sidebar.md`; `apps/docs/plugins/sidebar.test.mjs` | Adopted | `apps/docs/src/topics.ts`; `apps/docs/test/content.test.ts` fails on a page outside the sidebar (L12c) |
| Markdown twins, `llms.txt`, `llms-full.txt`, an alternate link and "Copy as Markdown" | `L5a-agent-docs.md`, `Q4l-markdown-for-agents-per-page.md`; `apps/docs/plugins/agent-docs.mjs` | Adopted | L12l. The copy test uses a fake clipboard; L12y would use a real one |
| Every docs deploy matches a package version | `P4-docs-match-the-release.md`; `apps/docs/plugins/release.mjs` | Adopted | L12e and DS4. Lamina sets a build-time flag for unreleased docs; one build serves both our hosts, so a script checks the hostname |
| An overrides table and a Starlight upgrade policy | `Q4j-starlight-upgrade-policy.md` | Adopted | `apps/docs/README.md`, "Components the docs override" and "Upgrading Starlight" (L12b) |
| One shared header | `W1d-one-site-header.md`; `packages/site-kit/` | Adopted | L12p, `@buildanagent/manual/site-chrome` |
| A diagram rule in the writing guideline | `docs/guidelines/docs-writing.md` | Adopted | L12n |
| A diagram kit with lint, twin and browser checks | `Q3a-diagram-kit-and-first-diagram.md`; `apps/docs/test/diagrams.test.mjs`, `apps/docs/test/browser/diagrams.browser.test.ts` | Partly adopted | L12d and L12k draw and test the figures. No rendered check of label size or forced colours runs; L12y holds it. We took the forced-colour rules but not Lamina's two figure layouts |
| A prose check on every reader page | `Q1b-docs-prose-check.md`, `Q1l-docs-checks-strict.md` | Partly adopted | `apps/docs/test/content.test.ts` checks the docs pages. Package READMEs get no prose check and descriptions no length limit; L12w holds both |
| Internal ids kept out of reader text and package metadata | `Q1k-internal-ids-out-of-reader-text.md`, `W3c-package-metadata.md` | Partly adopted | The content test covers the docs pages and `pnpm check:ids` covers comments in `packages/*/src`. READMEs and `package.json` descriptions wait for L12w |
| Example rules checked by tools, and every example shown or listed as unused | `Q1c-examples-checks.md`; `crates/laminapdf/examples/UNUSED.md` | Partly adopted | [examples.md](../../guidelines/examples.md) states the rules, and one test checks the capstone's length. L12w holds the checks |
| Package metadata written for users | `W3c-package-metadata.md` | Partly adopted | The descriptions read well; no package has `keywords` or `bugs`. L12w |
| API friction that examples expose is fixed in the API | `Q1d-example-api-cleanups.md` | Deferred | A recorded step in L12g to L12j (amended 2026-11-25) |
| Each quick start is a real program, and no page shows a test file | `Q1e-quick-start-apps.md`, `Q4e-rust-and-cli-first-runs.md` | Partly adopted | The fence test admits only example files. The four new packages get quick starts in L12g, L12h and L12j |
| Troubleshooting written symptom first, by area | `Q1j-recipes-and-troubleshooting.md`, `Q4h-troubleshooting-by-area.md` | Deferred | "Problems and fixes" sections in L12h to L12j (amended 2026-11-25) |
| Command-line output comes from real runs | `Q4a-cli-output-from-real-runs.md`; `fixtures/cli/transcripts/`, `apps/docs/test/transcripts.test.mjs` | Deferred | A requirement of L12g (amended 2026-11-25) |
| Usage pages linked from the generated reference | `Q4o-usage-pages-for-document-and-builder.md` | Partly adopted | The guides exist. The links are a follow-up to L12f, in L12g to L12j and L12x |
| A strict CSP, with code colours as classes | `Q4i-code-colours-by-class.md`; `apps/docs/README.md` | Deferred | The docs send no CSP today. L12m, which waits on question 9b, holds the script hashes, a rebuild-and-compare test, a `style-src` decision and the line limit |
| Version-matched docs inside the package | `L5a-agent-docs.md`; `packages/sdk/package.json` (`files`) | Partly adopted | Each tarball ships `llms.txt`. L12v would add the guides |
| One crawler policy, with `noindex` off production | `W3a-crawl-and-index-rules.md` | Partly adopted | `scripts/ci/site-stage-dist.mjs` sets `X-Robots-Tag`. No `robots.txt`; L12z |
| A moved page keeps its old address | `Q1h-docs-story.md`; `apps/docs/README.md` | Deferred | L12z. `astro.config.mjs` has no `redirects` and no test guards a published path. The 2026-11-22 table said "Adopt" |
| One page for each error code, checked against the code list | `L1b-error-contract-codegen.md`; `docs/errors/` (249 files), `apps/docs/plugins/error-pages.mjs` | Deferred | L12t |
| The example's result beside its code | `B7d-docs-example-results.md`, `Q4d-result-beside-the-code.md`; `apps/docs/src/components/Example.astro` | Deferred | L12u |
| An `AGENTS.md` snippet for users and a "Coding agents" page | `L5a-agent-docs.md`; `packages/sdk/examples/AGENTS.md`, `apps/docs/src/content/docs/start/coding-agents.mdx` | Deferred | L12v |
| A changelog page, a stability-policy page and a glossary | `P3-registry-checks.md`, `Q1h-docs-story.md`; `apps/docs/src/content/docs/reference/` (`changelog.mdx`, `stability.mdx`, `glossary.mdx`) | Deferred | L12x |
| Browser tests with axe | `apps/docs/e2e/` | Deferred | L12y. The 2026-11-22 table deferred them because `.github/` is out of scope; the owner commits the workflow step |
| A share image and JSON-LD | `W3d-structured-data-and-share-tags.md` | Deferred | L12z. Sitemap `lastmod` stays out: it needs the full git history at build time |
| A repository link checker | `X1-docs-link-checker.md` | Deferred | [X5](../done/X5-repository-link-check.md), outside L12 and done. A nightly check of external links (`X3c-nightly-link-check.md`) can follow it |
| "Added in" markers on every export | `Q4n-since-markers-and-versions.md`; `apps/docs/scripts/since.mjs` | Deferred | The todo that makes the first stable release; every export is an alpha until then |
| A rename log that a check ties to deprecations | `L5a-agent-docs.md`; `docs/renames.json` | Deferred | The first stable release. Under 0.x a `minor` may break the API, so a rename log has nothing stable to map from |
| An agent eval of the docs | `L5a-agent-docs.md`; `docs/todos/ready/L5b-agent-eval-baseline.md` | Rejected for L12 | It belongs with the harness eval todos (N36 to N38). Lamina's baseline run is still `ready`, so it has no result to copy |
| In-browser "Edit and run" | `B7e-docs-edit-and-run.md` | Rejected | Lamina's runner page needs `'unsafe-eval'`, and our examples need a model. In the research Lamina cites, 8 of 215 "best docs" answers mention interactivity (`docs/plans/docs-redesign.md`) |
| Each area on one page, and the guide as a PDF | `Q4k-one-page-and-pdf-docs.md` | Rejected | Lamina builds the PDF with its own library, as a demonstration. `llms-full.txt` already gives the docs as one file |
| A Context7 listing | `W3f-agent-discovery.md`, `W3j-context7-rules.md`; `context7.json` | Rejected | The owner answered no to question 9a on 2026-11-23 |
| Rust and WebAssembly specifics | `Q1c-examples-checks.md` (`clippy-examples`), `Q1e-quick-start-apps.md` | Rejected | We ship TypeScript only: no Rust twins of examples, no per-runtime install checks, no rendered page pictures |
| An answer-engine check | `W3i-answer-engine-check.md` | Rejected | A full run of 60 answers costs about $4 and is not deterministic. It measures little while every package is an alpha |
| Twoslash hover types | `Q4p-twoslash-spike.md`; `spikes/docs-twoslash/` | Rejected | Lamina's spike measured 24.5 KB of script on every page and 953 `style=` attributes on the page with hovers, which a strict CSP blocks. Its hovers never open by keyboard |
| A "choosing a library" page | `W3g-choosing-a-pdf-library.md` | Rejected as a todo | Every comparative claim needs the owner's approval, so it is an owner question (10, below). `docs/comparison/` holds the material |
| "Pagefind disabled until loaded" | The 2026-11-22 digest | Rejected | Starlight already handles Pagefind loading |

## Owner questions

The sub-todos assume the answers in brackets. The owner answered Q1, Q3 and Q5 on 2026-11-22 (relayed by the manager session); the manager set the other defaults the same day.

1. **The logo slot.** Answered 2026-11-22: the slot holds the mark plus a wordmark that reads "Build An Agent docs", with "Build An Agent" in title case and "docs" in the lighter mono style; the mark alone is fine on narrow widths. The favicon is the same mark.
2. **Search.** [Keep Pagefind, and index the generated API pages at a lower weight.] Default set 2026-11-22.
3. **The home page.** Answered 2026-11-22: redesign it now, in L12, as L12o. It is separate from the `apps/site` landing page but reuses its figure style and tone, and it leads readers to the six packages' quick starts.
4. **Versioning.** [A "Docs for main" link and banner now, and a real version switcher only once old releases are archived.] Default set 2026-11-22.
5. **The header across sites.** Answered 2026-11-22: yes. One shared header carries links across Book, Docs and Site (Docs, Manual, Site, GitHub) with a consistent mark and wordmark per site, planned as one small shared source (L12p). The manual is not redesigned, but its header reads that source.
6. **Diagram style.** [The book's flat panel on grid paper.] Default set 2026-11-22.
7. **Dark mode.** [Follow the system, as the book does.] Default set 2026-11-22.
8. **Body font.** [Literata, matching the book.] Default set 2026-11-22.
9a. **Context7.** Answered 2026-11-23: no. The default set on 2026-11-22 was also no, and [L12l](../done/L12l-docs-markdown-twins.md) wrote no `context7.json`.
9b. **Strict CSP.** Still open. [No; L12m waits for the answer.]
10. **A "which SDK should I use" page.** Proposed 2026-11-25 and open. Lamina PDF has a page that compares libraries, with a source and a date for each fact. Ours would draw on `docs/comparison/`, and the owner would approve every comparative claim. [No page until the owner asks for one.]

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
