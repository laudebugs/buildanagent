# N41: `Scheduler.wake` seam and its in-process implementation

| Field | Value |
| --- | --- |
| ID | `N41` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N4](N4-writer-lock.md) |
| Size | S |

## Goal

Add the one seam the harness plan lacks for running off-host: `Scheduler.wake(at, sessionId)`, which promises to call `continueRun` for a session at a time. Lease renewal and approval deadlines move onto it, so no timer has to outlive a request.

## Context

- [Storage-and-wake note](../../research/deployment/storage-and-wake.md): defines the seam and its three rules.
- [Harness plan §3.2](../../plans/build-harness.md#32-session-log-api): where the seam is added.

## Scope

**In scope**

- `Scheduler` interface in `@agent-speak/harness`
- `processScheduler()` using an in-process timer
- `fileLock()` renewal moved onto the scheduler

**Out of scope**

- Cloud schedulers (N46a, N47a, N48a)

## Tasks

- [ ] Add `interface Scheduler { wake(at: Date, sessionId: string): Promise<void>; cancel(sessionId: string): Promise<void> }` to harness §3.2
- [ ] Implement `processScheduler()`
- [ ] Route `fileLock()` renewal and approval deadlines through the scheduler
- [ ] Add scheduler cases to the conformance cases that N45 collects: a wake fires once at or after `at`, a duplicate wake is harmless

## Acceptance criteria

- [ ] `pnpm test` passes with the new cases
- [ ] No `setInterval` remains in `src/session/` outside `processScheduler()`

## Tests

Unit tests with the SDK's stable `clock`; a duplicate-wake test.

## Docs to update

Harness plan §3.2 (the interface).

## Risks and open questions

Wakes are at-least-once on every cloud, so callers must be idempotent; the tests assert that.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
