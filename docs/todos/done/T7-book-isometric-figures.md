# T7: Isometric and interactive figures: the vendored anatomy skill, its audits and inline fragments

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T7` |
| Status | `done` |
| Plan | [Book plan §5, BK10 and BK11](../../plans/build-book.md#bk11-generated-checked-inlined-figures-that-work-without-javascript-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T6](../done/T6-book-flat-figures.md), [T8](../done/T8-book-ci.md) |
| Size | M |

## Goal

Make the three isometric centerpieces possible and keep them honest. This todo vendors a pinned copy of the anatomy skill, wires its geometry audit and line check into the book's CI job, and lets a chapter inline an interactive figure as an HTML fragment that works without JavaScript.

## Context

- [Book plan BK10 and BK11](../../plans/build-book.md#bk10-flat-diagrams-and-a-few-isometric-centerpieces-accepted): the three centerpieces (T10, T20, T22).
- The anatomy skill, MIT, from [wheresryan22/anatomy](https://github.com/wheresryan22/anatomy) (commit `1482e84` on `main`, 2026-10-18): `SKILL.md`, `kit/audit.mjs`, `scripts/lines.mjs` and [`references/verify.md`](https://github.com/wheresryan22/anatomy/blob/main/references/verify.md).
- [`.agents/skills/README.md`](../../../.agents/skills/README.md): how skills are laid out in this repo.
- The garment repository's `rehype-figures.mjs` `viewer:` fragments at commit `bca44b0`.

## Scope

**In scope**

- `.agents/skills/anatomy/` at commit `1482e84`, with its LICENSE and NOTICE, and a THIRD-PARTY-NOTICES.md entry
- A `viewer:` image source that inlines a fragment, prefixes its ids and keeps the alt text as a hidden paragraph
- The audit (`node build.mjs --audit`) and line check (`scripts/lines.mjs`, both themes) as a `figures:audit` script, added to T8's CI job
- One small sample centerpiece that passes both checks
- Isometric analogy illustrations (BK22): the `analogy` figure kind from T6 drawn with the anatomy skill, using the book's tokens, under the same audits

**Out of scope** (and which todo covers it)

- The three chapter centerpieces (T10, T20, T22), which stay exact technical diagrams; their chapters' analogy illustrations are separate flat figures (BK10)

## Tasks

- [x] Copy the skill at commit `1482e84` into `.agents/skills/anatomy/` (the owner approved vendoring it, 2026-11-19: "yes"), keep its LICENSE and NOTICE, and record the commit in THIRD-PARTY-NOTICES.md (upstream has no NOTICE file at that commit; see the Outcome).
- [x] Extend the figure plugin with `viewer:` fragments: inline, no iframe, ids prefixed, a complete static first paint, and scripts loaded as modules that only add motion and controls.
- [x] Write `figures:audit`, which builds each isometric figure with `--audit`, runs `scripts/lines.mjs` on its light and dark pages, and fails unless they print `audit passed` and `line ends: 0`.
- [x] Add `figures:audit` to the `book` job from T8, with headless Chrome, and record how long it takes (about 19 seconds locally).
- [x] Build the sample centerpiece, embed it in a fixture chapter and check it with JavaScript off.
- [x] Map the anatomy skill's palette to `docs/design/book-tokens.json`'s panel tokens for each mode (`panelLight` for the light page, `panelDark`, C1 Ember, for the dark page), and build each isometric figure, analogy illustrations included, once per theme.

## Acceptance criteria

- [x] `.agents/skills/anatomy/` exists with its LICENSE and NOTICE, and THIRD-PARTY-NOTICES.md records its commit (no NOTICE exists upstream)
- [x] The sample centerpiece prints `audit passed` and `line ends: 0` on both themes, and the CI job fails when either check fails
- [x] With JavaScript off, the sample shows its complete static figure and its caption
- [x] Two inlined fragments on one page share no element id
- [x] An isometric figure of the `analogy` kind passes the register check from T6 and the same audits as a technical figure
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (on macOS all pass except `verify/copilot-sdk`, which needs Linux's `unshare` and runs in CI)

## Tests

The `figures:audit` script in CI; Vitest tests for the `viewer:` source and id prefixing.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout: the vendored skill
- `apps/manual/README.md`: how to add an isometric figure

## Risks and open questions

- Full audits can be slow (plan risk 4); if the job exceeds ten minutes, audit only the figures a pull request changes and run every figure nightly.
- Vendoring a skill means updating it by hand; record the upstream commit so the next update can diff.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally (on macOS all pass except `verify/copilot-sdk`); not pushed yet, by the coordinator's instruction
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- **The skill.** `.agents/skills/anatomy/` holds `wheresryan22/anatomy` at commit `1482e84`, MIT, with its `LICENSE` unchanged. Upstream has no NOTICE file at that commit, so none was copied. Four kinds of file are left out. The built example pages, the printed PDFs and the upstream `.github/` folder are generated or serve only the upstream repository, and they were 25.7 MB of the 27 MB tarball. By the owner's decision of 2026-11-19, the files that publish a figure to the skill's community gallery are left out too: `scripts/publish.mjs`, `scripts/session.mjs`, `scripts/fingerprint.mjs`, their two tests and `references/publish.md`. Every copied file is byte-identical to the tarball's, `SKILL.md` and the kit, audit and line check included. Because nothing was edited, a few of the copy's docs name files it lacks. THIRD-PARTY-NOTICES.md records the commit, the four exclusions, those dangling references and how to update; Biome skips the folder, and `.agents/skills/README.md` says that agents here never publish figures to the gallery or read session logs.
- **What its scripts do.** The book runs two of them. `kit/audit.mjs` is pure computation: it prints its report and `audit passed`, and marks a failure in the exit code. `scripts/lines.mjs` starts `scripts/drive.mjs`, which launches a local headless Chrome with a temporary profile, talks to it on 127.0.0.1 and writes a PNG only when asked. Two upstream scripts did more: `scripts/publish.mjs` pushes to GitHub and opens a pull request on the community gallery, with `--submit`, and `scripts/session.mjs` reads Claude Code session logs to time a figure for it. Neither is in the copy now. The repository has no `package.json`, so nothing runs on install.
- **Fragments.** An isometric figure is `figures/<chapter>/<id>.ts`, drawn through `figures/lib/isokit.ts`. Its `IsoParts` draws each slab or cylinder with the kit and records the same shape for the audit. `figures:build` writes the kit's card as `<id>.html`, and the staleness test covers it. A chapter places it with `::viewer{alt="…"}`, the directive form of the garment book's `viewer:` source. The build inlines it with no iframe, on T6's scrolling stage, with the alt text as a visually hidden paragraph, the drawing hidden from screen readers and the card's corner numbered. Flat SVGs and fragments share one checker, `src/book/markup.ts`, and each kind adds its allowlist; one `FIGURE_KINDS` table names each kind's file and inliner for the chapter plugin and the gallery. The fragment allowlist takes only the elements and attribute values the kit writes for a card, a closed list of `data-*` attributes and values, and ids that start with `<figure id>--`, which it prefixes. It refuses scripts, style elements and attributes, handlers, links, `url()` values, unknown entities in text or values, self-closing tags outside the drawing and foreign elements; a test refuses 31 crafted fragments. A chapter needs no id prefix, because figure ids are unique across the book; the component gallery shows Chapter 1's centerpiece, `call-workflow-loop/loop-bench`, once per theme, each copy's lamp ids prefixed by the theme. The book has none until T10, so a production build leaves the item out, and the build test sees the site fixture's sample there. Two kit helpers, `fadeLineSvg` and pulsing dots, write inline styles, so book figures cannot use them.
- **Motion.** The first paint shows the first step's part lit and its readout. `src/scripts/iso-figures.ts`, an external module on chapter pages, walks parts marked `data-iso-step`, moves the lit part and the readout, and adds Play and Next step buttons. It plays only on screen and starts paused under reduced motion.
- **Palette.** `src/styles/anatomy.css`, generated by `anatomy:css`, keeps the kit's part rules and maps every `--anatomy-*` colour to the panel tokens of each mode, under the selectors `tokens.css` uses. `hi` is the panel text and `mid` the comment colour, the lit part is outlined and tinted in terracotta, and shades and faint lines are `color-mix()` blends of panel tokens. Tops lighten toward the page colour, our choice, because the page is lighter than the panel in both modes and the panel's lighter tokens are text colours or decorative. The kit's grey palettes, card and phone media query are dropped. Each figure's audit page is built once per theme with these colours; the inlined fragment is one markup that takes the theme from the page, as T6's figures do.
- **The audit and CI.** `figures:audit` runs `scripts/audit-figure.ts`, the skill's geometry audit, for each figure in its own process, then `lines.mjs` on its light and dark pages, and fails unless they print `audit passed` and `line ends: 0`. A broken copy with a floating part and one with a loose line both failed it. The book job runs it on Chrome for Testing 157.0.8103.78, installed by `browser-actions/setup-chrome` v2.2.0, which is pinned in `actions.lock` and needs no npm dependency. Chrome for Testing publishes no checksum, so the build is pinned by its version only, our choice, and a step fails unless the binary reports exactly that version. The job keeps `contents: read` and no secrets. Locally it took 19–20 seconds for the two fixture figures, each audit 1–2 seconds and each line check under 5 seconds, and 32 seconds once under heavy load; CI's own time comes with its first run.
- **Samples.** The fixture book's first chapter and the site fixture hold a sample centerpiece, the loop bench (15 parts, `line ends: 0 of 56`), and an isometric analogy illustration, the tally counter, registered as `tally-counter` and checked like T6's flat one. On the built site, headless at 360 and 1280 px in both themes, with JavaScript off and on, both show their whole drawing at natural size with caption and alt text. The stage scrolls with its hint at 360 px only, no id repeats, no element has a `style` attribute, and the motion and reduced-motion behaviour work.
- **Records.** The book's log holds rows 446–478; row 447 corrects the plan's "LICENSE and NOTICE". Root gate: `pnpm check` and `pnpm typecheck` pass, and `pnpm -r --no-bail test` passes for every package except `verify/copilot-sdk`; the manual's tests are 223 before merging T5, 255 after it and 259 after merging T9.
- **For the owner.** Vendoring left out 25.7 MB of generated upstream files; if the whole tarball is wanted, it can be added unchanged. The line check's Chrome comes from Google's download bucket at run time, as setup-chrome fetches it, pinned by version only.

