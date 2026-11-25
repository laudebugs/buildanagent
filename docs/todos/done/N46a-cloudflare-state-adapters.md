# N46a: Cloudflare store, lock, scheduler, key store and the workerd smoke test

| Field | Value |
| --- | --- |
| ID | `N46a` |
| Status | `done` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#51-portability-todos-extend-round-n-with-a-stage-8) |
| Round / milestone | Round N (build harness, stage 8: portability), M6 |
| Depends on | [N45](N45-portability-conformance-suite.md) |
| Size | M |

## Goal

Implement the Cloudflare side of the portable seams and pass the N45 conformance suite, so our harness runs on Cloudflare as ADR 0033 requires.

## Context

- [Portable agents report, runtimes](../../research/deployment/portable-agents.md#runtimes-split-into-an-isolate-tier-and-a-process-tier): Workers and Durable Object limits.
- [ADR 0033](../../decisions/0033-three-deployment-targets.md): the target table.

## Scope

**In scope**

- `doSqliteStore()` and the Durable Object as `SessionLock`
- `Scheduler` on Durable Object alarms
- `KeyStore` from a Worker secret or Secrets Store
- WebSocket hibernation for N44's transport
- A workerd smoke test that loads pi-schema and the MCP client, with `@cfworker/json-schema` as the fallback

**Out of scope**

- The coding agent's deployment (W4, W9, W10)

## Tasks

- [x] Implement each item behind the existing interfaces
- [x] Run N45 against an emulator or recorded HTTP exchanges offline
- [x] Add an opt-in live run that uses the owner's account and is never part of CI
- [x] Pin every new dependency exactly, at least a week old

## Acceptance criteria

- [x] N45 passes offline for every new implementation
- [ ] The opt-in live run is documented and passes once on the owner's account (documented; the owner runs it, see the outcome)

## Tests

N45 offline; live mode opt-in.

## Docs to update

Harness plan §4 stage 8 table; README of the new adapter.

## Risks and open questions

Alarms run for at most 15 minutes, so a long turn must end each step with a wake.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked (drafted with the skill; the review runs on the pull request)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- `@buildanagent/harness/cloudflare` holds five adapters, each taking the Durable Object's `ctx.storage` or its sockets by shape, so the subpath has no Cloudflare dependency and no optional peer:
  - `doSqliteStore()` and `doSqliteIndex()`: one row per entry and per pointer. An append runs `planAppend()` inside one `transactionSync()` and reads only the rows its batch names.
  - `doLock()`: one row per held session, taken with one conditional `INSERT … ON CONFLICT DO UPDATE … WHERE lease_until < now`, with a lapsed lease as the only staleness rule and renewal through a `ProcessScheduler`.
  - `doAlarmScheduler()`: one row per wake and the object's one alarm set to the earliest. A wake is deleted only after its handlers return, and one whose handler throws comes back after `retryMs`.
  - `workerKeyStore()`: a read-only `KeyStore` over a Worker secret or a Secrets Store binding, through `secretKeyStore()`, with `CLOUDFLARE_PLATFORM_HINT` for `rotateKeys()` and `pruneKeys()`.
  - `webSocketHibernation()`: one `webSocketTransport()` per hibernatable socket. It records each connection's `initialize` and up to 8 opened sessions in the socket's attachment, and replays them after an eviction before the client's next frame.
- `test/cloudflare/cloudflare.test.ts` runs every case of the portability suite in its own Durable Object in workerd through Miniflare, with outbound requests refused and asserted empty. Six seams pass there; the sandbox and egress seams belong to N46b, which is on hold. Four cases skip by design: the two torn-line cases and the key store's rotate and prune. The same file runs 16-request lock and append races, the real alarm with a retried wake, a real socket whose object lost its memory, and the smoke test, in which pi-schema, `@cfworker/json-schema` and the MCP client all work in workerd. So the fallback validator is not needed.
- `examples/cloudflare-session-object.ts` builds a Durable Object's agent server from the adapters, and the test Worker serves its sockets with it.
- The live run (`test/cloudflare/live.ts`, `packages/harness/docs/cloudflare-live-run.md`) needs `HARNESS_CLOUDFLARE_LIVE=1`, refuses under `CI`, deploys the test Worker under a random name behind a random token, and deletes it at the end. This session has no Cloudflare account, so the second acceptance box stays open until the owner runs it once and records the output.
- New dev dependencies, all already in the lockfile: `@cfworker/json-schema` 4.1.6 and `esbuild` 0.28.2. `HarnessError` gains `invalid_store_options` and `invalid_scheduler_options`. Claims are logged as rows N46a-1 to N46a-24 in [the Cloudflare adapters fact-check](../../plans/reviews/fact-check-cloudflare-adapters.md).
