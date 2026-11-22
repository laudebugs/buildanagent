# N41: `Scheduler.wake` seam and its in-process implementation

| Field | Value |
| --- | --- |
| ID | `N41` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N4](../done/N4-writer-lock.md) |
| Size | S |

## Goal

Add the one seam the harness plan lacks for running off-host: `Scheduler.wake(at, sessionId)`, which promises to call `continueRun` for a session at a time. Lease renewal and approval deadlines move onto it, so no timer has to outlive a request.

## Context

- [Storage-and-wake note](../../research/deployment/storage-and-wake.md): defines the seam and its three rules.
- [Harness plan §3.2](../../plans/build-harness.md#32-session-log-api): where the seam is added.

## Scope

**In scope**

- `Scheduler` interface in `@buildanagent/harness`
- `processScheduler()` using an in-process timer
- `fileLock()` renewal moved onto the scheduler

**Out of scope**

- Cloud schedulers (N46a, N47a, N48a)

## Tasks

- [x] Add `interface Scheduler { wake(at: Date, sessionId: string): Promise<void>; cancel(sessionId: string): Promise<void> }` to harness §3.2
- [x] Implement `processScheduler()`
- [x] Route `fileLock()` renewal through the scheduler (no approval-deadline timer exists in `src/session/` to move; see the outcome)
- [x] Add scheduler cases to the conformance cases that N45 collects: a wake fires once at or after `at`, a duplicate wake is harmless

## Acceptance criteria

- [x] `pnpm test` passes with the new cases
- [x] No `setInterval` remains in `src/session/` outside `processScheduler()`

## Tests

Unit tests with a clock and timers a test drives by hand; a duplicate-wake test.

## Docs to update

Harness plan §3.2 (the interface).

## Risks and open questions

Wakes are at-least-once on every cloud, so callers must be idempotent; the tests assert that.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`Scheduler`, `ProcessScheduler`, `WakeHandler` and `processScheduler()` are in `packages/harness/src/session/scheduler.ts` and exported from `@buildanagent/harness/session`. `fileLock()` renews its lease through a scheduler. The plan's §3.2 and its status line record it, and the coding agent plan's table links this todo.

- **A wake is a key and a time.** Asking twice for the same id and time is one wake; `cancel(id)` drops every wake pending for the id. The scheduler checks the clock again before delivering when a timer fires early or a wake is too far off for one timer, so a wake never arrives before its time.
- **`onWake()` and `now()` are additions to the sketch.** The sketch had no way to say who receives a wake, so the in-process scheduler takes handlers, and its `now()` is the clock a caller reads to ask for a wake at a time the scheduler agrees with. A handler that throws goes to `onError` and never stops the next handler.
- **Lock renewal.** A hold asks for one renewal wake at a time, under the id `lease:<user>/<session>/<token>`. The token keeps a hold that lost its lock from cancelling a newer hold's wake. A hold also counts only a wake at the time it asked for, so a duplicate delivery neither renews twice nor starts a second chain. A release cancels the pending wake and stops listening. `fileLock({ scheduler })` takes a shared scheduler; without one each lock makes its own.
- **Approval deadlines needed no move.** See the plan's §3.2: no such timer exists.
- **Conformance.** `schedulerConformanceCases()` and `runSchedulerConformance()` are in `@buildanagent/harness/testing`; N45 collects them. `processScheduler()` passes every case.
- **No `setInterval` remains in `src/session/`**, and a test fails if one comes back.

