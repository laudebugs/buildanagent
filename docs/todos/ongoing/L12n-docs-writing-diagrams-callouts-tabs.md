# L12n: Add the diagram, callout and tab rules to docs-writing.md

| Field | Value |
| --- | --- |
| ID | `L12n` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-22) |
| Depends on | None |
| Size | S |

## Goal

Give the docs redesign ([L12](L12-docs-redesign.md)) its writing rules before the pages that follow them exist: when a page gets a diagram, how to write its alt text and caption, when to use a callout, and when to use code tabs. A guideline change gets its own pull request ([AGENTS.md](../../../AGENTS.md#coding-standards)).

## Context

- [docs-writing.md](../../guidelines/docs-writing.md): the rules for every page a reader of the packages reads.
- The manager session's digest of the Lamina PDF docs site (item 10): a guideline section "draw a diagram where a picture answers the question faster". Nobody on our side read that site, so the rule is ours.
- The book's figure rules (`apps/manual/README.md`): 12 px labels, token colours only, alt text.

## Scope

**In scope**

- A section in `docs/guidelines/docs-writing.md` with MUST and SHOULD rules for: a diagram (when a picture answers faster than prose; one idea per figure; alt text that states the point, not "diagram of…"; a caption; labels at least 12 px; colours only from the theme tokens; the figure never carries the only statement of a fact), a callout (what each kind is for, how many per page, never for the page's main point), and code tabs (only for the same task in different languages or runtimes; the first tab is the one most readers need; every tab's code is a tested example).
- Updates to the docs app's own writing-rule test only if a new rule is machine-checkable and cheap to check (alt text on every figure directive belongs to the figure todo, not here).

**Out of scope**

- The figure pipeline, callout styling and the tabs component (the other L12 todos).

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`, in the file's existing MUST/SHOULD style.
- [ ] Say in each rule how a reviewer checks it.
- [ ] Add a short pointer from [examples.md](../../guidelines/examples.md) if a tab rule touches example files.

## Acceptance criteria

- [ ] `docs/guidelines/docs-writing.md` has the new section, and every rule is MUST or SHOULD with a way to check it.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (the docs app's writing-rule test reads this file's rules).

## Tests

The docs app's test suite (it checks every page against these rules).

## Docs to update

`docs/guidelines/docs-writing.md`; AGENTS.md's `docs/guidelines/` line only if it lists the topics.

## Risks and open questions

A rule the docs test cannot check stays advice; say so in the rule.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Code review: this is copy only, so the writing review and the fact-check cover it
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description
