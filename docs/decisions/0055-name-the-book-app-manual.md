# 0055. Name the book's app `apps/manual` and its package `@buildanagent/manual`

- **Status:** Accepted (owner, 2026-11-19); supersedes the folder and package name in [ADR 0052](0052-book-in-apps-on-cloudflare.md)
- **Date:** 2026-11-19
- **Plan:** [build-book.md, BK2](../plans/build-book.md#bk2-appsmanual-public-on-cloudflare-at-manualbuildanagentfyi-accepted-adr-0052)

## Context

[ADR 0052](0052-book-in-apps-on-cloudflare.md) placed the textbook in `apps/book`, and the book plan named its private package `@buildanagent/book`. The site is published at manual.buildanagent.fyi. On 2026-11-19, while todo T1 was building the scaffold, the owner renamed the app to match its domain: "Let's make it @buildanagent/manual and apps/manual".

## Decision

The book's app lives in `apps/manual`, and its private workspace package is `@buildanagent/manual`. Everything else in ADR 0052 stands: the two-part textbook, its public site at manual.buildanagent.fyi, and its licences.

## Consequences

- The book plan, its todos, `docs/design/book-tokens.json`, AGENTS.md and the README use the new names. ADR 0052 keeps its original text, as an accepted record must.
- T1 creates `apps/manual`, and every later Round T todo builds into it. The pnpm filter is `@buildanagent/manual`.
- The book's sibling apps keep their names: `apps/docs` serves docs.buildanagent.fyi and `apps/site` serves buildanagent.fyi.
