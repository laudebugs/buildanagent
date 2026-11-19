# F13: Per-tenant quotas and metering

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F13` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F1](F1-platform-tenancy.md) |
| Size | M |

## Goal

Cap each tenant's concurrent tasks, sandbox minutes and gate runs, checked before each task, and meter what the platform pays for (PF10).

## Context

- [PF10](../../plans/build-agent-platform.md#pf10-per-tenant-quotas-checked-before-each-task-proposed).

## Scope

**In scope**

- Quota records and a pre-task check
- Metering of sandbox time, gate runs and storage
- Low default caps for new accounts

**Out of scope**

- A payment provider integration (a later record)

## Tasks

- [ ] Define quota and usage records per tenant.
- [ ] Check quotas before a task starts and refuse with a typed error.
- [ ] Record usage after each task.

## Acceptance criteria

- [ ] A task over quota is refused before any sandbox starts.

## Tests

Unit tests for quota checks and metering.

## Docs to update

The plan's §5.1 table.

## Risks and open questions

The payment provider is an owner decision for later.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
