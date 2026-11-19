# 0052. Publish a two-part textbook from a new `apps/book`, public on Cloudflare at manual.buildanagent.fyi

- **Status:** Accepted (owner, 2026-11-19); folder and package name superseded by [0055](0055-name-the-book-app-manual.md) (2026-11-19)
- **Date:** 2026-11-19
- **Plan:** [Book plan, BK1 and BK2](../plans/build-book.md#2-decisions)

## Context

The repository holds three build guides, a research report, eight SDK references and 70 verified example programs, all written for the engineers who will build our stack. The owner asked for a textbook built from them for a wider audience, and made five decisions on 2026-11-19. First, the book teaches how to build an agent, "with images that explain how agents work and example code from this repository". Second, it has "two parts: Part I foundations for developers new to agents; Part II in depth for experienced builders". Third, it "lives at `apps/book` in this monorepo and is published on Cloudflare at the domain manual.buildanagent.fyi". Fourth, it is "public, no sign-in; book prose CC BY 4.0 like our docs (see LICENSE-DOCS), code Apache-2.0 OR MIT". Fifth, its code comes from "the verified SDK examples in verify/ now", switching to our own SDK in `packages/` "as its todos land".

## Decision

- The top-level folder `apps/` holds deployable sites, beside `packages/` for our libraries and `verify/` for the harnesses. The book lives at `apps/book`, beside the docs (`apps/docs`) and the website (`apps/site`) that [ADR 0049](0049-two-sites-on-cloudflare.md) places there.
- The book is published on Cloudflare at manual.buildanagent.fyi, open to everyone, with no sign-in.
- The book's prose and figures are licensed CC BY 4.0, like `docs/`; its code and figure generators are licensed Apache-2.0 OR MIT, like the rest of our code.
- Listings come from `verify/*/examples` until our own packages replace them chapter by chapter.

## Consequences

- Whichever of todos L5, L7 or T1 lands first adds `apps/*` to `pnpm-workspace.yaml`. T1 lists `apps/book` in [LICENSE](../../LICENSE) under both terms. [AGENTS.md](../../AGENTS.md) and the [README](../../README.md) gain a line for `apps/`.
- Because the book is public, it needs no Worker code, no Access policy and no reader data. [ADR 0053](0053-book-stack-and-deploy.md) records the stack and deploy that follow.
- The owner sets up the Cloudflare zone and the GitHub environments, tokens and secrets; todo T9's workflow then attaches manual.buildanagent.fyi as a custom domain on its first deploy.
