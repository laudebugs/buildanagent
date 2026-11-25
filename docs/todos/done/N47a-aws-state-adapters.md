# N47a: DynamoDB store and lock, EventBridge Scheduler wake and a Secrets Manager key store

| Field | Value |
| --- | --- |
| ID | `N47a` |
| Status | `done` |
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

- [x] Implement each item behind the existing interfaces
- [x] Run N45 against an emulator or recorded HTTP exchanges offline
- [x] Add an opt-in live run that uses the owner's account and is never part of CI
- [x] Pin every new dependency exactly, at least a week old

## Acceptance criteria

- [x] N45 passes offline for every new implementation
- [ ] The opt-in live run is documented and passes once on the owner's account (documented; the owner runs it, because this session has no AWS account)

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

Lambda stops at 900 s, so the runner must checkpoint and wake rather than run a whole task in one invocation.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Three subpaths of `@buildanagent/harness` hold the AWS side of four portable seams, each on an AWS SDK v3 client the host passes in. The clients are optional peers at 3.1169.0, so the root entry and every other subpath stay free of them ([README](../../../packages/harness/README.md#on-aws-dynamodb-eventbridge-scheduler-and-secrets-manager-hold-the-harnesss-state)).

- **`dynamoStore()`** (`./aws/dynamodb`) stages a batch's entries as items keyed by a random batch id, then commits them with one conditional put of the session's head. A batch of any size is therefore written whole or not at all, which a 100-action transaction could not promise for `migrateSession()` and `purgeSession()`. Orphans from a lost race or a crash are never read as the log.
- **`dynamoLock()`** (`./aws/dynamodb`) is one lease item per session, changed only by conditional `UpdateItem`s. It has a `fence` that only grows and a `maxClockSkewMs` margin, after which `held()` turns `false` for good. A lost response on acquire is recognised by the token that the failed condition returns.
- **`eventBridgeScheduler()`** (`./aws/scheduler`) makes each wake a self-deleting one-time schedule named by a hash of the id and the time. `deliverWake()` holds an early wake back, because the service fires within a minute.
- **`secretsManagerKeyStore()`** (`./aws/secrets-manager`) reads `AWSCURRENT` on every load and is read-only. Its errors carry fixed text plus the AWS error's name, and no cause.

The AWS target passes the N45 suite offline against in-process fakes of the three services, with agent-safety's `dynamoEffectStore()` as a fifth seam. Its only skips are the two torn-line cases and the read-only key store's rotate and prune. The live run, `packages/harness/scripts/aws-live.mjs`, is written and refuses to start unless `HARNESS_AWS_LIVE=1` is set and `CI` is not. It has not run, because this session has no AWS account, so the second acceptance box stays open until the owner runs it once. The fact-check rows are N47a-1 to N47a-26 in the [harness plan's log](../../plans/reviews/fact-check-build-harness.md).

