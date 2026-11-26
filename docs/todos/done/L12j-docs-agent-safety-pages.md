# L12j: Write the agent-safety pages, with a quick start and a "Problems and fixes" section

| Field | Value |
| --- | --- |
| ID | `L12j` |
| Status | `done` |
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

- [x] Add the examples and their tests.
- [x] Write the pages, wire the sidebar, the home card and the next links, and update the tests.
- [x] Write Problems and fixes with at least three entries.
- [x] Fact-check every claim and log it.
- [x] Update the L12 umbrella and the plan's todo table.

## Acceptance criteria

- [x] The agent-safety pages exist in the sidebar, in order, and each links to the next
- [x] The home card leads to the quick start, and the package's `@module` comment links to it
- [x] Every code block over five lines comes from a tested example file
- [x] The Problems and fixes page holds at least three entries, each from a symptom to a cause and a fix, and every code it names is a member of `SafetyErrorCode`, or, for the two approval causes that `verifyResolution()` returns, of `RejectionCause`
- [x] `pnpm check`, `pnpm typecheck`, the agent-safety and docs suites and the package checks pass offline

## Tests

`packages/agent-safety/test/examples.test.ts` and `apps/docs/test/`.

## Docs to update

The L12 todo's table and "L12j progress", and the plan's todo table.

## Risks and open questions

- The package is large, so the pages cover its four main parts and leave plans, durable stores and Cloudflare to the README.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check` and `pnpm typecheck` pass locally for the files this change touches; pushed after each meaningful step
- [x] This file moved `ongoing/` -> `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

- **Pages.** A new "Agent safety" topic after Harness holds six pages: `agent-safety/quick-start`, `outcomes`, `approvals`, `cost-cap`, `own-key` and `problems-and-fixes`. The home card, the reference index (through `readmes/agent-safety.md`) and the package's `@module` comment lead to the quick start, and a patch changeset covers the TSDoc change. DS5 names no agent-safety figure, so none was drawn.
- **Examples.** New: `quick-start.ts` (region `tool`), `approval-check.ts` (`pause`, `resume`) and `outcome-tool.ts` (`declined`, `tool`). Regions were added to `capped-answer.ts` (`answer`). `own-key-capped.ts` supplies the own-key page. Thirteen new tests in `examples.test.ts` run them offline, and `problem-messages.test.ts` makes the package throw each of the 15 error messages and checks that the Problems and fixes page quotes it.
- **Problems and fixes.** Fourteen entries in four areas (outcomes and hashes, approvals and keys, guarded writes, model calls and the cost cap), each naming its code. Twelve entries name a thrown `SafetyError` code, a member of `SafetyErrorCode`. Two name a cause that `verifyResolution()` returns, a member of `RejectionCause` (`signature_invalid` and `input_changed`, with `call_mismatch` mentioned): it throws nothing. `problems.test.ts` lets only the agent-safety page name a cause.
- **Scope.** Plans (`runPlan()`), the durable effect stores and the Cloudflare adapters stay in the README; the pages link to it.
- **Friction.** Three rough edges, recorded in [L12j1](../ready/L12j1-agent-safety-docs-example-friction.md): `onError` must return an outcome for every error, so the quick start rethrows; `verifyResolution()` reports a denial as `ok: true`, so the approval example merges the decision and the cause; and `signedToolApproval()` has no tested example.
- Claims are in the fact-check log, rows L12j-1 to L12j-58.
