# B11b: Turn-level retries: the loop retries a retryable error that ends a turn

| Field | Value |
| --- | --- |
| ID | `B11b` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../done/B11-loop-core.md) |
| Size | M |

## Goal

Let the loop retry a model call whose `retryable` error ended the turn, so a mid-stream failure after output no longer ends the run `error` when a fresh call would succeed. [B4](../done/B4-gateway-runtime.md) deferred this third retry layer to B11, but B11's scope list left it out, so today the only retry is the caller's own `continueRun()`.

## Context

- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): the three retry layers. Pi retries whole turns above the model and treats quota and billing errors as final.
- [B4](../done/B4-gateway-runtime.md): the gateway's layer. It retries `retryable` errors before any output, never replays after the first output event, and never retries `quota`. Its scope names "turn-level retries above the model (B11)" as out of scope.
- [B11's outcome](../done/B11-loop-core.md#outcome), under "Left out": records that no todo owns this work.
- `packages/gateway/src/retry.ts`: the gateway's retry rules and backoff. None of them is public today: `retryDelay`, `BACKOFF_FACTOR` and `MAX_RETRY_DELAY_MS` are private to the module, `abortableSleep` is exported from `retry.ts` only, and `index.ts` exports just the `Sleep` type. The loop should follow the same rules without copying the constants, so this todo exports what it needs from the gateway (see Scope). A hint over the 60 s cap ends the gateway's call with a failure that is still `retryable`, `retryAfterMs` kept.
- `packages/sdk/src/loop.ts`: where the loop turns an `error` terminal into an `error` stop. Today a failed call still appends its message and sends `model_call_end` with it before the stop check ends the run, and `RunOptions` has a `clock` but no `sleep`.
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api): `RunOptions`, `AgentEvent` and the `retry` event.

## Scope

**In scope**

- A `RunOptions` setting for how many times the loop re-issues a model call after a `retryable` error ends the turn, with the default and its rule decided here (see Risks)
- Abortable backoff between turn retries, with the delay shaped like the gateway's and honoring `error.retryAfterMs` up to the gateway's 60 s cap. A failure whose hint is over the cap is final at the turn level too, as the gateway's rule says
- A gateway export of the backoff helper (the delay rule and its cap) and of `abortableSleep`, so the loop does not duplicate them, with a gateway changeset and a README note
- A `sleep` option on `RunOptions`, shaped like the gateway's `Sleep`, so tests can script the backoff
- Retry only on `retryable`: `overflow`, `quota` and `fatal` stay final
- Dropping the failed message from the transcript before the retry, while its usage and cost still count in the result
- The event sequence for a failed attempt, decided here and documented (see Risks), so the event log and `result.context.messages` agree about which messages exist
- A `retry` event for each turn retry that tells a caller whether it is a gateway or a turn retry
- Stop-reason and abort behavior: an abort during backoff ends the run `aborted` with a well-formed transcript
- Documenting that `continueRun()` stays the way to retry after an `error` stop

**Out of scope** (and which todo covers it)

- HTTP retries before output (done in B4)
- Retrying a failed tool call; a tool failure is a result the model sees (B10)
- Replaying after a tool ran, because a turn retry re-issues only the model call that failed before any tool ran
- Budget accounting beyond adding each failed attempt's cost to the totals (B14 decides how its cap treats it)
- Fallback to another model (a later harness concern, not in the SDK plan)

## Tasks

- [x] Decide the open questions in Risks, record each as a note on the plan's §3.3 revision (the new `RunOptions` settings, `sleep` included, and the `retry` event), and add an ADR only if the retry default is a lasting choice.
- [x] Export the backoff helper and `abortableSleep` from `@buildanagent/gateway`, with TSDoc, a gateway README note and a gateway changeset.
- [x] Add the retry count and `sleep` to `RunOptions`, with TSDoc comments that give the defaults and say what is retried.
- [x] In the step loop, when the model call ends `error` with kind `retryable`, wait, drop the failed message and call the model again, until the count runs out.
- [x] Add each failed attempt's usage and cost to the result's totals, using `addCost()` and the gateway's usage helpers.
- [x] Extend the `retry` event so a caller can tell a turn retry from a gateway retry, and update `AGENT_EVENT_TYPES` and the type test if the union changes.
- [x] Make the backoff sleep abortable, and end the run `aborted` when the signal fires during it.
- [x] Write the tests below with `ScriptedModel`, using the stable `clock` and a scripted sleep so no test waits.
- [x] Update the SDK README and the plan's todo table.

## Acceptance criteria

- [x] A model call that streams text and then fails `retryable` is called again, and the run ends `done` when the second call succeeds, with the failed message absent from `result.context.messages`
- [x] A `retryable` failure that never succeeds, with `maxSteps` large enough, ends the run `error` after exactly the configured number of retries, and `error.kind` is `retryable`
- [x] When `maxSteps` runs out during a retry streak, the run ends as the decided `maxSteps` rule says (`max_steps` if retries count against it), and a test covers that case
- [x] A `retryable` failure whose `retryAfterMs` is over the gateway's 60 s cap is not retried at the turn level, and the run ends `error` with the hint kept
- [x] The events for a retried turn follow the documented sequence, and every assistant message that a `model_call_end` carries without a retry after it is in `result.context.messages`, so the event log and the result agree
- [x] `overflow`, `quota` and `fatal` errors are never retried at the turn level
- [x] With the setting at its off value, behavior matches B11: the run ends `error` on the first failure
- [x] The result's `usage` and `cost` include every failed attempt
- [x] An abort during the backoff ends the run `aborted`, with a transcript that satisfies B11's abort rules and `agent_settled` just before `run_end`
- [x] A turn retry emits a `retry` event that a caller can tell from a gateway retry, and the teardown check passes
- [x] A retried turn does not run any tool twice: a scripted run records zero tool calls from the failed attempt
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/turn-retries.test.ts`, with a case per acceptance criterion, built on `ScriptedModel` failing after a text delta. `packages/sdk/test/types.test.ts` gains a type check for any changed event shape. The gateway's own retry tests stay unchanged, which shows the two layers do not double-count.

## Docs to update

`packages/sdk/README.md`: the three retry layers and which one is yours. `packages/gateway/README.md`: the exported backoff helper and `abortableSleep`. [build-sdk.md §3.3](../../plans/build-sdk.md#33-sdk-api): a revision note for the new option and the `retry` event. The plan's todo table in [§4.3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses). Changesets for `@buildanagent/sdk` and `@buildanagent/gateway`; the two version as one fixed group.

## Risks and open questions

**Decided.** The owner decided the first two questions on 2026-11-19, and the rest follow the proposals below, because the code showed no problem with them.

- **The default.** Retrying by default spends tokens on a failure the caller may prefer to see. **Decided 2026-11-19 (owner): off by default, with the Pi-style behavior one option away (`turnRetries: 3`).** Change the default once B14's budget cap bounds the cost.
- **Does a turn retry count against `maxSteps`?** **Decided 2026-11-19 (owner): yes, so `maxSteps` still bounds the worst case.** A run that `maxSteps` stops mid-streak ends `max_steps`, and the last failed message stays in its transcript.
- **The failed attempt's events.** The loop sends `model_call_end` with the failed message, and the guide makes end events authoritative, so a harness that logs them would keep a message the result drops. Proposed: the failed attempt still ends with `model_call_end` carrying the failed message, because its usage is real. The `retry` event then marks that message superseded, and no `step_end` fires until the retried call ends. The README tells a log writer to drop a `model_call_end` that a turn `retry` follows. Settled as proposed, with two additions: `afterModelCall` does not see a superseded failure, and each model call gets its own `stepIndex`, so a retry's events carry the next index.
- **Streamed output cannot be unsent.** A caller that rendered deltas from the failed attempt sees them again from the retry. The `retry` event must let a UI discard the partial text, and the README says so.
- **Stacked layers multiply.** Two gateway retries times N turn retries send many requests at a failing provider. Settled: documented in the README (up to `(retries + 1) * (turnRetries + 1)` requests), not capped, because the default is off.
- **Interaction with B13 and B14.** An interceptor that runs before the model call sees each retry unless B13 says otherwise, and B14's progress check must not read retries as a stuck loop. Checked: both interceptors before the model call, and the budget check, run for every attempt, and the progress check reads a transcript that holds no failed attempt.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

The loop retries a model call that ends with a `retryable` error when `run()` or `continueRun()` gets `turnRetries`; the default is 0, so behavior matches B11. The owner decided on 2026-11-19 that retries are off by default and count against `maxSteps`, and the other open questions were settled as proposed (see Risks).

**Public API.**
- `RunOptions.turnRetries` (default 0), `turnRetryDelayMs` (default 2000, doubling, capped at 60 s, or the failure's `retryAfterMs` when longer) and `sleep` (the gateway's `Sleep`).
- The `retry` event gains a required `layer: "gateway" | "turn"`. No event type is added, so `AGENT_EVENT_TYPES` is unchanged.
- `@buildanagent/gateway` exports `retryDelay()`, `retryHintMs()`, `abortableSleep`, `MAX_RETRY_DELAY_MS` and `DEFAULT_INITIAL_RETRY_DELAY_MS`.

**Behavior.**
- A failed attempt ends with `model_call_end`, then a turn `retry` event; after the wait come its `step_end` and the retry's own `step_start`. The failed message never enters the transcript and `afterModelCall` does not see it. `transformContext`, `beforeModelCall` and the budget check run for every attempt.
- Every attempt is a step with its own `stepIndex`, so a streak that reaches `maxSteps` after a retry ends `max_steps`, with the last failed message kept; a first failure on the last step ends `error`.
- With `budgetUsd` set, the budget is checked before the `retry` event as well: a retry it can't cover ends the run `budget` without a wait, and a failed attempt whose cost is unknown ends it `error` with that failure's own error. A `sleep` that rejects ends the wait early with a `hook_error`.
- A failure with `retryAfterMs` over 60 s, and `overflow`, `quota` and `fatal`, are final. An abort during the wait ends the run `aborted`.

**Left out.** `RunError` still omits `retryAfterMs`; the hint stays on the last assistant message in the transcript. The product of gateway and turn retries is documented, not capped.

Tests: `packages/sdk/test/turn-retries.test.ts` (one case per criterion, plus the OTel, type and gateway-helper tests).
