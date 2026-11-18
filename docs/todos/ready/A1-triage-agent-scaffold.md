# A1: Scaffold `packages/triage-agent`

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A1` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 1](../../plans/build-agent.md#41-stage-1-builds-the-trusted-run-context-the-helpdesk-boundary-and-the-ten-tools) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [N1](N1-harness-workspace-scaffold.md) |
| Size | S |

## Goal

Create the `@agent-speak/triage-agent` package with its subpath exports, scripts and the shared offline test setup, so every later A-todo lands in a package that already type-checks and refuses real model calls.

## Context

- [AD13](../../plans/build-agent.md#ad13-one-private-package-agent-speaktriage-agent-with-one-subpath-per-removable-component): the package and its subpaths
- [build-agent.md §3.1](../../plans/build-agent.md#31-one-package-under-packages-beside-the-sdks-and-harnesss): the layout and dependencies
- [build-agent.md §5.1](../../plans/build-agent.md#51-every-role-runs-offline-on-the-scripted-model-and-no-model-can-reach-the-host): the offline setup every test imports

## Scope

**In scope**

- `packages/triage-agent/package.json` (`private: true`, ESM, exports `.`, `./policy`, `./tools`, `./roles`, `./workflow`, `./helpdesk`, `./evals`, `./rollout`, `./testing`)
- `tsconfig.json` extending `tsconfig.base.json`; `typecheck` and `test` scripts
- Workspace dependencies on `@agent-speak/sdk`, `gateway`, `harness` and `evals`; `zod` 4.6.7
- A `test/setup.ts` that imports the SDK's offline setup and fails when a provider key variable is set
- README and CHANGELOG stubs

**Out of scope** (and which todo covers it)

- Any agent code (A2 onward)

## Tasks

- [ ] Copy the harness package's scaffold shape and scripts.
- [ ] Pin `zod` exactly at 4.6.7, the version in the lockfile.
- [ ] Add one smoke test per subpath that imports it.

## Acceptance criteria

- [ ] `pnpm --filter @agent-speak/triage-agent test` runs the smoke tests offline
- [ ] A test with `ANTHROPIC_API_KEY` set fails at setup
- [ ] Biome checks `packages/triage-agent` with `noExplicitAny` on
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/smoke.test.ts`.

## Docs to update

`packages/triage-agent/README.md`. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
