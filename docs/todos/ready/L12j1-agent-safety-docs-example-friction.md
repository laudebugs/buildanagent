# L12j1: Decide and fix three rough edges in the agent-safety examples

| Field | Value |
| --- | --- |
| ID | `L12j1` |
| Status | `ready` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (found while writing the L12j agent-safety pages) |
| Round / milestone | Round L (publish and docs, added 2026-11-26) |
| Depends on | [L12j](../done/L12j-docs-agent-safety-pages.md) |
| Size | S (one sitting) |

## Goal

Decide and fix these rough edges, which the new agent-safety pages work around:

- `guardedWrite()`'s `onError` must return an outcome for every error, so a tool that handles one error class rethrows the others. The write then settles as `unknown` with the reason `REPORT_FAILED`, a name that says nothing about the tool's own error.
- `verifyResolution()` returns `ok: true` for a person's denial, and a cause only when a check fails, so `approval-check.ts` merges the decision and the cause into one `RejectionCause | "denied"` value.
- `signedToolApproval()` has no example under `examples/`, so the approvals page links the README instead of quoting a tested example.

## Context

- `packages/agent-safety/examples/quick-start.ts` and `approval-check.ts`: the examples that show the first two edges.
- `packages/agent-safety/src/guarded-write.ts`, `src/pending.ts` and `src/ai/tool-approval.ts`.

## Scope

**In scope**

- Decide whether `onError` may return `undefined` for "I do not know this error", and change it with a test and a changeset if so.
- Decide whether `verifyResolution()` should report the person's decision beside `ok`, and change it if so.
- Add a tested `signedToolApproval()` example and quote it on the approvals page.

**Out of scope**

- Any change to the signing format.

## Tasks

- [ ] Decide each question with the owner, then implement the answers.

## Acceptance criteria

- [ ] Each decision is recorded here, and the pages and examples follow it
- [ ] `pnpm check`, `pnpm typecheck` and the agent-safety and docs suites pass

## Tests

`packages/agent-safety/test/examples.test.ts` and `apps/docs/test/`.

## Docs to update

The quick start, approvals page and the package README, if a behaviour changes.

## Risks and open questions

- Changing `onError` or `verifyResolution()` changes the public API, so it needs a changeset and the owner's decision.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` -> `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` -> `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes
