# T3: Content model: outline, numbering, source register, glossary and chapter checks

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T3` |
| Status | `done` |
| Plan | [Book plan §5, BK5–BK7](../../plans/build-book.md#bk5-the-outline-lives-in-code-and-the-build-computes-every-number-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T1](../done/T1-book-scaffold.md) |
| Size | L |

## Goal

Make the build responsible for every number, citation and glossary link, so chapters can move and grow without hand edits. This todo builds the outline, the numbering and cross-references, the source register tied to our fact-check logs, the glossary with first-use links, and the chapter check that agrees with the content schema.

## Context

- [Book plan BK5–BK7](../../plans/build-book.md#bk5-the-outline-lives-in-code-and-the-build-computes-every-number-proposed): the outline, the numbering, the register and the glossary.
- The garment repository at commit `bca44b0`: `src/content.config.ts`, `src/lib/markdown/remark-citations.mjs`, `src/lib/citations.mjs`, `src/lib/markdown/remark-terms.mjs`, `src/lib/terms.mjs` and `src/lib/markdown/split-text.mjs` ([ADR 0054](../../decisions/0054-reuse-garment-textbook-code.md)).
- Our fact-check logs, which the register points at: [`docs/research/fact-check-2026-11-18.md`](../../research/fact-check-2026-11-18.md), each `docs/reference/<sdk>/fact-check.md` and the `fact-check-*.md` files beside each research report.

## Scope

**In scope**

- `src/outline.ts` with both parts and all eighteen slugs in reading order (plan §4), and the chapter collection with a strict zod schema
- A rehype plugin that numbers figures, listings and tables, and resolves `[[fig:…]]`, `[[lst:…]]`, `[[tbl:…]]` and `[[ch:…]]` references
- `src/data/sources.json`, the `[@id]` citation plugin, the `/sources/` page and the `verifiedIn` check
- `src/data/glossary.json`, the first-use plugin with hover cards, the `/glossary/` page and its check
- `check:book`, applying the schema's rules plus the chapter contract (opening type, exercises, sources)
- `src/content/analogies.json`, the book-wide analogy register (concept → analogy → chapter → illustration → where it breaks), and its check (BK22)
- An `opening` front-matter field (scenario, incident, question, fact, code or analogy) and its check (BK22)

**Out of scope** (and which todo covers it)

- Listings ([T4](../ready/T4-book-listings.md))
- Figure drawing ([T6](../ready/T6-book-flat-figures.md))

## Tasks

- [x] Write `src/outline.ts` from the plan's §4, and render the contents with unwritten chapters as plain text.
- [x] Write the content schema with `strictObject`: `title`, `summary`, `opening`, `sources`, `glossary`, `switchTo`.
- [x] Port the citation plugin with a header comment naming its origin, commit and Apache-2.0 licence; change the id format to kebab-case and the link target to `/sources/#<id>`.
- [x] Write the register check: every entry's `verifiedIn` path exists and contains the entry's URL; `secondary: true` entries render with a note on the sources page.
- [x] Port the glossary plugin with the same header comment, and seed the glossary with the repo's core terms, each citing a register entry.
- [x] Write the numbering plugin: numbers come from the outline position and the order of appearance; an unknown or duplicate id fails the build with the file and line.
- [x] Write `check:book` and a test that every rule it applies also fails the build, so the two cannot disagree.
- [x] Write the analogy register's schema and check: each entry has a concept, an analogy, a chapter, an illustration id or none, and a "where it breaks" note; a duplicate analogy, an analogy used for a second concept, or a chapter that uses an analogy missing from the register fails `check:book`. A chapter may name an earlier concept's analogy only by its register id.
- [x] Write the opening check: two consecutive chapters in the outline may not share an opening type, and no type may open more than a quarter of the chapters, rounded up.
- [x] Add each copied file to THIRD-PARTY-NOTICES.md.

## Acceptance criteria

- [x] Moving a chapter in `src/outline.ts` renumbers its figures, listings and tables, and every reference to them, with no other edit
- [x] A fixture chapter that cites an unknown id, references an unknown figure or tags an unknown term fails `pnpm --filter @buildanagent/manual build`, naming the file
- [x] A register entry whose `verifiedIn` file lacks its URL fails `check:book`
- [x] The first use of each glossary term in a chapter links to `/glossary/`, with the definition in `aria-describedby` text; later uses stay plain
- [x] THIRD-PARTY-NOTICES.md lists every file copied from the garment repository
- [x] A fixture register with one analogy used for two concepts, or two entries with the same analogy, fails `check:book`; so does a fixture outline where two consecutive chapters share an opening type
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest tests in `apps/manual/test/` run each plugin on fixture Markdown, with one failing fixture per rule. `check:book` runs in `pnpm test` over the fixtures.

## Docs to update

- The plan's BK5–BK7 if a rule changes
- A short `apps/manual/README.md` on writing a chapter: front matter, citations, references, glossary tags

## Risks and open questions

- Many fact-check logs cite a source by a link label rather than its full URL; the `verifiedIn` check may need to resolve reference-style links in the target file.
- Astro's content cache keeps stale chapters after a plugin change unless T1's render-input hash covers `src/data/`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `src/outline.ts` lists both parts and all eighteen slugs in §4's reading order, each with its planned title and opening type. The contents page renders the outline, with each unwritten chapter as plain text and its number.
- The chapter schema in `src/book/chapter-schema.ts` is a `strictObject` with `title`, `summary`, `opening`, `sources`, `glossary` and `switchTo`. `src/content.config.ts` and the chapter-contract plugin share it. The contract also requires the outline's planned opening type and a last `## Exercises` section with a list; the chapter layout adds the numbered source list after it, a minimal layout hook that T2 may restyle.
- Numbered blocks are container directives (`:::figure[Caption]{#id}`, `:::table`, `:::listing`). `src/book/book-index.ts` reads every chapter's blocks before any page renders, and `rehype-numbering` fills in "Figure 3.2" and resolves `[[fig:]]`, `[[lst:]]`, `[[tbl:]]` and `[[ch:]]` references. Unknown, duplicate or malformed ids fail with the file and line, in the build and in `check:book`.
- `src/data/sources.json` holds eight sources, each with a `verifiedIn` fact-check log that contains its URL; the check compares whole URLs and reads reference-style definitions. `[@id]` and `[@a; @b]` render as `[1]`, the source's place in the chapter's `sources`. `/sources/` notes each `secondary: true` entry.
- `src/data/glossary.json` seeds twelve terms, each citing a register source. A chapter tags terms in its `glossary` front matter; the first use links to `/glossary/#<id>` with `aria-describedby` text and a hidden definition list, and later uses stay plain. "Interceptor" is not seeded, because no fact-check log cites a web page for it (fact-check row 257).
- `src/content/analogies.json` starts empty, since chapters register the analogies they use. Its check fails on a duplicate analogy, an analogy reused for a second concept, a second analogy for a concept, an unknown chapter, and an illustration that is not a figure in its written chapter. In a chapter, an `:analogy[label]{#id}` whose id is missing, or which belongs to a later chapter, fails.
- The outline check fails when consecutive chapters share an opening type or one type opens more than a quarter of the chapters, rounded up; the real outline passes.
- `check:book` (`tsx scripts/check-book.ts`) loads the book and renders every chapter through the build's own plugins. `test/check-book.test.ts` runs 49 failing fixtures, one per rule, each of which must produce exactly one problem, each through `check:book` and through the build's path, and asserts both name the file and, for chapter rules, the line. A trial chapter citing an unknown id, referencing an unknown figure or tagging an unknown term made `pnpm --filter @buildanagent/manual build` exit 1, naming the file and line.
- `astro.config.mjs` now hashes `src/book/`, `src/data/`, `src/outline.ts` and `src/content/analogies.json` with `src/markdown/`, plus every chapter's numbered blocks and the line offset of its body. A change to another chapter's figures, or a front-matter edit that moves a body's lines, therefore clears the content cache, and under `astro dev` it restarts the server.
- The six files adapted from the garment textbook at `bca44b0` carry the Apache-2.0 header and are listed in THIRD-PARTY-NOTICES.md. Its `(?-i:…)` regular-expression modifier needs Node 23, so abbreviations are matched case-insensitively and filtered by case.
- T1's placeholder chapter `welcome.md` is gone, because a chapter must be in the outline. With no chapter written, Pagefind indexes all four pages; once a chapter exists, it indexes only chapters.
- Pins: `remark-directive` 4.0.0, `unist-util-visit` 5.2.0, `unified` 11.0.5 and `remark-parse` 11.0.0, with type-only `@types/mdast` 4.0.4, `@types/hast` 3.0.5, `@types/unist` 3.0.3, `vfile` 6.0.3 and `mdast-util-to-hast` 13.2.1 (13.2.2 is under a week old). None has an install script.
- `pnpm check`, `pnpm typecheck` and the book's build, `check:book` and tests pass. `pnpm test` passes for every package except `verify/copilot-sdk`, whose harness needs Linux's `unshare` and refuses to run on macOS; CI runs it on Linux.
- After the first code review, each written chapter needs its fact-check log in `apps/manual/fact-checks/<slug>.md` (its README gives the format), `verifiedIn` must name a fact-check log, errors inside a split paragraph keep their own line, and `options.ts` no longer loads the book on import. A build loads the book once in each module graph, each copy cached: `astro.config.mjs` loads it for the Markdown pipeline, and the pages' prerender bundle loads its own through `getBook()`. The site build test reads its fixture through `BOOK_FIXTURE_DIR`, which prints one warning on stderr in any process that uses it.
