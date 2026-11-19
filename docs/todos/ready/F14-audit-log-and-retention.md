# F14: Audit log, export and retention

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F14` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F1](F1-platform-tenancy.md) |
| Size | S |

## Goal

Give each tenant an append-only audit log with export and a retention period (PF11).

## Context

- [PF11](../../plans/build-agent-platform.md#pf11-an-append-only-audit-log-per-tenant-proposed).
- [Harness plan](../../plans/build-harness.md): HD11's retention rule.

## Scope

**In scope**

- Append-only log records
- Export
- Retention setting and account-close deletion

**Out of scope**

- Log search UI

## Tasks

- [ ] Define the event kinds: build, gate report, deploy, approval, connection change.
- [ ] Implement append and export.
- [ ] Ask each new tenant for a retention period, and delete after the grace period on account close.

## Acceptance criteria

- [ ] An existing record cannot be changed through the API.
- [ ] Export returns every record for the tenant and none of another's.

## Tests

Unit tests.

## Docs to update

Platform docs on retention.

## Risks and open questions

The grace period is an owner decision.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
