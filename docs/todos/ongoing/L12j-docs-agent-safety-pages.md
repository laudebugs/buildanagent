# L12j: Write the agent-safety pages, with a quick start and a "Problems and fixes" section

| Field | Value |
| --- | --- |
| ID | `L12j` |
| Status | `ongoing` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12f](../done/L12f-docs-api-reference-four-packages.md) |
| Size | M |

## Goal

Give `@buildanagent/agent-safety` a written topic of its own: a quick start that the home card leads to, pages for its main parts (typed write outcomes, signed approvals, the cost cap and the bring-your-own-key guard) and a Problems and fixes page. The owner's amendments of 2026-11-25 add the quick start, the Problems and fixes entries and the friction record to the original scope.

## Context

- [L12](../ongoing/L12-docs-redesign.md), its [amendments of 2026-11-25](../ongoing/L12-docs-redesign.md#amendments-to-the-sub-todos-that-have-not-started-2026-11-25) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the plan and the added requirements. DS5 names no figure for agent-safety, so this todo draws none.
- [L12g](../done/L12g-docs-protocol-cli-pages.md), [L12h](../done/L12h-docs-harness-pages-1.md) and [L12i](../done/L12i-docs-harness-pages-2.md): the templates for this todo, with their review lessons.
- [L12q](../done/L12q-docs-examples.md): the bring-your-own-key guard example this todo's pages quote.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the page and example rules.
- `packages/agent-safety/README.md` and `packages/agent-safety/src/`: the source of every claim.

## Scope

**In scope**

- A new "Agent safety" topic in the docs sidebar with a quick start, pages on write outcomes, signed approvals, the cost cap and the bring-your-own-key guard, and Problems and fixes.
- New agent-safety examples with tests, and regions in the existing cost examples.
- The home card, the `@module` link and the reference index link that lead to the quick start.
- A friction record in the outcome.

**Out of scope**

- Pages for plans (`runPlan()`), the durable effect stores and the Cloudflare adapters: the README covers them.
- Links from Problems and fixes entries to error-code pages (L12t is only proposed).
- Any change to the package's behaviour.

## Tasks

- [ ] Add the examples and their tests.
- [ ] Write the pages, wire the sidebar, the home card and the next links, and update the tests.
- [ ] Write Problems and fixes with at least three entries.
- [ ] Fact-check every claim and log it.
- [ ] Update the L12 umbrella and the plan's todo table.

## Acceptance criteria

- [ ] The agent-safety pages exist in the sidebar, in order, and each links to the next
- [ ] The home card leads to the quick start, and the package's `@module` comment links to it
- [ ] Every code block over five lines comes from a tested example file
- [ ] The Problems and fixes page holds at least three entries, each from a symptom to a cause and a fix, and every code it names is a member of `SafetyErrorCode`
- [ ] `pnpm check`, `pnpm typecheck`, the agent-safety and docs suites and the package checks pass offline

## Tests

`packages/agent-safety/test/examples.test.ts` and `apps/docs/test/`.

## Docs to update

The L12 todo's table and "L12j progress", and the plan's todo table.

## Risks and open questions

- The package is large, so the pages cover its four main parts and leave plans, durable stores and Cloudflare to the README.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check` and `pnpm typecheck` pass locally for the files this change touches; pushed after each meaningful step
- [ ] This file moved `ongoing/` -> `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

To fill in when the work is done.
