# L12h: Write the harness pages, part 1, with a quick start, figure 7 and a "Problems and fixes" section

| Field | Value |
| --- | --- |
| ID | `L12h` |
| Status | `ongoing` |
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

- [ ] Add the harness examples and their tests.
- [ ] Write the harness pages, wire the sidebar and the home card, and update the tests.
- [ ] Draw `session-log` and place it.
- [ ] Link the reference index to the quick start, with a changeset.
- [ ] Fact-check every claim and log it.
- [ ] Update the L12 umbrella and the plan's todo table.

## Acceptance criteria

- [ ] The harness has a quick start built from a tested example file, and its home card leads to it
- [ ] Every code block over five lines comes from a tested example file
- [ ] The Problems and fixes page holds at least three entries, each from a symptom to a cause and a fix
- [ ] The harness API reference index links to the quick start
- [ ] `pnpm check`, `pnpm typecheck`, the harness and docs suites and the package checks pass offline, and the docs build's link validator reports no broken link

## Tests

`packages/harness/test/examples/` and `apps/docs/test/`.

## Docs to update

`apps/docs/README.md` if it lists the topics, the L12 todo's table and "L12h progress", and the plan's todo table.

## Risks and open questions

- The harness ships a file-backed lock only, so an example that wants no files needs its own lock; the quick start writes files to a folder the caller names.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check` and `pnpm typecheck` pass locally, and so do the harness and docs suites; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

Filled in when the work is done.
