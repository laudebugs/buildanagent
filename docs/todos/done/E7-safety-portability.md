# E7: The safety stores on Cloudflare, AWS and Vercel, and the package tests in workerd

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E7` |
| Status | `done` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E4b](../done/E4b-ordered-plan-execution.md), [E5](../done/E5-pre-call-cost-guard.md), [E6](../done/E6-byok-no-fallback.md) |
| Size | M |

## Goal

Run the safety package unchanged on local Node, Cloudflare, AWS and Vercel, with a durable `EffectStore` on each, so the write rule survives serverless restarts (gap 6). The harness already plans the same four targets and one conformance suite ([ADR 0033](../../decisions/0033-three-deployment-targets.md)); this todo adds the package's stores to that rule.

## Context

- [ADR 0033](../../decisions/0033-three-deployment-targets.md): four targets, one conformance suite.
- [N45](N45-portability-conformance-suite.md) and [N46a](N46a-cloudflare-state-adapters.md), [N47a](N47a-aws-state-adapters.md), [N48a](N48a-vercel-state-adapters.md): the harness's suite and state adapters, which this todo's stores follow.
- [Storage-and-wake note](../../research/deployment/storage-and-wake.md): at-least-once wakes, and why the store's insert-if-absent must be atomic.
- [Cloudflare reference §12](../../reference/cloudflare-agents/guide.md#12-tests-run-in-workerd-with-a-mock-model): running tests in workerd.

## Scope

**In scope**

- `EffectStore` on Durable Object SQLite, DynamoDB (conditional put) and Postgres (insert on conflict do nothing), each passing E2's conformance cases
- Running the whole package test suite in workerd as well as Node 22
- Recorded HTTP fixtures for DynamoDB, and a local Postgres in CI only if the CI plan allows it

**Out of scope** (and which todo covers it)

- The harness's own stores (N46a, N47a, N48a)
- Deploying anything (Round W and Round F)

## Tasks

- [x] Write the three stores behind `EffectStore`.
- [x] Run E2's conformance cases against each, offline: workerd for Durable Objects, recorded fixtures for DynamoDB, and an in-process Postgres substitute or a recorded wire if no database runs in CI.
- [x] Add a workerd job for the package's tests.
- [x] Export the conformance cases so N45 can import them.

## Acceptance criteria

- [x] Each store passes every conformance case, including two concurrent `begin` calls for one key where exactly one wins, and a `started` record that is taken over only after its lease lapses.
- [x] The package's full test suite passes in workerd and in Node 22.
- [x] No test reaches a real cloud service; the network guard from the SDK plan's test setup is in place ([build-sdk.md §5.4](../../plans/build-sdk.md#54-tests-run-offline-with-the-repos-safety-rules-built-in)).
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/stores/*.test.ts` and a workerd configuration for the package.

## Docs to update

The package README (choosing a store per target), and the N45 revision below.

## Risks and open questions

- Recorded DynamoDB fixtures prove the request shape, not real conditional-write behavior; the harness's N47a faces the same limit, and a live check belongs with W9's deploy.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/agent-safety` now has a durable `EffectStore` and a durable `PlanLedger` for each target, every one passing the shared conformance cases, and the package's portable tests run inside workerd as well as Node 22. The README's "Pick a durable store" section says which to use.

The public API, in three new subpaths and one addition to `./testing`:

- `./stores/cloudflare`: `durableObjectEffectStore()`, `durableObjectPlanLedger()`, `createCloudflareTables()`, on a Durable Object's `ctx.storage.sql`.
- `./stores/postgres`: `postgresEffectStore()`, `postgresPlanLedger()`, `POSTGRES_SCHEMA` and `createPostgresTables()`, on any client with `query(text, values)`.
- `./stores/dynamodb`: `dynamoEffectStore()`, `dynamoPlanLedger()`, on an `@aws-sdk/client-dynamodb` client, which joins the optional peers.
- `./testing` gains `planLedgerConformance()` and `PlanLedgerCase`, beside `effectStoreConformance()`, so N45 and any third-party ledger can import them. This closes [#155](https://github.com/laudebugs/buildanagent/issues/155).

What the build found:

- **Each store is conditional writes the database decides.** Durable Object SQLite and Postgres use `INSERT … ON CONFLICT` and `UPDATE … WHERE attempt = …` with `RETURNING`; DynamoDB uses a put under a condition expression, and a ledger claim is one transaction that checks the step before and puts this one. A ledger's claimed steps are rows `0` to `n - 1`, so a claim lands only when the row count equals its index.
- **The conformance cases run on the real engines where they exist.** The Durable Object stores run inside workerd on real Durable Object SQLite, one object per case; the Postgres stores run on PGlite, a WebAssembly Postgres in the test's process. The DynamoDB stores run through the real AWS SDK against a fake that speaks the wire protocol, applies the condition expressions and records each request, which the tests pin in full. That proves the request shapes and the store's reading of DynamoDB's answers, not DynamoDB's own atomicity, so the todo's open risk stands: a live check belongs with W9's deploy.
- **A shared lease scenario runs on every store.** It leaves a started record behind, shows that a call before the lease lapses reports `IN_PROGRESS` and sends nothing, and that a call after it reconciles, runs the write once under the same key and settles. This is the "taken over only after its lease lapses" criterion, checked above the store.
- **Vitest can't run inside workerd, so a small runner stands in for it.** `test/workerd/portable-suite.ts` loads each portable test file with the runner in place of `vitest`, and `test/workerd-suite.test.ts` runs them in workerd. A guard fails when a test file is in neither the suite nor a list of Node-only files with a reason, so a new file has to choose. The one test that used `node:vm` moved to its own Node-only file.
- **The package's Vitest conditions drop `module`.** Vitest passes them to Node for packages it loads natively, and the AWS SDK's `module` builds can't be loaded by Node's ESM loader. The gateway's conditions guard test names this one exception.
- **The DynamoDB tests needed the SDK as a pinned dev dependency, and PGlite joined it.** Both are exact-pinned releases at least a week old, and the SDK is an optional peer.
