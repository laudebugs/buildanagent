# T52: Add our own SDK to Chapter 3's tool listings as tabs

| Field | Value |
| --- | --- |
| ID | `T52` |
| Status | `ready` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T12](../done/T12-chapter-tools.md), [B10](../done/B10-tool-runtime.md), [T50](T50-chapter-call-workflow-loop-on-our-sdk.md) |
| Size | M |

## Goal

Give Chapter 3, "Tools: schemas, validation, errors the model can read, and identity it cannot fake" (`tools`), a first tab on `@buildanagent/sdk` wherever our SDK can show what a listing shows. The chapter's only `switchTo` todo is B10, the tool runtime, and `book:switch-report` reports it done, so BK8 asks this pull request's chapter to open this follow-up. The owner decided on 2026-11-19 that chapters keep their third-party listings and add ours as the first tab ([BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted), [ADR 0057](../../decisions/0057-book-keeps-third-party-listings-and-adds-ours-as-tabs.md)). B10's `defineTool()` validates input, returns every failure to the model as data with each failing path, the received arguments and a do-not-substitute line, and hands `execute` a `ToolContext`, so our tab can show the chapter's schema and error mechanisms in one SDK ([B10's Outcome](../done/B10-tool-runtime.md#outcome)).

## Context

- [T12's Outcome](../done/T12-chapter-tools.md#outcome): the chapter's listings, replays, figures and fact-check log.
- [T50](T50-chapter-call-workflow-loop-on-our-sdk.md): widens the listing rule to `packages/` and adds a transcript recorder for our examples; this todo reuses both, so it depends on T50.
- `packages/sdk/README.md` and `packages/sdk/src/tools/`: `defineTool()`, `ToolContext`, `formatError` and `redactErrors`.

## Scope

**In scope**

| Listing | Stays as a tab | Our SDK's tab, first |
| --- | --- | --- |
| `#tool-openai` and its tabs block | The four third-party tool definitions | The same lookup on `defineTool()` |
| `#adk-retry` (replay) | `verify/google-adk/examples/01-function-tool.ts`, region `retry` | A scripted call that breaks the schema and a retry, showing our path-level error text |
| The tables `#tool-errors` and `#trusted-context` | Their four rows | A row for our SDK |

- New examples under `packages/sdk/examples/` with `// #region` and `// book:note` markers, run offline by the package's `test`, with transcripts.
- The identity section gains a listing of a tool that declares no identity field. As of B10, `ToolContext` (`packages/sdk/src/tools/types.ts`) holds the run and call ids, the abort signal, the nesting depth, a clock and `update()`, and no app-defined data, so the tool closes over the signed-in customer as the Pi and Claude rows of `#trusted-context` do. If the SDK gains the trusted run context of [agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next) first, the listing reads it from there.
- The prose, notes and fact-check rows the tabs change.

**Out of scope**

- `#weather-run` and `#claude-allowed`, until our SDK has a matching runner listing and an MCP adapter; a later todo adds them.

## Tasks

- [ ] Write the examples for our tabs, with regions, notes and transcripts.
- [ ] Turn each listing in the table into a tabs block with our tab first; add our rows to the two tables.
- [ ] Fact-check every changed claim into `apps/manual/fact-checks/tools.md` as a new block, with corrections as their own rows, and update the tally.
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter and fix its findings with `/anthropic-skills:writing`.

## Acceptance criteria

- [ ] Each listing in the table is a tabs block whose first tab comes from `packages/` and whose other tabs are unchanged
- [ ] Every API identifier in the chapter's inline code resolves, or carries a hand-checked marker citing a ✅ or ✏️ row (BK17)
- [ ] `check:book`, the manual's `test` and `build`, `figures:build` with no stale figure, and `figures:audit` pass
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root, and the results-drift check reports no drift

## Tests

The listing-rule tests in `apps/manual/test/`, the new examples in `packages/sdk/test/examples.test.ts`, the figure staleness test and the book's CI job.

## Docs to update

- [Book plan](../../plans/build-book.md): the §4.1 row for Chapter 3's examples
- `packages/sdk/README.md`, if an example shows a use of `defineTool()` that the README lacks
- The chapter's source register entries, for any source our tabs' prose cites

## Risks and open questions

- Tabs double the code a reader can open at each step, and the prose must still read as one argument. Keep each paragraph about the step, and name an SDK only where the tabs differ.
- Listing numbers shift, because each tabs block numbers every listing in it and ours comes first. The build computes every number and reference, so only hand-written text that counts listings needs checking.
- Our identity tab closes over the customer because `ToolContext` carries no app-defined data as of B10. The chapter warns that a server must build such a tool per request, so the example must do that rather than close over a module-level constant. Whether `ToolContext` should gain a trusted-context field is an open question for a B-series todo, which the owner decides.
- Our packages are alpha (a `0.1.0-alpha` release as of November 2026), so their APIs may change under the chapter. The type-check and the results-drift check catch each change, but each one then needs a chapter update.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
