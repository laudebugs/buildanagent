# L12h1: Remove three workarounds that the harness examples need

| Field | Value |
| --- | --- |
| ID | `L12h1` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (found while writing the L12h harness pages) |
| Round / milestone | Round L (publish and docs, added 2026-11-26) |
| Depends on | [L12h](../done/L12h-docs-harness-pages-1.md) |
| Size | S (one sitting) |

## Goal

Remove three workarounds that the harness examples carry. The harness ships a file-backed `SessionLock` only, so an example with no files writes its own in-memory lock (`examples/lib/check.ts` and the session tests each hold a copy). A `TurnResult` has no answer text, so the quick start writes `answerOf()` to join the text blocks of the last message. Registering a tool built with `defineTool()` takes a cast to one tool type and a `register()` loop, in `order-tools.ts` and `triage-tools.ts`.

## Context

- `packages/harness/examples/quick-start.ts`, `packages/harness/examples/lib/check.ts` and `packages/harness/test/session/memory-backend.ts`: the workarounds.
- `packages/harness/src/session/lock.ts`, which holds the `SessionLock` interface and no implementation that needs no file system.

## Scope

**In scope**

- Decide whether `@buildanagent/harness/session` exports a `memoryLock()` next to `memoryStore()` and `memoryIndex()`, and export it with a test and a changeset if so.
- Decide whether a turn's result should carry its answer text, and add it if so.
- Decide whether the registry takes typed tool definitions without a cast and a loop.
- Replace the copies in the examples and tests.

**Out of scope**

- Any change to the file lock.

## Tasks

- [ ] Decide each question with the owner, then implement the answers.
- [ ] Update the quick start and the docs pages that quote it.

## Acceptance criteria

- [ ] No example or test defines its own in-memory lock
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the package checks pass

## Tests

`packages/harness/test/session/`.

## Docs to update

`apps/docs/src/content/docs/harness/quick-start.md` if the quick start changes.

## Risks and open questions

- A new export is a public API decision, so the owner chooses before the work starts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed
