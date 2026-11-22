# E7: The safety stores on Cloudflare, AWS and Vercel, and the package tests in workerd

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E7` |
| Status | `ongoing` |
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

- [ ] Write the three stores behind `EffectStore`.
- [ ] Run E2's conformance cases against each, offline: workerd for Durable Objects, recorded fixtures for DynamoDB, and an in-process Postgres substitute or a recorded wire if no database runs in CI.
- [ ] Add a workerd job for the package's tests.
- [ ] Export the conformance cases so N45 can import them.

## Acceptance criteria

- [ ] Each store passes every conformance case, including two concurrent `begin` calls for one key where exactly one wins, and a `started` record that is taken over only after its lease lapses.
- [ ] The package's full test suite passes in workerd and in Node 22.
- [ ] No test reaches a real cloud service; the network guard from the SDK plan's test setup is in place ([build-sdk.md §5.4](../../plans/build-sdk.md#54-tests-run-offline-with-the-repos-safety-rules-built-in)).
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/stores/*.test.ts` and a workerd configuration for the package.

## Docs to update

The package README (choosing a store per target), and the N45 revision below.

## Risks and open questions

- Recorded DynamoDB fixtures prove the request shape, not real conditional-write behavior; the harness's N47a faces the same limit, and a live check belongs with W9's deploy.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
