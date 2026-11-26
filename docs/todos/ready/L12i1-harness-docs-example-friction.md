# L12i1: Decide and fix three rough edges in the harness permission, sandbox and server examples, and one stale comment

| Field | Value |
| --- | --- |
| ID | `L12i1` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (found while writing the L12i harness pages) |
| Round / milestone | Round L (publish and docs, added 2026-11-26) |
| Depends on | [L12i](../done/L12i-docs-harness-pages-2.md) |
| Size | S (one sitting) |

## Goal

Decide and fix these rough edges, which the new harness pages work around:

- `createPermissionPipeline()` takes a tool registry even when every rule names a tool by its name, so `permission-rules.ts` passes an empty one.
- No example fires the in-process client's approval handler, because its scripted turn calls no tool.
- `fakeSandbox()` reports the `os` tier, so its example reads like a real operating-system sandbox's.
- The comment on `SandboxStop` in `packages/harness/src/sandbox/types.ts` says only the E2B backend stops `hostile_process`, but `vercel/index.ts` and `e2b/index.ts` both claim it. Fixing a comment in `src` needs a changeset, so it waits for this todo.

## Context

- `packages/harness/examples/permission-rules.ts`, `in-process-client.ts` and `sandbox-fake.ts`: the examples that show each edge.
- `packages/harness/src/permissions/pipeline.ts` and `packages/harness/src/testing/fake-sandbox.ts`.

## Scope

**In scope**

- Decide whether the registry argument of `createPermissionPipeline()` becomes optional, and change it with a test and a changeset if so.
- Extend the in-process client example so a scripted tool call reaches the approval handler, with a test.
- Decide whether the fake sandbox reports its own tier, and change it if so.

**Out of scope**

- Any change to the permission rules themselves.

## Tasks

- [ ] Decide each question with the owner, then implement the answers.
- [ ] Update the docs pages that quote the examples.

## Acceptance criteria

- [ ] No example passes an empty registry only to satisfy a signature
- [ ] An example runs the approval handler of the in-process client
- [ ] `pnpm check`, `pnpm typecheck`, `pnpm test` and the package checks pass

## Tests

`packages/harness/test/examples/` and `packages/harness/test/permissions/`.

## Docs to update

`apps/docs/src/content/docs/harness/permissions.md`, `server.md` and `sandbox.md` if the examples change.

## Risks and open questions

- A new optional parameter is a public API decision, so the owner chooses before the work starts.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed
