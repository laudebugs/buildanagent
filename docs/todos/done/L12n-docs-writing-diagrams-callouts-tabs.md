# L12n: Add the diagram, callout and tab rules to docs-writing.md

| Field | Value |
| --- | --- |
| ID | `L12n` |
| Status | `done` |
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

- [x] Draft the section with `/anthropic-skills:writing`, in the file's existing MUST/SHOULD style.
- [x] Say in each rule how a reviewer checks it.
- [x] Add a short pointer from [examples.md](../../guidelines/examples.md) if a tab rule touches example files.

## Acceptance criteria

- [x] `docs/guidelines/docs-writing.md` has the new section, and every rule is MUST or SHOULD with a way to check it.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root (the docs app's writing-rule test reads this file's rules).

## Tests

The docs app's test suite (it checks every page against these rules).

## Docs to update

`docs/guidelines/docs-writing.md`; AGENTS.md's `docs/guidelines/` line only if it lists the topics.

## Risks and open questions

A rule the docs test cannot check stays advice; say so in the rule.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Code review: this is copy only, so the writing review and the fact-check cover it
- [ ] Copy reviewed with `/anthropic-skills:writing-review`, with its findings fixed and the rubric scores in the pull request description

## Outcome

`docs-writing.md` has three new sections: when a figure earns a place (one idea, alt text that states the point, a caption, 12 px labels, token colours, no fact only in the picture), what each callout kind is for, and when code tabs fit. Each rule is MUST or SHOULD, says how a reviewer checks it and says whether the docs test enforces it; none of the new rules is machine-checked today, and only the existing long-block test covers tab code. `examples.md` points to the tab rule, and the claims are logged in `fact-check-docs-guidelines.md` as rows L12n-1 to L12n-9.
