# L12h: Write the harness pages, part 1, with a quick start, figure 7 and a "Problems and fixes" section

| Field | Value |
| --- | --- |
| ID | `L12h` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12g](../done/L12g-docs-protocol-cli-pages.md) |
| Size | M |

## Goal

Give the harness the written pages the SDK, the protocol and the CLI have: a quick start that the harness home card leads to, and pages on what the harness adds to the loop, on sessions, on context and on tools. Draw figure 7, `session-log`. End the topic with a "Problems and fixes" page that starts from what a reader sees, then gives the cause and the fix. The owner's amendments of 2026-11-25 add the quick start, the Problems and fixes section and the friction record to the original scope.

## Context

- [L12](../ongoing/L12-docs-redesign.md), its [amendments of 2026-11-25](../ongoing/L12-docs-redesign.md#amendments-to-the-sub-todos-that-have-not-started-2026-11-25) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the plan, the nine figures and the added requirements.
- [L12g](../done/L12g-docs-protocol-cli-pages.md): the template for this todo, with its review lessons.
- [L12q](../done/L12q-docs-examples.md): the harness examples this todo's pages quote.
- [docs-writing.md](../../guidelines/docs-writing.md) and [examples.md](../../guidelines/examples.md): the page and example rules.
- `packages/harness/README.md` and `packages/harness/src/`: the source of every claim.

## Scope

**In scope**

- A "Harness" topic in the sidebar with a quick start, an overview, a sessions page, a context page, a tools page and a Problems and fixes page, and the harness home card moved to the quick start.
- New harness examples for the quick start, for forking a session and for registering a tool, each with a test, and regions in the existing coding-agent example.
- Figure `session-log`.
- A link from the harness API reference index to the quick start.
- A friction record in the outcome.

**Out of scope**

- The permissions, sandbox, server and extensions pages and figure 8 (L12i), and links from Problems and fixes entries to error-code pages (L12t is only proposed).
- Any change to the harness's behaviour.

## Tasks

- [x] Add the harness examples and their tests.
- [x] Write the harness pages, wire the sidebar and the home card, and update the tests.
- [x] Draw `session-log` and place it.
- [x] Link the reference index to the quick start, with a changeset.
- [x] Fact-check every claim and log it.
- [x] Update the L12 umbrella and the plan's todo table.

## Acceptance criteria

- [x] The harness has a quick start built from a tested example file, and its home card leads to it
- [x] Every code block over five lines comes from a tested example file
- [x] The Problems and fixes page holds at least three entries, each from a symptom to a cause and a fix
- [x] The harness API reference index and its module page link to the quick start
- [x] `pnpm check`, `pnpm typecheck`, the harness and docs suites and the package checks pass offline, and the docs build's link validator reports no broken link

## Tests

`packages/harness/test/examples/` and `apps/docs/test/`.

## Docs to update

`apps/docs/README.md` if it lists the topics, the L12 todo's table and "L12h progress", and the plan's todo table.

## Risks and open questions

- The harness ships a file-backed lock only, so an example that wants no files needs its own lock; the quick start writes files to a folder the caller names.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check` and `pnpm typecheck` pass locally for the files this change touches (`pnpm check` also reports lint in `apps/manual`, which is not touched here), and so do the docs suite and the harness examples; root `pnpm test` and the harness suite stop on this machine in tests that need a cleared environment, which fail the same way on `main`; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [x] Two code-review rounds run on the pull request, with every finding fixed or explained
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

- **Pages.** A new "Harness" topic with six pages: `harness/quick-start`, `harness/overview`, `harness/sessions` (with figure 7, `session-log`), `harness/context`, `harness/tools` and `harness/problems-and-fixes`. The harness home card leads to the quick start, and `home.test.ts` checks it. The sidebar tests expect four written topics, and the last harness page links on to the harness API reference.
- **Examples.** New: `quick-start.ts` (regions `harness`, `session`, `turns`, `close`, `read`), `session-fork.ts` (`fork`) and `order-tools.ts` (`registry`, `offer`), each with a test in `packages/harness/test/examples/`. The existing `compaction.ts` and `builtin-tools.ts` supply the context and built-in tools blocks; `builtin-tools.ts` gained a `tools` region that keeps its README block contiguous. The book examples are not quoted, because they carry `check()` and `scripted()`.
- **Problems and fixes.** Ten entries (five on sessions, three on context, two on tools), each from what the reader sees to its cause and fix, each naming its error code where it has one. `apps/docs/test/problems.test.ts` checks that every such page has at least three entries, each with You see, Cause and Fix paragraphs in order, and that each code a page names is defined in a package, and `docs-writing.md` records the rule. Entries do not link error-code pages, because L12t is only proposed.
- **Reference link.** The `@module` comment of `@buildanagent/harness` links the quick start on the module page. The generated index lists modules only, so `ApiPackage.readme` in `apps/docs/src/api/packages.ts` puts the same link there; this docs-app friction is recorded here, not in L12h1.
- **Friction.** The harness ships no in-memory `SessionLock`, so the quick start writes to disk and the book examples carry their own lock; a `TurnResult` has no answer text, so the quick start joins the text blocks itself; and registering `defineTool()` results takes a cast and a loop. [L12h1](../ready/L12h1-harness-example-friction.md) records all three for an owner decision.
- Claims are in the fact-check log, rows L12h-1 to L12h-49.
