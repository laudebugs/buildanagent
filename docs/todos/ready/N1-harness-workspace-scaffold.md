# N1: Scaffold `protocol`, `harness`, `cli` and `evals` packages

| Field | Value |
| --- | --- |
| ID | `N1` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 1](../../plans/build-harness.md#41-stage-1-builds-the-session-log-from-its-entry-union-to-rebuild-and-replay) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [B1](../done/B1-sdk-workspace-scaffold.md) |
| Size | S |

## Goal

Create the four harness packages beside the SDK's two, each building, type-checking and running an empty test offline, so every later todo has a home and the shared offline guard from the start.

## Context

- [HD13](../../plans/build-harness.md#hd13-four-packages-with-one-subpath-export-per-removable-component): the four-package split
- [build-harness.md §3.1](../../plans/build-harness.md#31-four-packages-under-packages-beside-the-sdks-two): the layout and dependencies
- [SDK plan §3.1](../../plans/build-sdk.md#31-two-packages-under-a-new-top-level-packages-directory): tooling conventions to copy
- [AGENTS.md coding standards](../../../AGENTS.md#coding-standards): pins, ESM, Biome

## Scope

**In scope**

- `packages/protocol`, `packages/harness`, `packages/cli`, `packages/evals` with `package.json`, `tsconfig.json`, `src/index.ts`, `README.md`
- `exports` maps with every subpath from §3.1, each pointing at a stub module
- A shared test setup that imports the SDK's offline guard (`allowModelRequests(false)`, loopback-only `fetch`, provider-key check)
- `private: true` on all four

**Out of scope** (and which todo covers it)

- Any component code (N2 onwards)
- The Python Inspect directory (N37)

## Tasks

- [ ] Copy the SDK packages' `package.json` scripts (`typecheck`: `tsc -p`, `test`: `tsx --test`).
- [ ] Add `workspace:*` dependencies on `@agent-speak/sdk`, `@agent-speak/gateway` and `@agent-speak/protocol` where §3.1 lists them.
- [ ] Add one smoke test per package that imports its root export.
- [ ] Check that Biome covers the new folders without config changes.

## Acceptance criteria

- [ ] `pnpm -r --filter "./packages/*" typecheck` lists all six packages
- [ ] Each harness subpath in §3.1 resolves with `import.meta.resolve` in a test
- [ ] A test that calls `fetch("https://example.com")` fails through the shared guard
- [ ] No dependency appears in a harness `package.json` that §3.1 does not name
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/*/test/smoke.test.ts`.

## Docs to update

Each package's `README.md` (one paragraph and a link to the plan). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If B1's shared setup is not exported from the SDK, copy it into `packages/harness/src/testing/` and note it for P4.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
