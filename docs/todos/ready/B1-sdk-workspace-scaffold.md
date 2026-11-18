# B1: Scaffold `packages/gateway` and `packages/sdk` in the workspace

| Field | Value |
| --- | --- |
| ID | `B1` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 1](../../plans/build-sdk.md#41-stage-1-builds-the-gateway-types-and-the-scripted-model-that-every-later-todo-tests-against) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [P4](../done/P4-plan-review.md) |
| Size | S |

## Goal

Create the two empty packages that every later Round B todo fills, wired into the pnpm workspace, the root scripts and CI, so the first real code lands in a package that already builds, lints and tests.

## Context

- [D1](../../plans/build-sdk.md#d1-two-packages-because-the-gateway-has-consumers-that-never-run-the-loop): why two packages, and why under `packages/`
- [Package layout §3.1](../../plans/build-sdk.md#31-two-packages-under-a-new-top-level-packages-directory): folders, exports and tooling
- [AGENTS.md coding standards](../../../AGENTS.md#coding-standards): pins, ESM, tsconfig, Biome, the commit gate

## Scope

**In scope**

- `packages/gateway` and `packages/sdk` with `package.json`, `tsconfig.json`, `src/index.ts`, a `testing` subpath and one smoke test each
- The `packages/*` entry in `pnpm-workspace.yaml`
- A shared test setup file that later todos extend (§5.4)
- AGENTS.md's Layout section, which says the only code is under `verify/`

**Out of scope** (and which todo covers it)

- Any real types or code (B2 onward)

## Tasks

- [ ] Create `packages/gateway/package.json`: name `@agent-speak/gateway`, `private: true`, `type: module`, version `0.0.0`, `exports` for `.` and `./testing`, scripts `typecheck` (`tsc -p tsconfig.json`) and `test` (`tsx --test`).
- [ ] Create `packages/sdk/package.json` the same way, with exports `.`, `./otel` and `./testing`, and a `workspace:*` dependency on the gateway.
- [ ] Add `tsconfig.json` in each package extending `../../tsconfig.base.json`.
- [ ] Add `packages/*` to `pnpm-workspace.yaml` and run `pnpm install` to update the lockfile.
- [ ] Add a smoke test per package that imports the package by name.
- [ ] Add `packages/gateway/src/testing/setup.ts` with a fetch guard that throws for non-loopback hosts and fails if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set; import it from both smoke tests.
- [ ] Check that Node in CI and `.nvmrc` satisfy `>=22.19.0` (pi-schema's engine field, D7); pin `.nvmrc` to a matching minor if not.
- [ ] Update AGENTS.md's Layout section and the root README's layout to name `packages/`.

## Acceptance criteria

- [ ] `pnpm -r ls --depth -1` lists `@agent-speak/gateway` and `@agent-speak/sdk`
- [ ] `pnpm typecheck` and `pnpm test` run both packages' scripts
- [ ] The smoke tests pass, and a test that calls `fetch("https://example.com")` throws from the guard
- [ ] `pnpm-lock.yaml` changes only by the two workspace entries
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The two smoke tests and the fetch-guard test, under `packages/*/test/`.

## Docs to update

AGENTS.md (Layout), README.md (layout), `pnpm-workspace.yaml`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Low. CI may need the `packages/` paths added to any path filters; check `.github/workflows/`.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
