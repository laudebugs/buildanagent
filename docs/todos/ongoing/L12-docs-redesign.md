# L12: Redesign apps/docs to match the book's theme, with diagrams, tested examples and the harness packages

| Field | Value |
| --- | --- |
| ID | `L12` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L5](../done/L5-docs-app.md), [L6](../done/L6-api-reference.md), [L8](../done/L8-cloudflare-deploys.md) |
| Size | L (the umbrella: it stays `ongoing` and closes when L12a to L12p are done) |

## Goal

Redesign the docs site at `docs.buildanagent.fyi` so it looks like the book at `manual.buildanagent.fyi` and works like a modern reference site: navigation, page anatomy, code tabs, callouts, an API reference layout, search, copy buttons and versioning. Add flat SVG diagrams drawn by scripts, tested code examples where they help, and pages for the protocol, harness and CLI packages. The owner asked for it on 2026-11-22.

The owner's part: Q1, Q3 and Q5 are answered (2026-11-22), the manager set the defaults for Q2, Q4, Q6 to Q8 and 9a that day, and only question 9b holds anything back (L12m).

Status of L12o (2026-11-23): the docs home page is rebuilt as design A, a centred welcome with the install line and a grid of six package cards (`index.mdx`, `starlight.css`, `test/home.test.ts`). The gateway and SDK cards lead to the Install and first-agent pages; the harness, agent-safety, protocol and CLI cards lead to their READMEs on GitHub, because the docs have no quick start for them until L12g to L12i land. Then those four cards move to the new pages. L12o depends only on L12a and L12b: the manager's message of 2026-11-23 records the owner's choice of design A, which has no illustration, so it needs no figure from L12d.

## Context

- The owner's request, relayed by the manager session on 2026-11-22: study the Lamina PDF docs site's features, match the book's theme from `docs/design/book-tokens.json` through a generated tokens file, include diagrams and tested examples, keep the docs checks passing, add harness-package pages, and leave a header slot for the logo files the manager will hand over (the owner has since chosen logo 3 and answered questions 1, 3 and 5; see Out of scope and Owner questions).
- The study (2026-11-22) was a read-only pass over this repository at `6a6a690c`; this todo and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22) record its findings. Its measurements come from the worktree.
- [`apps/docs/README.md`](../../../apps/docs/README.md) and [ADR 0048](../../decisions/0048-docs-on-astro-starlight.md): the docs app today.
- [`apps/manual/README.md`](../../../apps/manual/README.md): how the book generates its tokens, self-hosts its fonts and draws its figures.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the rules the pages and examples follow.

## Scope

L12 is the umbrella for the redesign. It stays `ongoing`, no pull request closes it, and it moves to `done/` when L12a to L12p are done. Each sub-todo gets its own file, made from [TEMPLATE.md](../TEMPLATE.md) when someone starts it, so this change creates none.

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
| L12g | The protocol and CLI pages, their examples and figure 9 | L12d, L12f | M | Sonnet |
| L12h | Harness pages, part 1 (overview, sessions, context, tools) and figure 7 | L12g | M | Sonnet |
| L12i | Harness pages, part 2 (permissions, sandbox, server, extensions) and figure 8 | L12h | M | Sonnet (Opus for any run of the sandbox and credentials example) |
| L12j | The agent-safety pages and examples | L12f | M | Sonnet |
| L12k | `file=` fences on the existing pages, the gateway page and figures 3 to 6 | L12d | M | Sonnet |
| L12l | Markdown twins, `llms.txt`, `llms-full.txt`, "Copy as Markdown" and, if 9a is yes, `context7.json` | L12b | M | Sonnet |
| L12m | The CSP `_headers` file with script hashes, and its test | L12b, L12l | S to M | Opus (security) |
| L12n | The docs-writing.md rules for diagrams, callouts and tabs | None | S | Sonnet |
| L12o | The docs home page redesign: it leads readers to the quick starts of the gateway, SDK, agent-safety, protocol, harness and CLI, as design A: six package cards and no illustration | L12a, L12b | M | Sonnet |
| L12p | One shared header source for the book, the docs and the site: links Docs, Manual, Site and GitHub, plus each site's mark and wordmark ([DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22)) | L12b | S to M | Sonnet (Opus if it touches a shared package's build) |

**Order.** Start with L12n and L12a. L12b, L12c and L12d follow in parallel, then L12e, L12f and L12p. L12g, L12h and L12i run in sequence, with L12j, L12k and L12o beside them. L12l and L12m go last.

L12o no longer depends on L12d: the owner chose package cards without an illustration for the docs home (2026-11-23).

**L12b progress (2026-11-23).** L12b has no todo file of its own, so this paragraph records its outcome. It shipped four changes in `apps/docs`: a `SiteTitle` override that draws logo 3 inline beside the wordmark "Build An Agent docs" (the mark alone below 30rem, with the wordmark kept for screen readers); a compact, rule-bordered theme select that adds no colour pair; MDX support in the content checks (`src/plugins/pages.ts`, `test/mdx.test.ts`) with package-manager tabs on the Install page; and the overrides table and the Starlight upgrade policy in `apps/docs/README.md`. The favicon is the one from the merged landing-page change. `test/logo.test.ts` checks its structure always and draws it at 16 px in headless Chromium where Playwright is installed, so the 16 px question under "Unverified items" is answered locally but not in CI, which has no Playwright. Screenshots at 1280 and 390 px in both modes showed that the footer and asides needed no change. Claims are in [the fact-check log](../../plans/reviews/fact-check-publish-and-docs.md), rows `L12b-1` to `L12b-15`.

## Acceptance criteria

L12 is done when L12a to L12p are done and these hold on `main`:

- [ ] `pnpm --filter @buildanagent/docs test` and `pnpm check:api-docs` pass, with the tests covering all six packages.
- [ ] `apps/docs/src/styles/tokens.css` is generated from `docs/design/book-tokens.json`, and a test fails when it is stale.
- [ ] `apps/docs/src/styles/starlight.css` holds no hex colour, and a test fails on one.
- [ ] A contrast test recomputes every extra pair Starlight's roles create, from the shipped `tokens.css`, at 4.5:1 for text and 3:1 for other parts. These pairs stay out of `book-tokens.json`, whose manual test asserts exactly 38.
- [ ] The font files in `apps/docs/public/fonts/` are byte-identical with the book's, and a test fails when one differs.
- [ ] After L12c, no built page exceeds 200 KB of HTML (today `start/install/` is 103 KB). L12c may revise the budget with its measurement, and L12f re-measures it.
- [ ] Every page has a Markdown twin at `/<page>.md`, and a test fails on a page without one.
- [ ] Every install line names `@alpha`, a test checks it, and the header shows the shared version.
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

**The Lamina PDF comparison.** Every practice below comes from the manager session's digest ("digest from the manager's read"), which lists ten items, and the study judged each against our repository. No one on our side read that repository's docs site. The earlier plan work read the repository at `7b4b37b` (see the fact-check log) but not its docs site.

| Digest item | Decision | Reason |
| --- | --- | --- |
| An explicit sidebar list, and `redirects` for moved pages | Adopt | We keep the explicit list; `redirects` cover pages L12 moves. |
| A Code and Output `<Example>` component | Adapt later | Use `results/transcripts` once pages need it. |
| In-browser edit and run | Reject for now | It needs a large bundle, a worker and CSP exceptions. |
| A build-time flag for unreleased docs | Adapt to runtime | `docs-deploy.yml` deploys one build to both hosts, so a script that checks the hostname shows the banner. |
| Markdown twins, `llms.txt` and "Copy as Markdown" | Adopt | Agents and readers get the text without HTML; a test fails on a page without a twin. |
| `@since` per export | Defer | Every export is 0.1.0-alpha until the first stable release. |
| Two figure layouts and forced-colour rules | Adapt | Take the forced-colour rules; the book scrolls one stage sideways. |
| A strict CSP | Adapt | L12m: hashes, a rebuild-and-compare test and a check of Astro's own option. |
| An overrides table and an upgrade policy | Adopt | They go in `apps/docs/README.md` (L12b). |
| One-page view, PDF, og:image, JSON-LD, sitemap `lastmod`, three-browser end-to-end tests with axe | Defer | CI needs a browser step, and `.github/` is out of scope. |
| "Pagefind disabled until loaded" | Reject | Starlight already handles Pagefind loading. |
| A diagram line in the guideline | Adopt | L12n adds it. |

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
9a. **Context7.** [No. If yes, L12l adds a `context7.json`.] Default set 2026-11-22.
9b. **Strict CSP.** Still open. [No; L12m waits for the answer.]

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
