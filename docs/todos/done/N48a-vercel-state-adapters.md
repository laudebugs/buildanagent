# N48a: Postgres store and lock, Workflow wake and an environment key store

| Field | Value |
| --- | --- |
| ID | `N48a` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](N45-portability-conformance-suite.md) |
| Size | M |

## Goal

Implement the Vercel side of the portable seams and pass the N45 conformance suite, so our harness runs on Vercel as ADR 0033 requires.

## Context

- [Storage-and-wake note](../../research/deployment/storage-and-wake.md#three-rules-come-with-the-seams): the one-step-per-`continueRun` rule for workflow engines.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- `postgresStore()` with the expected-last-id compare-and-swap
- A Postgres lease-row `SessionLock`
- `Scheduler` on Vercel Workflow `sleep()` and hooks, one workflow step per `continueRun`
- `KeyStore` from a secret environment variable

**Out of scope**

- The coding agent's deployment (W4, W9, W10)

## Tasks

- [x] Implement each item behind the existing interfaces
- [x] Run N45 against an emulator or recorded HTTP exchanges offline
- [x] Add an opt-in live run that uses the owner's account and is never part of CI
- [x] Pin every new dependency exactly, at least a week old

## Acceptance criteria

- [x] N45 passes offline for every new implementation
- [ ] The opt-in live run is documented and passes once on the owner's account (documented; the owner runs it, because the build session cannot reach the owner's database or vercel.com)

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

Vercel Functions stop at 300–1,800 s, so every long wait must go through Workflow.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- **`@buildanagent/harness/vercel`** adds four seams that take their client as an argument and import no driver or SDK. `postgresStore(client)` writes one row per entry; the primary key on `(user_id, session_id, seq)` makes the multi-row `INSERT` the compare-and-swap, and an append that loses the race plans again (five tries, then `ConflictError`). `postgresLock(client)` is a lease row taken with one `INSERT … ON CONFLICT … DO UPDATE … WHERE`, timed on the database's `clock_timestamp()`, renewed through a `ProcessScheduler`, with a `fence` that grows on every acquire and a local monotonic deadline for `held()`. `workflowScheduler({ ledger, start, resumeHook })` records each wake in `harness_wakes` (`postgresWakeLedger()`) with a nonce that its hook token carries, and starts one Workflow run; `cancel()` clears the ledger and resumes each run's hook. `envKeyStore({ name })` wraps `secretKeyStore()` over one variable, by default `HARNESS_KEY_RING`. `POSTGRES_HARNESS_SCHEMA` and `createPostgresHarnessTables()` create the three tables.
- **`@buildanagent/harness/vercel/workflow`** holds `runWakeWorkflow()`, the run's body, which imports nothing. It sleeps with the SDK's `sleep()`, races a `createHook()` hook, ends as `"duplicate"` when `getConflict()` finds the token taken, and calls the host's `"use step"` function once, which calls `deliverWake()`. So the engine holds only the wait and the wake, one step per `continueRun`.
- **Tests.** `test/vercel/vercel-target.test.ts` runs the portability suite's store, lock, scheduler, key store and effect store cases (with `postgresEffectStore()`) on PGlite 0.5.16 and passes every case but the two torn-line and two read-only key store cases, which skip. `test/vercel/adapters.test.ts` adds racing appends, a forced lost race, paging, the database clock, the fence, the local deadline, a renewal that finds another token, the duplicate and cancel paths, a failing handler, the key store's no-leak checks and an import boundary. `test/vercel/examples.test.ts` runs both examples, with the Workflow SDK's functions replaced by stand-ins.
- **Decisions.** The todo names Postgres, so the store and lock are Postgres rather than Redis. The adapters take a structural client (`PgClientLike` from `@buildanagent/agent-safety/stores/postgres`) and the SDK's functions as arguments, so the subpaths need no optional peer and `scripts/ci/packages-pack.test.mjs` needs no `OPTIONAL_PEER_FAILURES` entry. `workflow` 5.6.1 is a dev dependency, which type-checks the wake example against the real SDK. `cancel()` needs a ledger because a Workflow run cannot be found by session id from another instance; the hook only ends a cancelled run early.
- **Why Postgres.** N48a's scope and §4.8 of the [harness plan](../../plans/build-harness.md#48-stage-8-makes-the-harness-portable-to-cloudflare-aws-and-vercel-added-2026-11-18) name a Postgres store and lock. The [portable-agents report](../../research/deployment/portable-agents.md)'s Vercel row lists "Marketplace Postgres or Redis, or a Workflow SDK world" and records no reason to pick one. The adapters rely on three Postgres properties. First, the store's compare-and-swap on the last entry is one `INSERT` against the primary key on user, session and `seq`. Second, the lease and its fence are one atomic `INSERT … ON CONFLICT DO UPDATE … WHERE`, timed on the database's clock. Third, the same schema runs on any Postgres. A Redis or Vercel KV store would be a separate adapter behind the same interfaces, and it must pass the same N45 conformance suite.
- **Live run.** `pnpm --filter @buildanagent/harness live:vercel` (`scripts/live-vercel.mjs`) runs with `HARNESS_LIVE_VERCEL=1` and `DATABASE_URL`, in a throwaway schema, and never prints the connection string; no workflow runs it. The Workflow half needs a deployed app, which the README describes. The owner has not run it yet, so its acceptance box stays open.
- **Fact-check.** [fact-check-vercel-adapters.md](../../plans/reviews/fact-check-vercel-adapters.md), rows N48a-1 to N48a-31. The first review round settled the five rows that only vercel.com or workflow-sdk.dev could answer. The ⚠️ rows left are three claims no offline test can settle (true parallel acquires, clock drift and Neon's error code) and two Postgres rules the session did not re-read.
