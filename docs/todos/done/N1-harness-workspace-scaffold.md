# N1: Scaffold `protocol`, `harness`, `cli` and `evals` packages

| Field | Value |
| --- | --- |
| ID | `N1` |
| Status | `done` |
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

- [x] Copy the SDK packages' `package.json` scripts (`typecheck`: `tsc -p`, `test`: `vitest run`) and their `vitest.config.ts`, which loads the shared offline setup ([ADR 0046](../../decisions/0046-vitest-test-runner.md)).
- [x] Add `workspace:*` dependencies on `@buildanagent/sdk`, `@buildanagent/gateway` and `@buildanagent/protocol` where §3.1 lists them.
- [x] Add one smoke test per package that imports its root export.
- [x] Check that Biome covers the new folders without config changes.

## Acceptance criteria

- [x] `pnpm -r --filter "./packages/*" typecheck` lists all six packages
- [x] Each harness subpath in §3.1 resolves with `import.meta.resolve` in a test
- [x] A test that calls `fetch("https://example.com")` fails through the shared guard
- [x] No dependency appears in a harness `package.json` that §3.1 does not name, except the gateway as a dev dependency of `cli` and `evals`, which only their test setup imports
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/*/test/smoke.test.ts`.

## Docs to update

Each package's `README.md` (one paragraph and a link to the plan). The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If B1's shared setup is not exported from the SDK, copy it into `packages/harness/src/testing/` and note it for P4.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome (2026-11-20)

- `packages/protocol`, `packages/harness`, `packages/cli` and `packages/evals` build, type-check and test from the root scripts. Their manifests copy `agent-safety`'s: the `source` export condition, a `publishConfig.exports` map without it, and the `prepack` and `prepublishOnly` scripts. Each package also has a README, a `test/setup.ts` and a `vitest.config.ts` copied from the gateway's. The harness has a stub module for each of the 16 export entries in §3.1, the root `.` and 15 subpaths, and its smoke test fails when either exports map drifts from that list. `cli` and `evals` export only `.`, and `cli` has no `bin` yet because its entry file arrives with the command itself.
- The shared offline setup is the gateway's `@buildanagent/gateway/testing/setup`, which B1 already exports, so nothing is copied into `packages/harness/src/testing/` and P4 has nothing to move. Every package's `test/setup.ts` imports it by name.
- All four are `private: true` at version `0.0.0`, as the todo's scope says. `.changeset/config.json` is unchanged, because `privatePackages` already makes Changesets skip them and the fixed group stays gateway and SDK. Publishing is a later decision, taken when the first of them is ready to ship. The packages still pack through `scripts/ci/packages-pack.test.mjs`, as `agent-safety` does.
- The workspace dependencies follow §3.1: `protocol` has the gateway and the SDK, `harness` has the SDK, the gateway and `protocol`, and `cli` has `harness`, all as `workspace:*`. The todo's task asks for them now, and they add no pin to the lockfile, so this todo declares them before any code imports them. The third-party ones wait: `@modelcontextprotocol/client` (harness) and the OpenTelemetry exporter pair (cli) each need an exact pin that the todo first importing it chooses. `cli` and `evals` also list the gateway as a dev dependency, because their test setup imports it. §3.1 names no dev dependency for either package, so the todo that gives `evals` real code may replace it.
- Each package has a smoke test (package import and the blocked `fetch("https://example.com")`), and the harness's also resolves every subpath with `import.meta.resolve`. Biome needed no config change. `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `node --test scripts/ci/*.test.mjs` pass offline; no changeset is needed.
