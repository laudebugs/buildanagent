# L7: Build the website for buildanagent.fyi

| Field | Value |
| --- | --- |
| ID | `L7` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) |
| Round / milestone | Round L (publish and docs, added 2026-11-19) |
| Depends on | None |
| Size | S |

## Goal

Stand up `apps/site`, the website for `buildanagent.fyi`: what buildanagent is, the packages, and links to the docs and the repository ([DS2](../../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted), ADR 0049).

## Context

- [DS2](../../plans/publish-and-docs.md#ds2-two-sites-on-cloudflare-accepted) and [ADR 0049](../../decisions/0049-two-sites-on-cloudflare.md)
- [docs-writing.md](../../guidelines/docs-writing.md) for the copy
- Lamina PDF's `apps/site`

## Scope

**In scope**

- `apps/site` (`@buildanagent/site`, private), plain Astro, pinned like `apps/docs`
- A landing page, a page per package, and links to `docs.buildanagent.fyi` and the repository
- A footer with the licences: code Apache-2.0 OR MIT, content CC BY 4.0

**Out of scope** (and which todo covers it)

- Deploys (L8)

## Acceptance criteria

- [ ] `pnpm -C apps/site build` writes a static site to `apps/site/dist/`
- [ ] The landing page's copy passes the writing review, with its scores in the pull request description
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

A build test under `apps/site/test/`.

## Docs to update

AGENTS.md (layout), README.md, the plan's todo table.

## Risks and open questions

The site makes claims about the product; each one needs a source in the repo, as every document does.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
