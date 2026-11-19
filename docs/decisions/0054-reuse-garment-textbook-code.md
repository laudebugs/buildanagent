# 0054. Reuse the garment textbook's code for the book, credited, without its personal data or agent rules

- **Status:** Accepted (owner, 2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [Book plan, BK16](../plans/build-book.md#bk16-reuse-the-garment-textbooks-code-credited-without-its-personal-data-or-rules-accepted-adr-0054)

## Context

The owner owns `tajistudios/garment-engineering-textbook`, a private Astro textbook that our GitHub credentials can read. It already solves several of the book's problems: citations that fail the build, a glossary with first-use links, captioned figures checked at build time, a figure staleness test and a deploy guard. The repository has no licence file, so its code is all rights reserved unless its owner says otherwise. It also commits personal and account data: reader emails, Access application IDs and AUD tags. On 2026-11-19 the owner said its code may be reused, credited in THIRD-PARTY-NOTICES.md, and that its committed personal data and its `CLAUDE.md` rules are never copied.

## Decision

- **Permission.** Book todos may copy and adapt code from the garment repository, read at a recorded commit, under the owner's permission.
- **Licence (accepted, owner, 2026-11-19: "Apache 2.0").** Code copied or adapted from the garment repository is published here under Apache-2.0 only, not under our usual Apache-2.0 OR MIT. Todo T1 adds the exception to [LICENSE](../../LICENSE).
- **Credit.** Each todo that copies a file adds it to a garment-repository section of [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md), with the source path and commit. Each derived file opens with a header comment that names its origin, the source path and commit, and its Apache-2.0 licence.
- **Exclusions.** No todo copies the repository's reader emails, Access IDs, AUD tags or other account identifiers, or any text from its `CLAUDE.md`. No todo reads its `docs/todos/` or deploy configuration, where that data lives.
- **Which files.** The plan's [BK16](../plans/build-book.md#bk16-reuse-the-garment-textbooks-code-credited-without-its-personal-data-or-rules-accepted-adr-0054) proposes the files to reuse and maps each to its todo. That list is a proposal under this record, not part of it.

## Consequences

- Todos T1, T3, T6 and T9 carry the copying. The files they copy carry a different licence from the rest of our code, so every review of those todos checks the header comments, the notices entries and the exclusions.
- The garment skills under its `.agents/skills/` carry their own MIT licences, so anything taken from them follows those licences instead of this permission.
