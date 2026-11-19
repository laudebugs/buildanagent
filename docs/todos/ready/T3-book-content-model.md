# T3: Content model: outline, numbering, source register, glossary and chapter checks

> **On hold (2026-11-19): do not start until the owner approves the [book plan](../../plans/build-book.md).** The plan is a draft for the owner's review.

| Field | Value |
| --- | --- |
| ID | `T3` |
| Status | `ready` |
| Plan | [Book plan §5, BK5–BK7](../../plans/build-book.md#bk5-the-outline-lives-in-code-and-the-build-computes-every-number-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T1](T1-book-scaffold.md) |
| Size | L |

## Goal

Make the build responsible for every number, citation and glossary link, so chapters can move and grow without hand edits. This todo builds the outline, the numbering and cross-references, the source register tied to our fact-check logs, the glossary with first-use links, and the chapter check that agrees with the content schema.

## Context

- [Book plan BK5–BK7](../../plans/build-book.md#bk5-the-outline-lives-in-code-and-the-build-computes-every-number-proposed): the outline, the numbering, the register and the glossary.
- The garment repository at commit `bca44b0`: `src/content.config.ts`, `src/lib/markdown/remark-citations.mjs`, `src/lib/citations.mjs`, `src/lib/markdown/remark-terms.mjs`, `src/lib/terms.mjs` and `src/lib/markdown/split-text.mjs` ([ADR 0053](../../decisions/0053-reuse-garment-textbook-code.md)).
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

- Listings ([T4](T4-book-listings.md))
- Figure drawing ([T6](T6-book-flat-figures.md))

## Tasks

- [ ] Write `src/outline.ts` from the plan's §4, and render the contents with unwritten chapters as plain text.
- [ ] Write the content schema with `strictObject`: `title`, `summary`, `opening`, `sources`, `glossary`, `switchTo`.
- [ ] Port the citation plugin with a header comment naming its origin, commit and Apache-2.0 licence; change the id format to kebab-case and the link target to `/sources/#<id>`.
- [ ] Write the register check: every entry's `verifiedIn` path exists and contains the entry's URL; `secondary: true` entries render with a note on the sources page.
- [ ] Port the glossary plugin with the same header comment, and seed the glossary with the repo's core terms, each citing a register entry.
- [ ] Write the numbering plugin: numbers come from the outline position and the order of appearance; an unknown or duplicate id fails the build with the file and line.
- [ ] Write `check:book` and a test that every rule it applies also fails the build, so the two cannot disagree.
- [ ] Write the analogy register's schema and check: each entry has a concept, an analogy, a chapter, an illustration id or none, and a "where it breaks" note; a duplicate analogy, an analogy used for a second concept, or a chapter that uses an analogy missing from the register fails `check:book`. A chapter may name an earlier concept's analogy only by its register id.
- [ ] Write the opening check: two consecutive chapters in the outline may not share an opening type, and no type may open more than a quarter of the chapters, rounded up.
- [ ] Add each copied file to THIRD-PARTY-NOTICES.md.

## Acceptance criteria

- [ ] Moving a chapter in `src/outline.ts` renumbers its figures, listings and tables, and every reference to them, with no other edit
- [ ] A fixture chapter that cites an unknown id, references an unknown figure or tags an unknown term fails `pnpm --filter @buildanagent/book build`, naming the file
- [ ] A register entry whose `verifiedIn` file lacks its URL fails `check:book`
- [ ] The first use of each glossary term in a chapter links to `/glossary/`, with the definition in `aria-describedby` text; later uses stay plain
- [ ] THIRD-PARTY-NOTICES.md lists every file copied from the garment repository
- [ ] A fixture register with one analogy used for two concepts, or two entries with the same analogy, fails `check:book`; so does a fixture outline where two consecutive chapters share an opening type
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Vitest tests in `apps/book/test/` run each plugin on fixture Markdown, with one failing fixture per rule. `check:book` runs in `pnpm test` over the fixtures.

## Docs to update

- The plan's BK5–BK7 if a rule changes
- A short `apps/book/README.md` on writing a chapter: front matter, citations, references, glossary tags

## Risks and open questions

- Many fact-check logs cite a source by a link label rather than its full URL; the `verifiedIn` check may need to resolve reference-style links in the target file.
- Astro's content cache keeps stale chapters after a plugin change unless T1's render-input hash covers `src/data/`.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
