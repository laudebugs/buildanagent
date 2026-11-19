# B1: Scaffold `packages/gateway` and `packages/sdk` in the workspace

| Field | Value |
| --- | --- |
| ID | `B1` |
| Status | `done` |
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

- [x] Create `packages/gateway/package.json`: name `@agent-speak/gateway`, `private: true`, `type: module`, version `0.0.0`, `exports` for `.` and `./testing`, scripts `typecheck` (`tsc -p tsconfig.json`) and `test` (`tsx --test`).
- [x] Create `packages/sdk/package.json` the same way, with exports `.`, `./otel` and `./testing`, and a `workspace:*` dependency on the gateway.
- [x] Add `tsconfig.json` in each package extending `../../tsconfig.base.json`.
- [x] Add `packages/*` to `pnpm-workspace.yaml` and run `pnpm install` to update the lockfile.
- [x] Add a smoke test per package that imports the package by name.
- [x] Add `packages/gateway/src/testing/setup.ts` with a fetch guard that throws for non-loopback hosts and fails if `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set; import it from both smoke tests.
- [x] Check that Node in CI and `.nvmrc` satisfy `>=22.19.0` (pi-schema's engine field, D7); pin `.nvmrc` to a matching minor if not. `.nvmrc` says `22`, which `actions/setup-node` resolves to the newest 22.x release, and the local run used Node 22.23.5, so no pin was needed.
- [x] Update AGENTS.md's Layout section and the root README's layout to name `packages/`.

## Acceptance criteria

- [x] `pnpm -r ls --depth -1` lists `@agent-speak/gateway` and `@agent-speak/sdk`
- [x] `pnpm typecheck` and `pnpm test` run both packages' scripts
- [x] The smoke tests pass, and a test that calls `fetch("https://example.com")` throws from the guard
- [x] `pnpm-lock.yaml` changes only by the two workspace entries
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The two smoke tests and the fetch-guard test, under `packages/*/test/`.

## Docs to update

AGENTS.md (Layout), README.md (layout), `pnpm-workspace.yaml`. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Low. CI may need the `packages/` paths added to any path filters; check `.github/workflows/`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome (2026-11-19)

- `packages/gateway` (`@agent-speak/gateway`, exports `.`, `./testing`, `./testing/setup`) and `packages/sdk` (`@agent-speak/sdk`, exports `.`, `./otel`, `./testing`, depending on the gateway through `workspace:*`) build, type-check and test from the root scripts.
- `@agent-speak/gateway/testing/setup` installs the offline guards from `src/testing/guards.ts`: `fetch` to any non-loopback host throws, and a set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` fails the run. The `./testing/setup` subpath is an addition to §3.1's export list, so other packages can import the setup by name.
- Eight tests pass: five in the gateway (package import, the blocked `fetch("https://example.com")`, loopback pass-through, loopback detection, the key check) and three in the SDK.
- `pnpm-lock.yaml` gained only the two importer entries, and CI has no path filters to change.
