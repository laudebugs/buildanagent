# B13: The six interceptors and observers

| Field | Value |
| --- | --- |
| ID | `B13` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 3](../../plans/build-sdk.md#43-stage-3-builds-the-loop-its-tools-hooks-budget-and-signed-pauses) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B11](../done/B11-loop-core.md) |
| Size | M |

## Goal

Add the six typed interceptors and the separate observer channel, which are the seams the harness's context policy and permission pipeline plug into.

## Context

- [agent-SDK guide §6](../../guides/agent-sdk.md#6-hooks-should-be-six-typed-interceptors-and-separate-observers-each-taking-one-event-object): the six interceptors, four rules, observers
- [D6](../../plans/build-sdk.md#d6-our-six-moment-named-interceptors-with-run-level-hooks-as-observers)
- [seams §3.4](../../plans/build-sdk.md#34-the-seams-p2-consumes)

## Scope

**In scope**

- `transformContext`, `beforeModelCall`, `afterModelCall`, `beforeToolCall`, `afterToolCall`, `shouldStop`, each taking one event object with `runId`, `stepIndex`, `callId`, `signal` and `timestamp`
- Gates fail closed, with an `onFailure` override
- `ModelCallPatch.activeTools` to activate deferred tools
- Observers via options and `run.on()`, which returns an unsubscribe; a throwing observer becomes `hook_error`
- `context_transformed` events
- `ContextEvent` with `system`, `messages`, `model` and `lastUsage`
- `shouldStop` returning `{ stop: "no_progress" | "hook"; reason }` as well as `boolean` or `{ continue }`

**Out of scope** (and which todo covers it)

- The `ask` pause path (B15) and resume (B15b): here `ask` is a stub that the tests do not use

## Tasks

- [x] Wire each interceptor into the B11 loop at its moment.
- [x] Return replacements; freeze inputs so a mutating hook throws in tests.
- [x] Document the no-handler outcome in `beforeToolCall`'s JSDoc: no gate allows every registered tool, and `ask` pauses.

## Acceptance criteria

- [x] Each interceptor has a test that changes the run's outcome through its return value
- [x] A `beforeToolCall` that throws denies the call (fail closed), and with `onFailure: "continue"` the call runs
- [x] A throwing observer emits `hook_error` and the run still ends `done`
- [x] `run.on()` returns a function that stops delivery
- [x] A deferred tool activated through `activeTools` appears in the next request only
- [x] A hook that mutates its frozen input fails the test
- [x] A masked view returned by `transformContext` reaches only that call's request; the next step's `ContextEvent.messages` and `result.messages` keep the full history (harness need 1)
- [x] `ContextEvent` carries `system`, `messages`, `model` and, from the second call on, the previous call's `lastUsage` (harness need 2)
- [x] `tool_call_end.result` equals the result `afterToolCall` returned, not the tool's original result (harness need 5)
- [x] `activeTools` naming a deferred tool sends it, and a reordered `activeTools` list still sends tools in definition order (harness need 8)
- [x] `shouldStop` returning `{ stop: "hook", reason: "r" }` ends the run `stopped` with `stoppedBy: "r"`, and `{ stop: "no_progress", reason }` ends it `no_progress`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/interceptors.test.ts`, `observers.test.ts`.

## Docs to update

`packages/sdk/README.md`: the hook order, written out. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Hook order must be documented in one place; a rule that makes a hook unreachable must fail loudly (guide §6).

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The run takes `interceptors` and `observers`, and `Run` gains `on()`. `composeInterceptors()` joins interceptor objects. `AgentEvent` gains `context_transformed` and `hook_error`, `RunError.kind` gains `"hook"`, and `RunResult` gains a `no_progress` variant. The new types and the function are exported from the package root. The changeset is `.changeset/sdk-interceptors-observers.md`, a `minor` bump that opens with "Breaking Changes", because an exhaustive `switch` over `RunResult` or `RunError.kind` needs a new case and `run()` now starts its loop one microtask later.

Each criterion and the test that covers it:

- An interceptor changes the outcome through its return value: `test/interceptors.test.ts` covers `transformContext`, `beforeModelCall`, `afterModelCall` and `shouldStop`, and `test/gates.test.ts` covers `beforeToolCall` and `afterToolCall`.
- A throwing gate denies, and `onFailure: "continue"` lets the call run: "a gate that throws denies the call and emits hook_error" and the `"continue"` test after it, in `test/gates.test.ts`.
- A throwing observer emits `hook_error` and the run ends `done`: `test/observers.test.ts`, for a sync throw and for a rejection.
- `run.on()` returns a function that stops delivery: "run.on() returns a function that stops delivery" and "an observer that unsubscribes stops receiving events from then on".
- A deferred tool activated through `activeTools` appears in that request only: "a deferred tool that activeTools names is sent with the next request only". A reordered list still sends definition order: the test after it.
- A hook that mutates its frozen input fails: "a hook that mutates its event fails closed…" and "a hook that mutates a message inside its event throws as well" in `test/interceptor-failures.test.ts`, and the gate version in `test/gates.test.ts`.
- A masked view reaches only that call's request: the two `transformContext` tests at the top of `test/interceptors.test.ts`.
- `ContextEvent` carries `system`, `messages`, `model` and the previous call's `lastUsage`: "a context event carries the system prompt…".
- `tool_call_end.result` equals what `afterToolCall` returned: "afterToolCall's result is the one tool_call_end reports and the model reads".
- `shouldStop` returns `stop` objects: the `{ stop: "hook" }` and `{ stop: "no_progress" }` tests.

Judgement calls, where the plan left room:

- **Failure policy.** `onFailure` covers every interceptor, and the default is `fail_closed`. What closing means depends on the moment: a gate denies, `afterToolCall` withholds the result, and the others end the run with `error.kind: "hook"`. A failure caused by an abort ends the run `aborted`. A wrong return shape is a programmer error, `invalid_hook_result`, and `onFailure` doesn't apply to it.
- **Frozen events.** Each event holds a frozen deep copy of the plain objects and arrays in its data, so a hook can't change the transcript. Class instances are shared.
- **`activeTools`.** It is the complete list of tools to send, not an addition, and a patch lasts for one call. The tools a request sent are the ones its response may run. Because of that, `LoopSetup.tools` now holds every registered tool, and the loop picks the direct ones.
- **`ask`.** Until B15, `ask` blocks the call like `deny`, with a message that says approval isn't available.
- **`afterToolCall`.** It runs only for calls that executed, and a patch can't carry `outcome`, because the outcome is rendered into `content` once.
- **`shouldStop`.** It is asked only when the run would go on or the model answered in text. `continue` is honoured only for a text answer and stops at `maxSteps`.
- **Composition.** One `Interceptors` object per run, joined by `composeInterceptors()`: the strictest gate answer wins, patches merge in order and the joined `onFailure` is `"continue"` only if every object says so.
- **Observers.** Each has its own queue, so one slow observer delays only itself, and observers don't wait for each other. The run waits for the queues before `agent_settled` and before it settles, so `hook_error` never follows `run_end`. A failure while handling `run_end` is dropped for that reason. The loop starts one microtask after `run()` so `run.on()` right after it sees every event but `run_start`.
- **The finding B12 left for this todo.** A receiver that throws inside `onResult` is now handled like a failing call: it cancels the siblings, the pipeline waits for them and passes their results on, and then throws (`test/receiver-failure.test.ts`). The observer bus never throws into the loop at all.

Left undone: the `ask` pause path (B15), and the OpenTelemetry observer (B17).

