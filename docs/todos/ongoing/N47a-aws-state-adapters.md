# N47a: DynamoDB store and lock, EventBridge Scheduler wake and a Secrets Manager key store

| Field | Value |
| --- | --- |
| ID | `N47a` |
| Status | `ongoing` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](../done/N45-portability-conformance-suite.md) |
| Size | M |

## Goal

Implement the AWS side of the portable seams and pass the N45 conformance suite, so our harness runs on AWS as ADR 0033 requires.

## Context

- [Portable agents report](../../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places): the AWS row of the per-target table.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- `dynamoStore()` with a conditional write on the expected last id
- A DynamoDB lease-row `SessionLock`
- `Scheduler` on EventBridge Scheduler one-time schedules invoking the runner
- `KeyStore` from Secrets Manager

**Out of scope**

- The coding agent's deployment (W4, W9, W10)

## Tasks

- [ ] Implement each item behind the existing interfaces
- [ ] Run N45 against an emulator or recorded HTTP exchanges offline
- [ ] Add an opt-in live run that uses the owner's account and is never part of CI
- [ ] Pin every new dependency exactly, at least a week old

## Acceptance criteria

- [ ] N45 passes offline for every new implementation
- [ ] The opt-in live run is documented and passes once on the owner's account

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

Lambda stops at 900 s, so the runner must checkpoint and wake rather than run a whole task in one invocation.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
