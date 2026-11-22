# L12: Redesign apps/docs to match the book's theme, with diagrams, tested examples and the harness packages

| Field | Value |
| --- | --- |
| ID | `L12` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | [L5](../done/L5-docs-app.md), [L6](../done/L6-api-reference.md), [L8](../done/L8-cloudflare-deploys.md) |
| Size | L (the plan step splits it into smaller todos) |

## Goal

Redesign the docs site at `docs.buildanagent.fyi` so it looks like the book at `manual.buildanagent.fyi` and works like a modern reference site: navigation, page anatomy, code tabs, callouts, an API reference layout, search, copy buttons and versioning. Add flat SVG diagrams drawn by scripts, tested code examples where they help, and pages for the protocol, harness and CLI packages. The owner asked for it on 2026-11-22.

## Context

- The owner's request, relayed by the manager session on 2026-11-22: study the Lamina PDF docs site's features, match the book's theme from `docs/design/book-tokens.json` through a generated tokens file, include diagrams and tested examples, keep the docs checks passing, add harness-package pages, and leave a header slot for a logo the owner has not chosen.
- [`apps/docs/README.md`](../../../apps/docs/README.md) and [ADR 0048](../../decisions/0048-docs-on-astro-starlight.md): the docs app today.
- [`apps/manual/README.md`](../../../apps/manual/README.md): how the book generates its tokens, self-hosts its fonts and draws its figures.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the rules the pages and examples follow.

## Scope

**In scope**

- To be written from the plan step's report (the plan goes to the manager first).

**Out of scope**

- The logo (the manager is producing variations for the owner; the header keeps a slot).
- `.github/workflows/`.

## Tasks

- [ ] Write the plan from a study of the current app, the book's design pipeline and the Lamina PDF docs site, and send it to the manager.
- [ ] Split this todo into buildable todos from the plan.

## Acceptance criteria

- [ ] To be written with the plan.

## Tests

To be written with the plan.

## Docs to update

The plan's todo table, `apps/docs/README.md` and AGENTS.md's `apps/` entry.

## Risks and open questions

The Lamina PDF repository could not be attached to the session (the permission was denied), so its docs site has not been read; the plan step says what it used instead.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
