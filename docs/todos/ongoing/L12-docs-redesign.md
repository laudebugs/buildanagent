# L12: Redesign apps/docs to match the book's theme, with diagrams, tested examples and the harness packages

| Field | Value |
| --- | --- |
| ID | `L12` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L5](../done/L5-docs-app.md), [L6](../done/L6-api-reference.md), [L8](../done/L8-cloudflare-deploys.md) |
| Size | L (the umbrella: it stays `ongoing` and closes when L12a to L12n are done) |

## Goal

Redesign the docs site at `docs.buildanagent.fyi` so it looks like the book at `manual.buildanagent.fyi` and works like a modern reference site: navigation, page anatomy, code tabs, callouts, an API reference layout, search, copy buttons and versioning. Add flat SVG diagrams drawn by scripts, tested code examples where they help, and pages for the protocol, harness and CLI packages. The owner asked for it on 2026-11-22.

## Context

- The owner's request, relayed by the manager session on 2026-11-22: study the Lamina PDF docs site's features, match the book's theme from `docs/design/book-tokens.json` through a generated tokens file, include diagrams and tested examples, keep the docs checks passing, add harness-package pages, and leave a header slot for a logo the owner has not chosen.
- The study's report (2026-11-22, a read-only pass over this repository at `6a6a690c`), whose findings this todo and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) record. Its measurements come from the worktree; its Lamina PDF comparison rests on the manager session's digest, not on a read of that repository.
- [`apps/docs/README.md`](../../../apps/docs/README.md) and [ADR 0048](../../decisions/0048-docs-on-astro-starlight.md): the docs app today.
- [`apps/manual/README.md`](../../../apps/manual/README.md): how the book generates its tokens, self-hosts its fonts and draws its figures.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the rules the pages and examples follow.

## Scope

L12 is the umbrella for the redesign. It stays `ongoing`, no pull request closes it, and it moves to `done/` when L12a to L12n are done. Each sub-todo gets its own file, made from [TEMPLATE.md](../TEMPLATE.md) when someone starts it, so this change creates none.

**In scope**

- **Theme.** `apps/docs` reuses the book's tokens: a generated `tokens.css`, a mapping onto Starlight's `--sl-*` properties, two Expressive Code themes made from the code panels' colours, the book's self-hosted fonts and a contrast test for the pairs Starlight adds (L12a).
- **Chrome and navigation.** A logo slot and favicon, restyled theme select, footer and asides, MDX support for tabs, install tabs, and a sidebar split into topics so a page carries only its topic's links (L12b, L12c).
- **Diagrams.** A figure pipeline built on the book's `svgkit`, and nine figures: `package-map`, `run-loop`, `stream-and-transcript`, `stop-reasons`, `approval-pause`, `gateway-adapters`, `session-log`, `sandbox-egress` and `protocol-clients` (L12d, and figures 3 to 9 inside L12g, L12h, L12i and L12k).
- **Versioning.** A version tag in the header, an "Unreleased docs for `main`" banner on `next.docs.buildanagent.fyi`, an `@alpha` install-line test and a "Docs for main" link (L12e). [DS4](../../plans/publish-and-docs.md#ds4-the-docs-follow-main-until-010-then-releases-accepted) is unchanged.
- **Content.** A generated API reference for the protocol, harness, CLI and agent-safety packages, pages for each of the four, `file=` fences on the existing pages, a gateway page and new tested examples (L12f to L12k).
- **Machine readers.** Markdown twins of every page, `llms.txt` and `llms-full.txt`, "Copy as Markdown" (L12l) and a strict Content Security Policy (L12m).
- **Rules.** A diagrams, callouts and tabs section in [docs-writing.md](../../guidelines/docs-writing.md) (L12n).

**Out of scope**

- **The logo files.** The owner chose logo 3, "the prompt": a rounded-square outline (50 by 50 in a 64-unit box, stroke 5, corner radius 11) that holds a chevron `>` in the text colour and a short caret in the accent. The accent is `#B04E29` on the light theme and `#E8A27C` on the dark one, and the text colour is `#2A1E16` and `#F4EADC`. The manager hands over the final SVG files. L12b builds the slot: the header takes an inline SVG, and the same mark is the favicon, which a test or a headless render checks at 16 px.
- **The `apps/site` landing page.** A separate todo redesigns it, and it is the third consumer that would justify a shared `packages/design`.
- **`.github/workflows/`.** Sessions never edit it. L12m's `_headers` file is not a workflow: `site-stage-dist.mjs` already deploys main's `apps/docs/public/_headers`.

## Tasks

The first two tasks are done: the study is the plan, and the table below is the split. Each sub-todo is one pull request, and the **Model** column follows the [subagent rule](../../../AGENTS.md#subagents-run-on-the-model-their-work-needs).

- [x] Study the current app, the book's design pipeline and the Lamina PDF practices, and record the plan in [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22).
- [x] Split this todo into the sub-todos below.
- [ ] Get the owner's answers to the nine questions (below), then start the sub-todos in the order given.

| Todo | Delivers | Depends on | Size | Model |
| --- | --- | --- | --- | --- |
| L12a | The manual's `exports` and a parameterised `tokensCss()`; the docs' `generate-tokens`, `tokens.css`, font copy, `starlight.css` mapping, Expressive Code themes, `Head` preload, and the contrast, stale-file, font and no-hex tests | This plan | M | Opus (design tooling) |
| L12b | `SiteTitle` with the logo slot and favicon, restyled `ThemeSelect`, `Footer` and asides; MDX support in `pages.ts`; install tabs; the README's overrides table and upgrade policy | L12a | M | Sonnet, with an Opus high review |
| L12c | The sidebar topics plugin; the sidebar tests rewritten for order and next links per topic; page-size measurement | L12a | S to M | Sonnet |
| L12d | The figure pipeline (directive, inliner, sanitiser, `figures:build`, stale test, forced colours) and figures 1 and 2 | L12a | M | Opus (tooling, untrusted-SVG sanitising) |
| L12e | The version tag, the `next.` banner script, the `@alpha` install-line test and the "Docs for main" link | L12b | S | Sonnet |
| L12f | The API reference for the four packages, the `.gitignore` entries and the test; build time, size and Pagefind measured | L12c | S to M | Sonnet |
| L12g | The protocol and CLI pages, the protocol examples and figure 9 | L12d, L12f | M | Sonnet |
| L12h | Harness pages, part 1 (overview, sessions, context, tools) and figure 7 | L12g | M | Sonnet |
| L12i | Harness pages, part 2 (permissions, sandbox, server, extensions) and figure 8 | L12h | M | Sonnet (Opus for any run of the sandbox and credentials example) |
| L12j | The agent-safety pages and examples | L12f | M | Sonnet |
| L12k | `file=` fences on the existing pages, the gateway page and figures 3 to 6 | L12d | M | Sonnet |
| L12l | Markdown twins, `llms.txt`, `llms-full.txt` and "Copy as Markdown" | L12b | M | Sonnet |
| L12m | The CSP `_headers` file with script hashes, and its test | L12b, L12l | S to M | Opus (security) |
| L12n | The docs-writing.md rules for diagrams, callouts and tabs, in a pull request of its own | None | S | Sonnet |

**Order.** L12n and L12a first. Then L12b, L12c and L12d in parallel. Then L12e and L12f. Then L12g, L12h and L12i in sequence, with L12j and L12k beside them. L12l and L12m last.

## Acceptance criteria

L12 is done when L12a to L12n are done and these hold on `main`:

- [ ] `pnpm --filter @buildanagent/docs test` and `pnpm check:api-docs` pass, with the tests covering all six packages.
- [ ] `apps/docs/src/styles/tokens.css` is generated from `docs/design/book-tokens.json`, and a test fails when it is stale.
- [ ] `apps/docs/src/styles/starlight.css` holds no hex colour, and a test fails on one.
- [ ] A contrast test recomputes every extra pair Starlight's roles create, from the shipped `tokens.css`, at 4.5:1 for text and 3:1 for other parts. The manual's test still asserts exactly 38 pairs, so these pairs stay out of `book-tokens.json`.
- [ ] The font files in `apps/docs/public/fonts/` are byte-identical with the book's, and a test fails when one differs.
- [ ] After L12c, no built page exceeds 200 KB of HTML (today `start/install/` is 103 KB with 258 reference links). L12c may revise the budget with its measurement, and L12f re-measures it with all six packages.
- [ ] Every page has a Markdown twin at `/<page>.md`, and a test fails on a page without one.
- [ ] Every install line names `@alpha`, a test checks it, and the header shows the shared version.
- [ ] The header holds the logo slot, and the favicon reads at 16 px.
- [ ] Each of the four new packages has pages whose code blocks come from `file=` fences or type-check against the packages.
- [ ] Every one of the nine figures has an SVG that the stale test redraws byte for byte, and alt text that the build requires.

## Tests

- **Docs app.** New files under `apps/docs/test/`: `tokens.test.ts` (stale file), `fonts.test.ts` (byte identity), `contrast.test.ts` (extra pairs), a port of the manual's `styles.test.ts` (no hex), `figures.test.ts` (stale SVGs and allowed elements), a version and install-line test, a Markdown-twin test and, in L12m, a hash test. The existing four files change for MDX, topics and the new packages.
- **Packages.** New examples carry their own tests and, where a package's `knip` config needs it, an `entry`. A changed example commits its transcript.
- **Checks.** `pnpm check`, `pnpm typecheck`, `pnpm test` and the four maintainability checks pass in every sub-todo's pull request.
- **Browser checks.** The favicon at 16 px and the banner on a `next.` hostname are checked in a headless Chrome render, which CI does not run today.

## Docs to update

- The [plan's todo table and DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22), as sub-todos start and finish.
- `apps/docs/README.md`: the overrides table, the upgrade policy, the coupling to the book's tokens and the four new packages.
- `apps/manual/README.md`: the new `exports` and the coupling to the docs.
- AGENTS.md's `apps/` entry, and [docs-writing.md](../../guidelines/docs-writing.md) (L12n).
- `THIRD-PARTY-NOTICES.md` for the docs' copy of the fonts.

## Risks and open questions

**Risks**

- **Page weight is the main risk.** Each page embeds the whole sidebar. At 100 KiB for `start/install/` and 258 reference links, a link costs about 0.4 KB. With the four packages the reference holds 968 exports (253 today), so a page would carry about 980 links, roughly 350 to 390 KB, and `dist/` would grow from 32 MB to roughly 300 MB across about 1,000 pages. L12c (topics) therefore lands before L12f (the new reference).
- **Build and test time** is 19 s and 42 s today; the study estimates 1 minute and 2 minutes with six packages.
- **Search.** The Pagefind index grows from 1.9 MB to an estimated 6 to 7 MB, loaded in chunks.
- **Starlight internals.** The `SiteTitle`, `PageTitle`, `Head`, `Footer` and `ThemeSelect` overrides and the `--sl-*` mapping depend on Starlight's internals. Pin exactly, move one minor version per pull request and keep the overrides table.
- **TypeScript 6.0.3** is pinned for TypeDoc, so every manual module the docs import must compile under TypeScript 6 and 7.
- **The docs checks** count paragraphs and next links, so MDX, asides and figure directives need small `pages.ts` changes and tests.
- **Coupling.** A change to a book token or a `fig-*` rule makes the docs stale and their tests fail. That is intended, and both READMEs say so.
- **CSP hashes** change with each Starlight upgrade, and L12m's test catches it.

**Unverified items from the study**

- Whether Astro 7 has its own CSP option; L12m checks it first.
- The page size, build time and search index with six packages: all are estimates until L12c and L12f measure them.
- Whether the favicon is legible at 16 px (the stroke is about 1.25 px there).
- How the digest's practices work in Lamina itself: see below.

**The Lamina PDF comparison.** Nobody on our side read the Lamina PDF repository for this todo: access was not granted in this session. Every Lamina practice below comes from the manager session's digest ("digest from the manager's read"), which lists ten items, and the study judged each against our repository. The earlier plan work read the repository at `7b4b37b` (see the fact-check log) but not its docs site for these practices.

| Digest item | Decision | Reason |
| --- | --- | --- |
| An explicit sidebar list, and `redirects` for moved pages | Adopt | We already keep the explicit list; `redirects` cover pages L12 moves. |
| A Code and Output `<Example>` component | Adapt later | Take the output from `results/transcripts` once pages need it. |
| In-browser edit and run | Reject for now | It needs a large bundle, a worker and CSP exceptions. |
| A build-time flag for unreleased docs | Adapt to runtime | `docs-deploy.yml` builds `main` once and deploys that build to both hosts, so a script that checks the hostname shows the banner. |
| Markdown twins, `llms.txt` and "Copy as Markdown" | Adopt | Agents and readers get the text without HTML; a test fails on a page without a twin. |
| `@since` per export | Defer | Every export is 0.1.0-alpha until the first stable release. |
| Two figure layouts, wide and narrow, and forced-colour rules | Adapt | Take the forced-colour rules; the book scrolls one stage sideways instead of keeping two layouts. |
| A strict CSP | Adapt | An Opus todo (L12m) with hashes, a rebuild-and-compare test and a check of Astro's own option. |
| An overrides table and an upgrade policy | Adopt | They go in `apps/docs/README.md` (L12b). |
| Late features: one-page view, PDF, og:image, JSON-LD, sitemap `lastmod`, three-browser end-to-end tests with axe, "Pagefind disabled until loaded", and a diagram line in the guideline | Defer the first six; reject "Pagefind disabled until loaded"; adopt the guideline line | CI needs a browser step and `.github/` is out of scope; Starlight already handles Pagefind loading; L12n adds the guideline line. |

## Owner questions

The sub-todos assume the answers in brackets until the owner replies.

1. **The logo slot.** Does the header show the mark and the wordmark "buildanagent docs", or the mark alone? [Mark at 28 px beside the wordmark.] Is the favicon the same mark? [Yes.]
2. **Search.** Keep Pagefind, and index the generated API pages? [Keep it; index them at a lower weight.]
3. **The home page.** Redesign it in L12, as a hero with the package map and three entry paths, or later? [Later.]
4. **Versioning.** A "Docs for main" link and banner now, and a real version switcher only once old releases are archived? [Yes.]
5. **The header across sites.** Add Book, Docs and Site links to all three sites, which touches the manual and the site? [No, not in L12.]
6. **Diagram style.** The book's flat panel on grid paper, or plain backgrounds? [The book's panel.]
7. **Dark mode.** Follow the system, as the book does? [Yes.]
8. **Body font.** Literata, matching the book, or a sans-serif for reference density? [Literata.]
9. **Machine readers.** Publish a `context7.json`, and is the strict CSP (L12m) wanted now? [Neither until answered; L12m waits.]

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
