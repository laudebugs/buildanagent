# B11: Loop core: `run`, the closed event union, stop reasons, aborts and `runOrThrow`

| Field | Value |
| --- | --- |
| ID | `B11` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B4](../done/B4-gateway-runtime.md), [B10](../ongoing/B10-tool-runtime.md) |
| Size | L |

## Goal

Build the one pure streaming loop: model step, tool dispatch and stop check, with every outcome returned as a stop reason and every abort leaving a well-formed transcript.

## Context

- [agent-SDK guide §3](../../guides/agent-sdk.md#3-the-loop-should-be-one-in-process-pure-function-capped-in-model-calls-that-ends-with-a-stop-reason): one loop, the 20-call cap, stop reasons, aborts
- [agent-SDK guide §5](../../guides/agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item): the closed, layered union
- [D10](../../plans/build-sdk.md#d10-a-discriminated-result-union-plus-runorthrow-for-callers-who-want-exceptions)
- [SDK API §3.3](../../plans/build-sdk.md#33-sdk-api)

## Scope

**In scope**

- `run()`, `continueRun()` without resolutions (B15b adds them), `runOrThrow()`, the `Run` object
- `Context` (`system`, `messages`, `pending?`) in `run.ts`, moved from the gateway so the gateway names no SDK type
- `RunError` with `kind`, `message` and `status`, copying `AssistantMessage.error.kind` on an `error` stop
- The `stopped` result variant with `stoppedBy`, which B13's `shouldStop` fills
- The closed `AgentEvent` union, `AGENT_EVENT_TYPES` and the emitted-against-declared teardown check
- `maxSteps` default 20 counted in model calls, with a `warning` event (`code: "max_steps"`) when it fires
- An output-only run: a run whose only tool is an `outputTool` ends `done` after one valid call
- Abort: every open tool call gets an aborted error result, the message closes with `stopReason: "aborted"`, and `agent_settled` fires after retries stop
- `exposure`: deferred and hidden tools are not sent to the model
- `RunStoppedError` and `SdkError` with `isInstance` markers
- `run_start` with `sdkVersion`, `specVersion` and placeholders for `defaultsHash` and `capabilities` (B20 fills them)

**Out of scope** (and which todo covers it)

- Interceptors (B13)
- Budget and progress (B14)
- Pauses (B15, B15b)
- Steering (B16)
- Parallel scheduling (B12): tools run sequentially here

## Tasks

- [ ] Implement the step loop with the order transform → before → stream → after → tools → stop, leaving the interceptor calls as no-ops.
- [ ] Collect the non-streaming result from the same event stream; no second loop.
- [ ] Add the event-closure check to the shared test setup.
- [ ] Add the D10 type test.

## Acceptance criteria

- [ ] A two-step scripted run with one tool call ends `done`, and its `messages` contain the call and the result
- [ ] A run that hits the cap ends `max_steps` after exactly 20 model calls and emits one `warning` event with `code: "max_steps"`, which `AGENT_EVENT_TYPES` lists
- [ ] A run whose only tool is an `outputTool` ends `done` after one valid call, and a schema failure spends one model call of `maxSteps` (agent need S2)
- [ ] An adapter `overflow` error ends the run `error` with `error.kind: "overflow"`, and each other `AssistantMessage.error.kind` is copied the same way
- [ ] Aborting mid-tool leaves every tool call with a result and the last message `aborted`, and `agent_settled` is the last event before `run_end`
- [ ] A deferred tool is absent from every recorded request
- [ ] `runOrThrow()` on a `max_steps` run throws `RunStoppedError` carrying `context`, and `RunStoppedError.isInstance` is true
- [ ] The teardown check fails a test that emits an undeclared event type
- [ ] Reading `result.output` without narrowing is a compile error (`@ts-expect-error`)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/loop.test.ts`, `abort.test.ts`, `events.test.ts`, `types.test.ts`.

## Docs to update

`packages/sdk/README.md`: the loop, stop reasons and events. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Size L; if the batch grows, split events and `runOrThrow` into a follow-up.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
