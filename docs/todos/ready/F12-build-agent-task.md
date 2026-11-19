# F12: The `build-agent` task type on the coding agent's runner, per tenant

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F12` |
| Status | `ready` |
| Plan | [Build agent platform §5.2](../../plans/build-agent-platform.md#52-stage-f-b-connects-the-engine-and-ships-m8) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [W4](W4-durable-object-task-runner.md), [W5](W5-control-plane-ingress.md), [F6](F6-generation-templates.md), [F10](F10-platform-github-app.md), [F11](F11-generated-code-isolation.md) |
| Size | L |

## Goal

Add the `build-agent` task type to the coding agent's engine and run it per tenant, so a description becomes a repository and a gate request (PF3).

## Context

- [PF3](../../plans/build-agent-platform.md#pf3-the-builder-engine-is-a-coding-agent-task-type-run-per-tenant-proposed).
- [Coding agent plan §3](../../plans/build-coding-agent.md#3-architecture-the-loop-in-a-durable-object-the-sandbox-without-credentials).

## Scope

**In scope**

- The task type, its input and output
- Durable Objects named `<tenant>/<task>`
- Quota checks before start (F13's interface)

**Out of scope**

- Changes to the personal agent's behaviour

## Tasks

- [ ] Add the task type to the runner with the template's tools and instructions.
- [ ] Name Durable Objects by tenant and task.
- [ ] Open a draft pull request and submit a gate request.

## Acceptance criteria

- [ ] A description produces a repository whose project passes the gate in a recorded run.
- [ ] Two tenants' tasks share no state.

## Tests

Offline end-to-end tests on scripted models and fake GitHub.

## Docs to update

The plan's §5.2 table.

## Risks and open questions

This todo waits for W4 and W5; §7 records the risk.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
