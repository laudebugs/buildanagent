# T7: Isometric and interactive figures: the vendored anatomy skill, its audits and inline fragments

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T7` |
| Status | `ready` |
| Plan | [Book plan §5, BK10 and BK11](../../plans/build-book.md#bk11-generated-checked-inlined-figures-that-work-without-javascript-proposed) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T6](../done/T6-book-flat-figures.md), [T8](T8-book-ci.md) |
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

- [ ] Copy the skill at commit `1482e84` into `.agents/skills/anatomy/` (the owner approved vendoring it, 2026-11-19: "yes"), keep its LICENSE and NOTICE, and record the commit in THIRD-PARTY-NOTICES.md.
- [ ] Extend the figure plugin with `viewer:` fragments: inline, no iframe, ids prefixed, a complete static first paint, and scripts loaded as modules that only add motion and controls.
- [ ] Write `figures:audit`, which builds each isometric figure with `--audit`, runs `scripts/lines.mjs` on its light and dark pages, and fails unless they print `audit passed` and `line ends: 0`.
- [ ] Add `figures:audit` to the `book` job from T8, with headless Chrome, and record how long it takes.
- [ ] Build the sample centerpiece, embed it in a fixture chapter and check it with JavaScript off.
- [ ] Map the anatomy skill's palette to `docs/design/book-tokens.json`'s panel tokens for each mode (`panelLight` for the light page, `panelDark`, C1 Ember, for the dark page), and build each isometric figure, analogy illustrations included, once per theme.

## Acceptance criteria

- [ ] `.agents/skills/anatomy/` exists with its LICENSE and NOTICE, and THIRD-PARTY-NOTICES.md records its commit
- [ ] The sample centerpiece prints `audit passed` and `line ends: 0` on both themes, and the CI job fails when either check fails
- [ ] With JavaScript off, the sample shows its complete static figure and its caption
- [ ] Two inlined fragments on one page share no element id
- [ ] An isometric figure of the `analogy` kind passes the register check from T6 and the same audits as a technical figure
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The `figures:audit` script in CI; Vitest tests for the `viewer:` source and id prefixing.

## Docs to update

- [AGENTS.md](../../../AGENTS.md) layout: the vendored skill
- `apps/manual/README.md`: how to add an isometric figure

## Risks and open questions

- Full audits can be slow (plan risk 4); if the job exceeds ten minutes, audit only the figures a pull request changes and run every figure nightly.
- Vendoring a skill means updating it by hand; record the upstream commit so the next update can diff.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
