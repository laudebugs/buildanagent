# N15: Sandbox interface, the `none` backend, `spawnEnv` and the conformance suite

| Field | Value |
| --- | --- |
| ID | `N15` |
| Status | `done` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N1](../done/N1-harness-workspace-scaffold.md) |
| Size | M |

## Goal

Define the pluggable sandbox client with honest tiers, ship the unsafe `none` backend and an in-memory fake, build the cleared environment every spawned process uses, and pin the interface with a conformance suite.

## Context

- [HD4](../../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-accepted): the decision and its evidence
- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): separate policies, honest tiers, fail closed, cleared env
- [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis): the API sketch
- [AGENTS.md coding standards](../../../AGENTS.md#coding-standards): allowlisted environments

## Scope

**In scope**

- `SandboxClient`, `Sandbox`, `SandboxPolicy`, `ApprovalPolicy`, `WorkspaceManifest`, `SandboxUnavailableError`, `SandboxDenial`
- `noneSandbox({ unsafe: true })` with `stops: []` and a start-up warning
- `fakeSandbox()` in `./testing`: an in-memory file system and a recorded `exec`
- `spawnEnv(allow, extra)`: `PATH`, a temp `HOME`, `TMPDIR`, `LANG` and named extras only
- `runSandboxConformance(factory)`

**Out of scope** (and which todo covers it)

- `srt` and Docker (N16, N17)
- Escalation (N18)

## Tasks

- [x] Make `noneSandbox` without `unsafe: true` a type error and a runtime throw.
- [x] Write conformance cases that skip with a reason when the backend reports itself unavailable.

## Acceptance criteria

- [x] `noneSandbox({})` fails to compile and throws at run time
- [x] `spawnEnv([])` returns exactly `PATH`, `HOME`, `TMPDIR` and `LANG`, with `HOME` a fresh temp directory
- [x] The fake passes the conformance suite
- [x] A test that sets `ANTHROPIC_API_KEY` in the parent finds it absent in a spawned child
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/conformance.test.ts`, `spawn-env.test.ts`.

## Docs to update

`packages/harness/README.md`: the tiers and what each stops. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/harness` now has `./sandbox` and `./testing`: the sandbox types, `noneSandbox({ unsafe: true })`, `spawnEnv()`, a `HarnessError`, `fakeSandbox()` and a sixteen-case conformance suite (`runSandboxConformance()`, `sandboxConformanceCases()`). The README says what each tier stops.

- **`none` is a real backend that needs an acknowledgement.** Leaving out `unsafe: true` is a type error and a `HarnessError` (`unsafe_sandbox_not_acknowledged`). It warns at each provision, claims `stops: []`, runs processes with no shell, and reports exit 124 on a timeout and 127 for a command it can't find.
- **`spawnEnv` refuses credential-looking names in `allow`.** A key reaches a child only as an explicit `extra`, so a key set in the parent never leaks by accident. The test sets `ANTHROPIC_API_KEY` in the parent and finds it absent in the child.
- **The suite skips what a backend doesn't claim.** Write, read and network denial cases run only when `stops` claims `mistakes` or `exfiltration`, and an unavailable backend skips every case with its reason.
- **Package source stays portable.** The two Node-only files use `process.getBuiltinModule` lazily and are the only allowlisted exceptions in the portability test and Biome.
