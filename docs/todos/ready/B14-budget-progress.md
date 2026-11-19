# B14: Pre-emptive USD budget, progress detection and the depth cap

| Field | Value |
| --- | --- |
| ID | `B14` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B5](B5-usage-cost-catalog.md), [B13](B13-interceptors-observers.md) |
| Size | M |

## Goal

Stop runaway runs before they spend: check the USD cap before each model call, stop on repeated failing calls, and cap subagent depth.

## Context

- [D9](../../plans/build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost)
- [D11](../../plans/build-sdk.md#d11-three-identical-failing-calls-stop-the-run-and-the-depth-cap-is-2-provisional)
- [agent-SDK guide §3](../../guides/agent-sdk.md#3-the-loop-should-be-one-in-process-pure-function-capped-in-model-calls-that-ends-with-a-stop-reason): practitioners add progress detection and an earlier budget check

## Scope

**In scope**

- `budgetUsd` checked before each call against the projected cost
- Refusal to start a budgeted run when the model's price is unknown (D4)
- The default `progress` policy and `progressKey`
- `depth` and `maxDepth` in `ToolContext`
- `projectCallCost(model, context, options)`, exported from `budget.ts`; the loop's own check calls it

**Out of scope** (and which todo covers it)

- Retuning thresholds on recorded runs (N39)

## Tasks

- [ ] Implement the input estimate: the previous call's `totalInput` plus a character-based estimate of new messages.
- [ ] Implement the projection with `maxOutputTokens` and the catalog's rates.
- [ ] Implement the default progress policy on canonical input hashes as a `shouldStop` interceptor that returns `{ stop: "no_progress", reason }`.
- [ ] Measure overshoot on a scripted 30-step run with the pre-emptive check and with a post-response check, and record both in the test output.

## Acceptance criteria

- [ ] A run whose next projected call would cross the cap ends `budget` before that call (the scripted model records no extra call)
- [ ] With the pre-emptive check, the scripted run's overshoot is at most one call's projection error; the post-response variant overshoots by at least one call
- [ ] A budgeted run on an unknown-price model ends `error` with `error.kind: "unknown_price"` before any call
- [ ] `projectCallCost()` returns the same projection the loop's check uses (a test compares both on one scripted context)
- [ ] Three identical failing calls end `no_progress`; two do not
- [ ] Five calls with the same `progressKey` and no success between them end `no_progress`
- [ ] A tool at `depth === maxDepth` that spawns a run gets an error result
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/budget.test.ts`, `progress.test.ts`.

## Docs to update

`packages/sdk/README.md`: the defaults and how to change them. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The thresholds are provisional (D11); P2's recorded runs retune them.

## Revision (2026-11-18, SDK gaps)

[ADR 0043](../../decisions/0043-standalone-safety-core.md), accepted by the owner on 2026-11-18, moves `projectCallCost()` to the gateway, beside the catalog, so the loop and the safety package's AI SDK guard ([E5](E5-pre-call-cost-guard.md)) share one formula. [B5](B5-usage-cost-catalog.md)'s revision now exports it, with the token-level `projectCost()` it calls.

- [ ] The loop imports `projectCallCost()` from `@agent-speak/gateway` instead of defining it, and this todo's overshoot test runs unchanged against the imported function.
- [ ] The SDK's public exports re-export `projectCallCost()` from the gateway, so the harness's summary layer keeps one import path.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
