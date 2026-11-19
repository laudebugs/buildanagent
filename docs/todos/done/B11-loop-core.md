# B11: Loop core: `run`, the closed event union, stop reasons, aborts and `runOrThrow`

| Field | Value |
| --- | --- |
| ID | `B11` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B4](../done/B4-gateway-runtime.md), [B10](../done/B10-tool-runtime.md) |
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
- `RunStoppedError` with an `isInstance` marker, beside the `SdkError` that B10 added
- `run_start` with `sdkVersion`, `specVersion` and placeholders for `defaultsHash` and `capabilities` (B20 fills them)

**Out of scope** (and which todo covers it)

- Interceptors (B13)
- Budget and progress (B14)
- Pauses (B15, B15b)
- Steering (B16)
- Parallel scheduling (B12): tools run sequentially here

## Tasks

- [x] Implement the step loop with the order transform → before → stream → after → tools → stop, leaving the interceptor calls as no-ops.
- [x] Collect the non-streaming result from the same event stream; no second loop.
- [x] Add the event-closure check to the shared test setup.
- [x] Add the D10 type test.

## Acceptance criteria

- [x] A two-step scripted run with one tool call ends `done`, and its `messages` contain the call and the result
- [x] A run that hits the cap ends `max_steps` after exactly 20 model calls and emits one `warning` event with `code: "max_steps"`, which `AGENT_EVENT_TYPES` lists
- [x] A run whose only tool is an `outputTool` ends `done` after one valid call, and a schema failure spends one model call of `maxSteps` (agent need S2)
- [x] An adapter `overflow` error ends the run `error` with `error.kind: "overflow"`, and each other `AssistantMessage.error.kind` is copied the same way
- [x] Aborting mid-tool leaves every tool call with a result and the last message `aborted`, and `agent_settled` is the last event before `run_end`
- [x] A deferred tool is absent from every recorded request
- [x] `runOrThrow()` on a `max_steps` run throws `RunStoppedError` carrying `context`, and `RunStoppedError.isInstance` is true
- [x] The teardown check fails a test that emits an undeclared event type
- [x] Reading `result.output` without narrowing is a compile error (`@ts-expect-error`)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/loop.test.ts`, `abort.test.ts`, `events.test.ts`, `types.test.ts`.

## Docs to update

`packages/sdk/README.md`: the loop, stop reasons and events. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Size L; if the batch grows, split events and `runOrThrow` into a follow-up.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/sdk` now exports `run()`, `continueRun()` and `runOrThrow()`, the `Run`, `RunOptions` and `RunInput` types, the `RunResult` union (`DoneResult`, `EndedResult`, `ErrorResult`, `StoppedResult`, with `ResultBase`, `UnfinishedResult`, `RunError` and `Context`), the `AgentEvent` union with `EventBase`, `AgentEventBody`, `ModelCallRequest`, `WarningCode` and `AGENT_EVENT_TYPES`, `RunStoppedError`, and `ToolExposure`. The loop lives in `packages/sdk/src/loop.ts` and the `Run` object in `run.ts`; the tool pipeline stays internal and gained an `onStart` callback. The gateway exports `addCost()`, moved out of its retry code.

Each criterion and the test that covers it:

- The two-step run ends `done` with the call and the result in `messages`: `test/loop.test.ts`, "a two-step run with one tool call ends done…".
- The cap: "a run that keeps calling tools ends max_steps after exactly 20 model calls" and "reaching the cap emits one warning event with code max_steps…", in `test/loop.test.ts`.
- The output-only run: "a run whose only tool is an output tool ends done after one valid call…", "an output call that fails its schema spends one model call of maxSteps" and "…on the last allowed call ends max_steps", in `test/loop.test.ts`.
- `overflow` and the other kinds: "an adapter overflow error ends the run error…" and one test per `quota`, `retryable` and `fatal`, in `test/loop.test.ts`.
- Aborting mid-tool: `test/abort.test.ts`, "aborting mid-tool gives every tool call a result…" and "agent_settled is the last event before run_end…", with mid-stream, pre-aborted and aborted-retry cases beside them.
- The deferred tool: "deferred and hidden tools are absent from every recorded request", in `test/loop.test.ts`.
- `runOrThrow()`: "runOrThrow on a max_steps run throws a RunStoppedError that carries the context", in `test/loop.test.ts`.
- The teardown check: `test/setup.ts` runs `assertDeclaredEvents()` after every test, and `test/events.test.ts` has a `test.fails` that passes only because the check fails it.
- The type test: `test/types.test.ts`, with `@ts-expect-error` on `result.output`.

Judgement calls, where the plan left room:

- **Types land with the todos that fill them.** `Context` has no `pending`, and `RunResult` has no `budget`, `no_progress` or pause variants, because their types arrive with B14, B15 and E3. The union declares only the events the loop emits. `stopped` is declared, as the scope asks, for B13. `run_start.defaultsHash` is `""` and `capabilities` is `[]` until B20.
- **`messages` and `context`.** `result.messages` holds the messages a run added, and `result.context.messages` the whole conversation, so the two fields differ for `history` and `continueRun()`.
- **The aborted marker.** The transcript's last message is aborted in every aborted run. When the abort came while tools ran, the loop appends an empty aborted assistant message after the results, because marking the tool-calling message aborted would make the replay pass drop the calls and their results. The run waits for a running tool to return rather than abandoning it, so a write never runs on after its result was recorded.
- **Precedence.** A finished answer or an accepted output wins over an abort that arrived after it; otherwise an abort ends the run before the step cap does.
- **Events.** Each iteration of a run replays its events from the first, so the teardown check and late consumers see every event. `model_call_start.request` is a `ModelCallRequest`, not the gateway's `RequestDump`, because the loop can't see the per-attempt dump. A gateway `warning` becomes `warning` with `code: "model_warning"`. `raw` and `includeRaw` wait for a source of raw provider events.
- **`sdkVersion`** comes from the SDK's `package.json` through a JSON import, so the Version packages pull request needs no source change.
- **Errors.** `RunStoppedError` and `UnexpectedModelCallError` extend `SdkError`, and `StreamContractError` and `ModelRequestsDisabledError` extend `GatewayError`, each with a code, which closes that Known gaps row. A tool that returns a malformed result rejects `result` with its `SdkError`, after the earlier results are in the transcript.
- **Left out.** Depth stays at 0 and `maxDepth` at 2 inside `ToolContext` until B14 makes them options. The turn-level retries that B4 deferred to this todo are not in B11's scope list, so `continueRun()` is the retry path for now.

