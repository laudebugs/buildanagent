# F3: The gate's type-check and mock-model checks, with the verify runners factored out

| Field | Value |
| --- | --- |
| ID | `F3` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [B1](B1-sdk-workspace-scaffold.md) |
| Size | M |

## Goal

Build the first two checks of the check-and-deploy gate (PF4) by factoring the verification harnesses' type-check and mock-model runners into reusable modules.

## Context

- [PF4](../../plans/build-agent-platform.md#pf4-a-check-and-deploy-gate-with-graders-the-generator-never-sees-accepted-adr-0039) and [ADR 0039](../../decisions/0039-check-and-deploy-gate.md).
- [`verify/cloudflare-agents/scripts`](../../../verify/cloudflare-agents/scripts/) and [`verify/vercel-ai-sdk/scripts`](../../../verify/vercel-ai-sdk/scripts/): the runners to reuse.

## Scope

**In scope**

- A gate module that type-checks a project against pinned SDK types
- A mock-model test runner with host-touching tools denied by name
- Refactoring the two verify harnesses to use the shared modules without changing their results

**Out of scope**

- Evals and signed reports (F4)
- Running the gate in a hosted sandbox (F11)

## Tasks

- [ ] Extract the type-check and mock-model logic from the two harnesses into a shared module.
- [ ] Re-run `pnpm run verify` for both SDKs and confirm `results/` is unchanged.
- [ ] Add a gate entry point that takes a project directory and a target and returns typed check results.

## Acceptance criteria

- [ ] Both harnesses' results files are unchanged after the refactor.
- [ ] A fixture project with a type error fails the gate; a clean one passes.

## Tests

Fixture projects for each target under the gate's tests; the results-drift check in CI.

## Docs to update

The verify READMEs for the shared module.

## Risks and open questions

The refactor must not change results; the drift check is the guard.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
