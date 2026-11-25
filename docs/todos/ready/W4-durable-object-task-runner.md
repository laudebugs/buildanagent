# W4: Task runner on a Durable Object, with wake and resume onto a fresh sandbox

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W4` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W2](W2-coding-tool-profile.md), [N46a](../done/N46a-cloudflare-state-adapters.md), [N46b](N46b-cloudflare-sandbox-backend.md) |
| Size | M |

## Goal

Run one harness session per task inside a Durable Object, as ADR 0036 decides, with alarms for wakes and resume onto a fresh sandbox when one is reclaimed.

## Context

- [ADR 0036](../../decisions/0036-loop-outside-sandbox-and-pr-approval.md): the loop's placement.
- [Storage-and-wake note](../../research/deployment/storage-and-wake.md): the seams the runner uses.

## Scope

**In scope**

- The task Durable Object
- Step-per-wake execution within the alarm limit
- Resume onto a fresh sandbox, telling the model which background jobs died

**Out of scope**

- The control-plane Worker (W5)

## Tasks

- [ ] Host the harness session in the object
- [ ] End each step with `Scheduler.wake`
- [ ] Detect a reclaimed sandbox and resume from the log

## Acceptance criteria

- [ ] A test kills the sandbox mid-task and the task finishes after resume
- [ ] A replayed alarm does not repeat a side effect

## Tests

Offline tests in workerd with the scripted model and a fake sandbox.

## Docs to update

Plan §3.

## Risks and open questions

Alarm timing in tests is emulated, not real.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
