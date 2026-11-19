# B14: Pre-emptive USD budget, progress detection and the depth cap

| Field | Value |
| --- | --- |
| ID | `B14` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B5](../done/B5-usage-cost-catalog.md), [B13](../done/B13-interceptors-observers.md), [E1](../done/E1-safety-core-outcomes.md) |
| Size | M |

## Goal

Stop runaway runs before they spend: check the USD cap before each model call, stop on repeated failing calls, and cap subagent depth.

## Context

- [D9](../../plans/build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost)
- [D11](../../plans/build-sdk.md#d11-three-identical-failing-calls-stop-the-run-and-the-depth-cap-is-2-provisional)
- [ADR 0043](../../decisions/0043-standalone-safety-core.md): `projectCallCost()` lives in the gateway ([B5](../done/B5-usage-cost-catalog.md)), and `canonicalInputHash()` in the safety package ([E1](../done/E1-safety-core-outcomes.md))
- [agent-SDK guide §3](../../guides/agent-sdk.md#3-the-loop-should-be-one-in-process-pure-function-capped-in-model-calls-that-ends-with-a-stop-reason): practitioners add progress detection and an earlier budget check

## Scope

**In scope**

- `budgetUsd` checked before each call against the projected cost
- Refusal to start a budgeted run when the model's price is unknown (D4)
- The default `progress` policy and `progressKey`
- `depth` and `maxDepth` in `ToolContext`
- The loop's check calls `projectCallCost(model, context, options)`, imported from `@buildanagent/gateway` (B5), and the SDK re-exports it so the harness's summary layer keeps one import path

**Out of scope** (and which todo covers it)

- Retuning thresholds on recorded runs (N39)
- Defining `projectCallCost()` (B5) or `canonicalInputHash()` (E1)

## Tasks

- [x] Implement the input estimate: the previous call's `totalInput` plus a character-based estimate of new messages.
- [x] Call the gateway's `projectCallCost()` for the projection, and re-export it from the SDK.
- [x] Implement the default progress policy on `canonicalInputHash()` from `@buildanagent/agent-safety` as a `shouldStop` interceptor that returns `{ stop: "no_progress", reason }`.
- [x] Measure overshoot on a scripted 30-step run with the pre-emptive check and with a post-response check, and record both in the test output.

## Acceptance criteria

- [x] A run whose next projected call would cross the cap ends `budget` before that call (the scripted model records no extra call)
- [x] With the pre-emptive check, the scripted run's overshoot is at most one call's projection error; the post-response variant overshoots by at least one call
- [x] A budgeted run on an unknown-price model ends `error` with `error.kind: "unknown_price"` before any call
- [x] The SDK's re-exported `projectCallCost()` returns the same projection the loop's check uses (a test compares both on one scripted context), and the overshoot test runs against the imported function
- [x] Three identical failing calls end `no_progress`; two do not
- [x] Five calls with the same `progressKey` and no success between them end `no_progress`
- [x] A tool at `depth === maxDepth` that spawns a run gets an error result
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/budget.test.ts`, `progress.test.ts`.

## Docs to update

`packages/sdk/README.md`: the defaults and how to change them. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The thresholds are provisional (D11); P2's recorded runs retune them.

## Outcome

`run()` takes `budgetUsd`, `progress`, `depth` and `maxDepth`. `RunResult` gains a `budget` variant, `RunError.kind` gains `"unknown_price"`, `ToolDefinition` gains `progressKey()`, and the package root exports `projectCallCost` (the gateway's function), `nestedRunDepth`, `DEFAULT_PROGRESS` and the `ProgressPolicy` and `BudgetResult` types. The changeset is `.changeset/budget-progress-depth.md`, a `minor` bump that opens with "Breaking Changes", because an exhaustive `switch` over `RunResult` or `RunError.kind` needs a new case and every run now ends `no_progress` by default.

Each criterion and the test that covers it:

- Next call over the cap ends `budget` before the call: `test/budget.test.ts`, "a run whose next call would cross the cap", checks that the scripted model saw exactly ten calls.
- Overshoot: the last test of `test/budget.test.ts` runs 29 caps on a 30-step scripted run and prints both variants. Pre-emptive: overshoot $0 on every cap (at most one call's projection error, $0.057), 9.3 calls sent on average, $0.054 of cap left unspent on average. Post-response check (a `shouldStop` that stops once the spend reaches the cap): mean overshoot $0.0105, worst $0.0147, which is nearly the whole call that crossed the cap.
- Unknown price: "a budgeted run on an unknown-price model" asserts `error.kind: "unknown_price"`, zero steps and zero calls; a second test covers a call whose cost comes back unknown mid-run.
- One formula: "the SDK's projectCallCost is the gateway's" asserts the two exports are one function and that the blocked call's `projectedUsd` equals `projectCallCost()` over the context and options the interceptor saw; the overshoot test calls the SDK's export.
- Progress: `test/progress.test.ts` covers three identical failures (key order ignored) against two, a success breaking the streak, five calls on one `progressKey` against four, the reset on success, other keys not counting, the thresholds, `progress: false` and `continueRun()`.
- Depth: `test/depth.test.ts` runs a tool at `depth === maxDepth` that spawns a run and reads the error result.

Judgement calls:

- **The overshoot wording.** The criterion says the post-response variant "overshoots by at least one call". A post-response check can overshoot by at most the call that crosses the cap, so the test places each cap a nano-dollar above the spend after `k` calls and asserts the overshoot is that whole call less a nano-dollar.
- **The pre-emptive check is conservative.** The projection prices every call at its full output allowance ($0.06 against $0.007 actual), so the check stops far earlier than the cap needs. That cost is recorded above and in the README.
- **`budget` is a new result variant**, because the plan named a `budget` stop reason that B11 and B13 had not added. It carries `reason`, `budgetUsd`, `spentUsd` and `projectedUsd`.
- **The default policy is an interceptor `run()` adds**, joined after the caller's, so a caller's `{ continue }` can't keep a stuck run going. It reads the transcript from the run's own messages onward, so `continueRun()` ignores calls in its history.
- **The vendored copy.** The SDK now carries `hash.ts` beside the three vendored safety files, and the drift test lists it.
- **"Spawns a run".** The SDK has no sub-agent tool, so the cap is enforced where a run starts: `run()` throws `max_depth_exceeded` for `depth > maxDepth`, which the spawning tool's pipeline turns into an error result. `nestedRunDepth(ctx)` builds the child's options.
- **`progressKey` reads the model's raw input**, since the policy reads the transcript, which holds the input as sent. A key that throws leaves the call unkeyed.
- **Scope of the cap.** `budgetUsd` counts the calls the run makes, not the cost of a continued context.

## History

The SDK-gaps revision of 2026-11-18 (ADR 0043) moved `projectCallCost()` to the gateway so the loop and E5 share one formula; plan review 2 (2026-11-19) folded it into the sections above and added E1 for `canonicalInputHash()`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
